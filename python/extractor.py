"""Resurface extraction worker.

Long-running process. Reads JSON requests (one per line) from stdin and writes
JSON responses (one per line) to stdout:

  -> {"id": 1, "cmd": "channel", "url": "https://youtube.com/@x", "limit": 100}   (limit null = all)
  <- {"id": 1, "ok": true, "result": {...}}
  <- {"id": 1, "ok": false, "error": {"kind": "...", "message": "..."}}

Commands: channel, yta (youtube-transcript-api), ytdlp (yt-dlp captions).
Error kinds: invalid_url, not_found, unavailable (permanent: no captions /
private / removed), rate_limited (provider is throttling us), temporary
(network or other transient failure).

Only existing YouTube captions are retrieved. Videos are never downloaded.
"""

import json
import re
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import requests

_out_lock = threading.Lock()
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class WorkerError(Exception):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind
        self.message = message


def send(obj):
    line = json.dumps(obj, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# --------------------------------------------------------------------------
# Channel catalog
# --------------------------------------------------------------------------

# How many uploads to scan when looking for enough long-form videos on a
# Shorts-heavy channel.
DEEP_SCAN = 1500

TAB_SUFFIX_RE = re.compile(
    r"/(videos|shorts|streams|featured|playlists|community|about|live|podcasts|releases|search)/?$"
)


def normalize_channel_url(raw):
    s = (raw or "").strip()
    if not s:
        raise WorkerError("invalid_url", "Paste a YouTube channel URL.")
    if s.startswith("@"):
        s = "https://www.youtube.com/" + s
    if not re.match(r"^https?://", s, re.I):
        s = "https://" + s
    s = s.split("?")[0].split("#")[0].rstrip("/")
    m = re.match(
        r"^https?://(?:www\.|m\.)?youtube\.com/(@[^/]+|channel/UC[A-Za-z0-9_-]{22}|c/[^/]+|user/[^/]+)(?:/.*)?$",
        s,
        re.I,
    )
    if not m:
        raise WorkerError(
            "invalid_url",
            "That doesn't look like a YouTube channel URL. Use youtube.com/@name, "
            "/channel/ID, /c/name or /user/name.",
        )
    return "https://www.youtube.com/" + m.group(1)


def _ydl(extra=None):
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": "in_playlist",
        "extractor_args": {"youtubetab": {"approximate_date": [""]}},
        "socket_timeout": 20,
        "retries": 3,
        "noprogress": True,
        "logger": _QuietLogger(),
    }
    if extra:
        opts.update(extra)
    return yt_dlp.YoutubeDL(opts)


class _QuietLogger:
    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        pass


def _classify_ytdlp_error(e):
    msg = str(e)
    low = msg.lower()
    if "429" in low or "too many requests" in low or "not a bot" in low or ("rate" in low and "limit" in low):
        return WorkerError("rate_limited", "YouTube is rate limiting requests: " + msg[:200])
    if any(k in low for k in ("timed out", "timeout", "connection", "network", "temporary failure",
                              "name resolution", "urlopen error", "remote end closed", "ssl")):
        return WorkerError("temporary", "Network problem: " + msg)
    if "does not exist" in low or "404" in low or "not found" in low or "this channel" in low:
        return WorkerError("not_found", "Channel not found: " + msg)
    return WorkerError("temporary", msg)


def _extract(url, playlist_end=None):
    import yt_dlp

    extra = {}
    if playlist_end:
        extra["playlistend"] = playlist_end
    try:
        with _ydl(extra) as ydl:
            return ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise _classify_ytdlp_error(e)


def _best_thumb(thumbs, prefer_id=None):
    if not thumbs:
        return None
    if prefer_id:
        for t in thumbs:
            if t.get("id") == prefer_id and t.get("url"):
                return t["url"]
    best = None
    for t in thumbs:
        if not t.get("url"):
            continue
        if best is None or (t.get("width") or 0) > (best.get("width") or 0):
            best = t
    return best["url"] if best else None


def _resolve_channel(base):
    """Channel identity + profile. Channels without long-form uploads have no
    /videos tab, so fall back to the other tabs."""
    last_err = None
    for suffix in ("/videos", "/shorts", "/streams", ""):
        try:
            info = _extract(base + suffix, playlist_end=1)
            if info and info.get("channel_id"):
                return info
        except WorkerError as e:
            last_err = e
            if e.kind == "rate_limited":
                raise
    if last_err and last_err.kind in ("temporary", "rate_limited"):
        raise last_err
    raise WorkerError("not_found", "Could not find that YouTube channel.")


def cmd_channel(req):
    base = normalize_channel_url(req.get("url"))
    raw_limit = req.get("limit")
    limit = int(raw_limit) if raw_limit else None  # None = every public upload
    hint = req.get("channel_id")
    if not hint:
        m = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})$", base)
        hint = m.group(1) if m else None
    # Head-room for upcoming / members-only entries we skip; None = whole playlist.
    fetch_n = limit + 30 if limit else None
    timings = {}

    def timed(name, fn, *a):
        t0 = time.time()
        try:
            return fn(*a)
        finally:
            timings[name] = round((time.time() - t0) * 1000)

    # The uploads playlist (UU…) lists every public upload newest first; the
    # /shorts tab tells us which are Shorts. With a known channel id all three
    # listings run in parallel; otherwise identity is resolved first.
    pool = ThreadPoolExecutor(max_workers=3)
    try:
        if hint:
            f_info = pool.submit(timed, "info", _resolve_channel, "https://www.youtube.com/channel/" + hint)
            f_up = pool.submit(timed, "uploads", _extract, "https://www.youtube.com/playlist?list=UU" + hint[2:], fetch_n)
            f_sh = pool.submit(timed, "shorts", _extract, "https://www.youtube.com/channel/" + hint + "/shorts", fetch_n)
            info = f_info.result()
            if info["channel_id"] != hint:
                raise WorkerError("not_found", "Channel id mismatch.")
        else:
            f_sh = pool.submit(timed, "shorts", _extract, base + "/shorts", fetch_n)
            info = timed("info", _resolve_channel, base)
            cid = info["channel_id"]
            f_up = pool.submit(timed, "uploads", _extract, "https://www.youtube.com/playlist?list=UU" + cid[2:], fetch_n)
    except WorkerError:
        pool.shutdown(wait=False, cancel_futures=True)
        raise

    channel_id = info["channel_id"]
    channel = {
        "id": channel_id,
        "name": info.get("channel") or info.get("uploader") or channel_id,
        "handle": info.get("uploader_id"),
        "url": info.get("uploader_url") or info.get("channel_url") or base,
        "description": (info.get("description") or "").strip(),
        # "=s0" is the full-resolution original; ask for a small avatar instead.
        "thumbnail": re.sub(r"=s0$", "=s176-c-k-c0x00ffffff-no-rj",
                            _best_thumb(info.get("thumbnails"), "avatar_uncropped") or "") or None,
        "followers": info.get("channel_follower_count"),
    }

    # 2) The channel's uploads playlist lists every public upload (Shorts,
    #    long-form, past streams) newest first. The /shorts tab tells us which
    #    of them are Shorts. Fetch both at once.
    try:
        uploads = f_up.result()
    except WorkerError as e:
        if e.kind == "not_found":
            uploads = {"entries": []}  # channel with no uploads
        else:
            raise
    shorts_known = True
    try:
        shorts = f_sh.result()
        short_ids = {e.get("id") for e in (shorts.get("entries") or []) if e}
    except WorkerError:
        # A channel without Shorts has no /shorts tab - that is fine.
        short_ids = set()
        shorts_known = False
    pool.shutdown(wait=False)

    def classify(uploads, short_ids, shorts_known):
        """All usable uploads, newest first, each tagged short/long."""
        out, skipped = [], 0
        for e in uploads.get("entries") or []:
            if not e or not e.get("id"):
                continue
            title = e.get("title") or ""
            live = e.get("live_status")
            avail = e.get("availability")
            if title in ("[Private video]", "[Deleted video]", "[Unavailable video]"):
                skipped += 1
                continue
            if live in ("is_upcoming", "is_live", "post_live"):
                skipped += 1
                continue
            if avail and avail not in ("public", "unlisted"):
                skipped += 1
                continue
            vid = e["id"]
            duration = e.get("duration")
            if vid in short_ids:
                vtype = "short"
            elif shorts_known:
                vtype = "long"
            else:
                # Fallback only: no Shorts tab data available.
                url = e.get("url") or ""
                vtype = "short" if ("/shorts/" in url or (duration is not None and duration <= 60)) else "long"
            out.append(
                {
                    "id": vid,
                    "title": title,
                    "url": ("https://www.youtube.com/shorts/" if vtype == "short" else "https://www.youtube.com/watch?v=") + vid,
                    "thumbnail": "https://i.ytimg.com/vi/" + vid + "/mqdefault.jpg",
                    "timestamp": e.get("timestamp"),  # approximate (from "2 weeks ago")
                    "duration": duration,
                    "view_count": e.get("view_count"),
                    "type": vtype,
                    "was_live": live == "was_live",
                }
            )
        return out, skipped

    all_videos, skipped = classify(uploads, short_ids, shorts_known)

    # Long-form first: the selection is the latest `limit` long-form videos;
    # Shorts only fill the slots left when the channel has fewer long-form.
    # Shorts-heavy channels need a deeper scan to find enough long-form.
    longs = sum(v["type"] == "long" for v in all_videos)
    more_exist = fetch_n is not None and len(uploads.get("entries") or []) >= fetch_n
    if limit and longs < limit and more_exist:
        cid = channel_id
        with ThreadPoolExecutor(max_workers=2) as deep:
            f_up2 = deep.submit(timed, "uploads_deep", _extract, "https://www.youtube.com/playlist?list=UU" + cid[2:], DEEP_SCAN)
            f_sh2 = deep.submit(timed, "shorts_deep", _extract, "https://www.youtube.com/channel/" + cid + "/shorts", DEEP_SCAN)
            try:
                uploads = f_up2.result()
                try:
                    short_ids = {e.get("id") for e in (f_sh2.result().get("entries") or []) if e}
                    shorts_known = True
                except WorkerError:
                    pass
                all_videos, skipped = classify(uploads, short_ids, shorts_known)
            except WorkerError:
                pass  # keep the shallow result

    if limit:
        long_v = [v for v in all_videos if v["type"] == "long"][:limit]
        short_v = [v for v in all_videos if v["type"] == "short"][: max(0, limit - len(long_v))]
        keep = {v["id"] for v in long_v + short_v}
        videos = [v for v in all_videos if v["id"] in keep]  # back in upload order, newest first
    else:
        videos = all_videos

    return {"channel": channel, "videos": videos, "skipped": skipped, "timings": timings}


# --------------------------------------------------------------------------
# Transcripts
# --------------------------------------------------------------------------

PUBLISH_RE = re.compile(r'"(?:publishDate|uploadDate)":"(\d{4}-\d{2}-\d{2})')


def _pick_transcript(tlist):
    manual = [t for t in tlist if not t.is_generated]
    # Auto-dubbed videos carry one auto-generated track per dub language; the
    # dubs are marked variant=timing-optimized. Put the original speech first.
    generated = sorted(
        (t for t in tlist if t.is_generated),
        key=lambda t: "variant=timing-optimized" in (getattr(t, "_url", "") or ""),
    )
    spoken = generated[0].language_code.split("-")[0] if generated else None

    def lang(t):
        return t.language_code.split("-")[0]

    if spoken:
        for t in manual:
            if lang(t) == spoken:
                return t
        return generated[0]
    for t in manual:
        if lang(t) == "en":
            return t
    if manual:
        return manual[0]
    return None


def _via_transcript_api(video_id):
    import youtube_transcript_api as yta

    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    seen = {}

    def hook(resp, *a, **k):
        # Capture the exact publish date from the watch page the library
        # already fetches, so no extra request is needed.
        try:
            if "/watch" in resp.url and "date" not in seen:
                m = PUBLISH_RE.search(resp.text)
                if m:
                    seen["date"] = m.group(1)
        except Exception:
            pass

    session.hooks["response"].append(hook)
    api = yta.YouTubeTranscriptApi(http_client=session)
    tlist = api.list(video_id)
    chosen = _pick_transcript(tlist)
    if chosen is None:
        raise yta.NoTranscriptFound(video_id, [], tlist)
    fetched = chosen.fetch(preserve_formatting=False)
    segs = [
        {"start": round(float(s.start), 3), "duration": round(float(s.duration or 0), 3), "text": s.text}
        for s in fetched.snippets
    ]
    return {
        "segments": segs,
        "language": chosen.language_code,
        "generated": bool(chosen.is_generated),
        "source": "youtube-transcript-api",
        "upload_date": seen.get("date"),
    }


def _json3_to_segments(data):
    segs = []
    for ev in data.get("events") or []:
        parts = ev.get("segs")
        if not parts:
            continue
        text = "".join(p.get("utf8", "") for p in parts).replace("\n", " ").strip()
        if not text:
            continue
        segs.append(
            {
                "start": round((ev.get("tStartMs") or 0) / 1000.0, 3),
                "duration": round((ev.get("dDurationMs") or 0) / 1000.0, 3),
                "text": text,
            }
        )
    return segs


def _via_ytdlp(video_id):
    """Fallback: read caption tracks from yt-dlp metadata (no video download)."""
    import yt_dlp

    url = "https://www.youtube.com/watch?v=" + video_id
    try:
        with _ydl({"extract_flat": False, "writesubtitles": False}) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
            manual = info.get("subtitles") or {}
            auto = info.get("automatic_captions") or {}
            orig = None
            for code in auto:
                if code.endswith("-orig"):
                    orig = code
                    break
            spoken = (orig or "").replace("-orig", "").split("-")[0] or info.get("language")

            def pick(tracks, lang_pref):
                if not tracks:
                    return None, None
                keys = list(tracks.keys())
                order = []
                if lang_pref:
                    order += [k for k in keys if k.split("-")[0] == lang_pref]
                order += [k for k in keys if k.split("-")[0] == "en"]
                order += keys
                for k in order:
                    if k == "live_chat":
                        continue
                    for f in tracks[k]:
                        if f.get("ext") == "json3" and f.get("url"):
                            return k, f["url"]
                return None, None

            code, sub_url = pick(manual, spoken)
            generated = False
            if not sub_url:
                if orig:
                    code, sub_url = orig, next(
                        (f["url"] for f in auto[orig] if f.get("ext") == "json3"), None
                    )
                if not sub_url:
                    code, sub_url = pick({k: v for k, v in auto.items() if k == spoken or not spoken}, spoken)
                generated = True
            if not sub_url:
                raise WorkerError("unavailable", "No captions exist for this video.")
            raw = ydl.urlopen(sub_url).read().decode("utf-8")
    except yt_dlp.utils.DownloadError as e:
        msg = str(e).lower()
        if "not a bot" in msg or "429" in msg or "too many requests" in msg:
            raise WorkerError("rate_limited", "YouTube is temporarily blocking requests (rate limit).")
        if any(k in msg for k in ("private video", "removed", "unavailable", "members", "age-restricted",
                                  "confirm your age", "copyright", "terminated")):
            raise WorkerError("unavailable", str(e))
        raise _classify_ytdlp_error(e)

    segs = _json3_to_segments(json.loads(raw))
    if not segs:
        raise WorkerError("unavailable", "Caption track was empty.")
    ud = info.get("upload_date")
    return {
        "segments": segs,
        "language": (code or "").replace("-orig", ""),
        "generated": generated,
        "source": "yt-dlp",
        "upload_date": f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}" if ud and len(ud) == 8 else None,
    }


def _check_id(req):
    video_id = req.get("video_id") or ""
    if not VIDEO_ID_RE.match(video_id):
        raise WorkerError("unavailable", "Invalid video id.")
    return video_id


def cmd_yta(req):
    """Provider: youtube-transcript-api."""
    import youtube_transcript_api as yta

    video_id = _check_id(req)
    try:
        return _via_transcript_api(video_id)
    except (yta.TranscriptsDisabled, yta.NoTranscriptFound):
        raise WorkerError("unavailable", "No captions available for this video.")
    except (yta.VideoUnavailable, yta.AgeRestricted, yta.VideoUnplayable, yta.InvalidVideoId) as e:
        raise WorkerError("unavailable", _first_line(e) or "Video is unavailable.")
    except (yta.IpBlocked, yta.RequestBlocked):
        raise WorkerError("rate_limited", "YouTube is blocking caption requests from this IP (rate limit).")
    except (requests.ConnectionError, requests.Timeout) as e:
        raise WorkerError("temporary", "Network problem: " + str(e)[:200])
    except yta.YouTubeRequestFailed as e:
        msg = _first_line(e)
        if "429" in msg:
            raise WorkerError("rate_limited", "YouTube returned 429 Too Many Requests.")
        raise WorkerError("temporary", "YouTube request failed: " + msg)
    except WorkerError:
        raise
    except Exception as e:  # PoTokenRequired, parse errors, ...
        raise WorkerError("temporary", type(e).__name__ + ": " + _first_line(e))


def cmd_ytdlp(req):
    """Provider: yt-dlp caption tracks (never downloads the video)."""
    return _via_ytdlp(_check_id(req))


def _first_line(e):
    s = str(e).strip()
    for line in s.splitlines():
        line = line.strip()
        if line and not line.startswith("Could not retrieve a transcript"):
            return line[:300]
    return s[:300]


# --------------------------------------------------------------------------

COMMANDS = {"channel": cmd_channel, "yta": cmd_yta, "ytdlp": cmd_ytdlp, "ping": lambda r: "pong"}


def _warm():
    # Import the heavy libraries up front so the first real request is fast.
    try:
        import yt_dlp  # noqa: F401
        import youtube_transcript_api  # noqa: F401
        from yt_dlp.extractor import youtube  # noqa: F401
    except Exception:
        pass


def handle(req):
    rid = req.get("id")
    try:
        fn = COMMANDS.get(req.get("cmd"))
        if not fn:
            raise WorkerError("unavailable", "Unknown command")
        send({"id": rid, "ok": True, "result": fn(req)})
    except WorkerError as e:
        send({"id": rid, "ok": False, "error": {"kind": e.kind, "message": e.message}})
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        send({"id": rid, "ok": False, "error": {"kind": "temporary", "message": type(e).__name__ + ": " + str(e)[:300]}})


def main():
    if len(sys.argv) > 1:  # CLI testing: extractor.py channel <url> | transcript <id>
        cmd, arg = sys.argv[1], sys.argv[2]
        req = {"id": 0, "cmd": cmd, "url": arg, "video_id": arg, "limit": (None if sys.argv[3] == "all" else int(sys.argv[3])) if len(sys.argv) > 3 else 100,
               "channel_id": sys.argv[4] if len(sys.argv) > 4 else None}
        handle(req)
        return
    threading.Thread(target=_warm, daemon=True).start()
    pool = ThreadPoolExecutor(max_workers=12)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        pool.submit(handle, req)
    pool.shutdown(wait=True)


if __name__ == "__main__":
    main()
