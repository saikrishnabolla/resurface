import logging
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html import unescape
from urllib.parse import urlsplit

import requests

BASE = "https://treg.to/call/"
MAX_VIDEOS = 100
MAX_CAPTION_CALLS = 2 * MAX_VIDEOS
MAX_PAGES = 14
CAPTION_CONCURRENCY = 8
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
TIKTOK_ID = re.compile(r"[0-9]{15,22}")
INSTAGRAM_ID = re.compile(r"[A-Za-z0-9_-]{4,32}")
YOUTUBE_CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}")
CAPTION_TIME = re.compile(r"(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[.,](\d{3})")
QUOTA_ERRORS = {401, 402, 403, 429}
logger = logging.getLogger(__name__)

YT_VIDEOS = "scrapecreators.x.v1-youtube-channel-videos"
YT_SHORTS = "scrapecreators.x.v1-youtube-channel-shorts"
YT_TRANSCRIPT = "scrapecreators.x.v1-youtube-video-transcript"
TT_VIDEOS = "scrapecreators.x.v3-tiktok-profile-videos"
TT_TRANSCRIPT = "scrapecreators.x.v1-tiktok-video-transcript"
IG_REELS = "scrapecreators.x.v1-instagram-user-reels"
IG_TRANSCRIPT = "scrapecreators.x.v2-instagram-media-transcript"


class ProviderError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__(f"Treg status {status}")


def normalize_profile(value):
    invalid = "Enter a public YouTube, TikTok, or Instagram profile link."
    if not isinstance(value, str) or len(value) > 350:
        raise ValueError(invalid)
    value = value.strip()
    try:
        url = urlsplit(value if "://" in value else f"https://{value}")
        host = url.netloc.lower()
    except ValueError as error:
        raise ValueError(invalid) from error
    if url.scheme not in ("http", "https"):
        raise ValueError(invalid)
    path = url.path.rstrip("/")
    if host in {"youtube.com", "www.youtube.com", "m.youtube.com"}:
        path = re.sub(r"/(?:videos|shorts|featured|about|streams|playlists)$", "", path)
        match = re.fullmatch(r"/(@[A-Za-z0-9._-]{3,35}|channel/UC[A-Za-z0-9_-]{22})", path)
        if match:
            return {"platform": "YouTube", "url": f"https://www.youtube.com{path}", "handle": path.split("/")[-1]}
    if host in {"tiktok.com", "www.tiktok.com", "m.tiktok.com"}:
        match = re.fullmatch(r"/@([A-Za-z0-9._]{2,30})", path)
        if match:
            handle = match.group(1).lower()
            return {"platform": "TikTok", "url": f"https://www.tiktok.com/@{handle}", "handle": f"@{handle}"}
    if host in {"instagram.com", "www.instagram.com", "m.instagram.com"}:
        match = re.fullmatch(r"/([A-Za-z0-9._]{1,30})(?:/reels)?", path)
        if match:
            handle = match.group(1).lower()
            if handle not in {"accounts", "about", "developer", "direct", "explore", "p", "reel", "reels", "stories", "tv"}:
                return {"platform": "Instagram", "url": f"https://www.instagram.com/{handle}", "handle": f"@{handle}"}
    raise ValueError(invalid)


def call(token, tool, **params):
    try:
        read_timeout = 40 if tool == IG_TRANSCRIPT else 12 if tool in {YT_TRANSCRIPT, TT_TRANSCRIPT} else 25
        response = requests.get(BASE + tool, params=params, headers={"X-Treg-Token": token},
                                timeout=(5, read_timeout), allow_redirects=False)
        if response.status_code != 200:
            logger.warning("Treg %s returned HTTP %d", tool, response.status_code)
            raise ProviderError(response.status_code)
        body = response.json()
    except (requests.RequestException, ValueError) as error:
        logger.warning("Treg %s request failed: %s", tool, type(error).__name__)
        raise ProviderError(502) from error
    if not isinstance(body, dict) or body.get("success") is not True:
        raise ProviderError(502)
    return body


def clean_text(value, limit):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def number(value):
    if isinstance(value, bool):
        return None
    try:
        converted = float(value)
        return converted if math.isfinite(converted) and converted >= 0 else None
    except (TypeError, ValueError, OverflowError):
        return None


def date(value):
    try:
        if isinstance(value, str) and not value.isdecimal():
            converted = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if converted.tzinfo is None:
                converted = converted.replace(tzinfo=timezone.utc)
        else:
            stamp = number(value)
            if stamp is None or stamp == 0:
                return None
            converted = datetime.fromtimestamp(stamp / 1000 if stamp >= 10**12 else stamp, timezone.utc)
        return converted.astimezone(timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):
        return None


def duration_label(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,4}(?::[0-5]\d){1,2}", value):
        return None
    seconds = 0
    for item in value.split(":"):
        seconds = 60 * seconds + int(item)
    return seconds


def mapping(value):
    return value if isinstance(value, dict) else {}


def thumbnail(value, allowed):
    if not isinstance(value, str) or len(value) > 3500:
        return None
    try:
        parts = urlsplit(value)
        hostname = parts.hostname or ""
    except ValueError:
        return None
    if parts.scheme != "https" or parts.netloc.lower() != hostname:
        return None
    return value if any(hostname == host or hostname.endswith("." + host) for host in allowed) else None


def first(items):
    return items[0] if isinstance(items, list) and items else None


def build_video(video_id, title, description, image, url, published, duration, format_):
    description = clean_text(description, 640)
    title = clean_text(title, 240) or clean_text(description, 110) or ("Untitled short" if format_ == "short" else "Untitled video")
    return {"id": video_id, "title": title, "description": description, "thumbnail": image,
            "url": url, "publishedAt": published, "duration": duration, "format": format_}


def youtube_row(row, shorts=False):
    row = mapping(row)
    video_id = row.get("id")
    if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
        return None
    if row.get("isLive") or row.get("isLiveNow") or row.get("isUpcoming"):
        return None
    url = row.get("url")
    if not shorts and (row.get("type") == "short" or (isinstance(url, str) and "/shorts/" in url)):
        return None
    duration = number(row.get("lengthSeconds"))
    if duration is None:
        duration = duration_label(row.get("lengthText"))
    path = f"/shorts/{video_id}" if shorts else f"/watch?v={video_id}"
    return build_video(video_id, row.get("title"), row.get("description"),
                       thumbnail(row.get("thumbnail"), {"ytimg.com"}) or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                       f"https://www.youtube.com{path}", date(row.get("publishDate")), duration, "short" if shorts else "video")


def tiktok_row(row, handle):
    row = mapping(row)
    video_id = str(row.get("aweme_id", ""))
    video = mapping(row.get("video"))
    if not TIKTOK_ID.fullmatch(video_id) or not video or row.get("image_post_info"):
        return None
    # TikTok lists HEIC first, which most browsers cannot show. Take a JPEG from any cover field.
    urls = [u for key in ("cover", "origin_cover", "dynamic_cover")
            for u in (mapping(video.get(key)).get("url_list") or []) if isinstance(u, str)]
    art = None
    for u in sorted(urls, key=lambda u: 0 if re.search(r"\.jpe?g(?:\?|$)", u) else 1):
        art = thumbnail(u, {"tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu",
                            "byteoversea.com", "ibytedtos.com", "muscdn.com"})
        if art:
            break
    length_ms = number(video.get("duration"))
    length = length_ms / 1000 if length_ms is not None else number(row.get("video_duration"))
    return build_video(video_id, row.get("title"), row.get("desc"), art,
                       f"https://www.tiktok.com/@{handle}/video/{video_id}",
                       date(row.get("create_time")), length, "short")


def instagram_row(row):
    row = mapping(row)
    media = mapping(row.get("media")) or row
    code = media.get("code") or media.get("shortcode")
    if not isinstance(code, str) or not INSTAGRAM_ID.fullmatch(code):
        return None
    product = media.get("product_type")
    if product and product not in ("clips", "reels"):
        return None
    if media.get("media_type") is not None and str(media.get("media_type")) != "2":
        return None
    image = mapping(first(mapping(media.get("image_versions2")).get("candidates"))).get("url")
    image = thumbnail(image or media.get("display_uri"), {"cdninstagram.com", "fbcdn.net", "instagram.com"})
    caption = media.get("caption")
    caption = caption.get("text") if isinstance(caption, dict) else caption
    return build_video(code, media.get("title"), caption, image, f"https://www.instagram.com/reel/{code}/",
                       date(media.get("taken_at") or media.get("created_at")), number(media.get("video_duration")),
                       "short")


def cursor_for(data, tool):
    if tool in {YT_VIDEOS, YT_SHORTS}:
        return data.get("continuationToken"), "continuationToken"
    if tool == TT_VIDEOS:
        return data.get("max_cursor") if data.get("has_more") else None, "max_cursor"
    paging = mapping(data.get("paging_info"))
    return (paging.get("max_id") or data.get("max_id")) if paging.get("more_available", data.get("more_available")) else None, "max_id"


@dataclass
class Feed:
    params: dict
    rows: dict = field(default_factory=dict)
    seen_cursors: set = field(default_factory=set)
    pages: int = 0
    done: bool = False
    issue: ProviderError | None = None


def paged_feed(token, tool, key, params, row_parser, limit, deadline, feed=None, exclude_ids=()):
    feed = feed or Feed(params)
    while not feed.done and not feed.issue and sum(id_ not in exclude_ids for id_ in feed.rows) < limit:
        if feed.pages >= MAX_PAGES or time.monotonic() >= deadline:
            feed.issue = ProviderError(504)
            break
        try:
            payload = call(token, tool, **feed.params)
            page = payload.get(key)
            if page is None and key == "aweme_list" and not payload.get("has_more"):
                page = []
            if not isinstance(page, list):
                raise ProviderError(502)
        except ProviderError as error:
            feed.issue = error
            break
        feed.pages += 1
        for raw in page:
            row = row_parser(raw)
            if row:
                feed.rows.setdefault(row["id"], row)
        cursor, param = cursor_for(payload, tool)
        if cursor is None or cursor == "":
            feed.done = True
        elif not isinstance(cursor, (str, int)) or str(cursor) in feed.seen_cursors:
            feed.issue = ProviderError(504)
        else:
            feed.params = {**feed.params, param: cursor}
            feed.seen_cursors.add(str(cursor))
    return feed


def newest(rows):
    return sorted(rows, key=lambda row: row["publishedAt"] or "", reverse=True)


def list_uploads(token, profile, limit=MAX_VIDEOS, deadline=float("inf")):
    platform, handle = profile["platform"], profile["handle"].lstrip("@")
    if platform == "YouTube":
        identity = {"channelId": handle} if not profile["handle"].startswith("@") and YOUTUBE_CHANNEL_ID.fullmatch(handle) else {"handle": handle}
        feeds = [(YT_VIDEOS, "videos", {**identity, "sort": "latest"}, youtube_row),
                 (YT_SHORTS, "shorts", {**identity, "sort": "newest"}, lambda row: youtube_row(row, shorts=True))]
    elif platform == "TikTok":
        feeds = [(TT_VIDEOS, "aweme_list", {"handle": handle, "sort_by": "latest", "include_pinned": "false"},
                  lambda row: tiktok_row(row, handle))]
    else:
        feeds = [(IG_REELS, "items", {"handle": handle}, instagram_row)]
    with ThreadPoolExecutor(max_workers=len(feeds)) as pool:
        tasks = [pool.submit(paged_feed, token, *feed, limit, deadline) for feed in feeds]
        results = [task.result() for task in tasks]
    if platform == "YouTube":
        regular, shorts = results
        short_ids = set(shorts.rows)
        # The regular endpoint can repeat Shorts. Continue from its existing cursor if those rows used its initial quota.
        if short_ids & regular.rows.keys():
            paged_feed(token, *feeds[0], limit, deadline, feed=regular, exclude_ids=short_ids)
        regular_rows = newest(row for id_, row in regular.rows.items() if id_ not in short_ids)[:limit]
        short_rows = []
        for id_, short in shorts.rows.items():
            row = dict(short)
            previous = regular.rows.get(id_, {})
            for key in ("description", "thumbnail", "publishedAt", "duration"):
                if not row[key] and previous.get(key):
                    row[key] = previous[key]
            short_rows.append(row)
        merged = newest(regular_rows + newest(short_rows)[:limit])
    else:
        merged = newest(results[0].rows.values())[:limit]
    failures = [result.issue for result in results if result.issue]
    if len(failures) == len(feeds) and not merged:
        raise next((error for error in failures if error.status in QUOTA_ERRORS), failures[0])
    notice = "Treg could not finish listing all uploads." if failures else None
    return merged, notice


def timestamp_segments(rows, start_key="start", scale=1):
    if not isinstance(rows, list):
        return []
    segments = []
    for row in rows:
        row = mapping(row)
        start = number(row.get(start_key))
        text = clean_text(row.get("text"), 2400)
        if start is not None and text:
            segments.append({"start": start / scale, "text": text})
    return sorted(segments, key=lambda cue: cue["start"])


def webvtt_segments(content):
    if not isinstance(content, str) or not content.lstrip("\ufeff \t\r\n").startswith("WEBVTT"):
        return []
    segments = []
    for block in re.split(r"(?:\r?\n)[ \t]*(?:\r?\n)", content.strip()):
        lines = block.splitlines()
        for index, line in enumerate(lines[:2]):
            if " --> " not in line:
                continue
            match = CAPTION_TIME.fullmatch(line.split(" --> ", 1)[0].strip())
            if match:
                h, m, s, ms = (int(unit or "0") for unit in match.groups())
                text = clean_text(unescape(re.sub(r"<[^>]*>", "", " ".join(lines[index + 1:]))), 2400)
                if text:
                    segments.append({"start": h * 3600 + m * 60 + s + ms / 1000, "text": text})
            break
    return sorted(segments, key=lambda cue: cue["start"])


def fetch_transcript(token, profile, video):
    platform, video_id = profile["platform"], video["id"]
    if platform == "YouTube":
        if not VIDEO_ID.fullmatch(video_id):
            raise ValueError("Invalid YouTube video ID.")
        data = call(token, YT_TRANSCRIPT, url=f"https://www.youtube.com/watch?v={video_id}")
        if data.get("videoId") not in (None, video_id):
            raise ProviderError(502)
        return timestamp_segments(data.get("transcript"), "startMs", 1000)
    if platform == "TikTok":
        if not TIKTOK_ID.fullmatch(video_id):
            raise ValueError("Invalid TikTok video ID.")
        handle = profile["handle"].lstrip("@")
        url = f"https://www.tiktok.com/@{handle}/video/{video_id}"
        data = call(token, TT_TRANSCRIPT, url=url, use_ai_as_fallback="false")
        if data.get("id") is not None and str(data["id"]) != video_id:
            raise ProviderError(502)
        return timestamp_segments(data.get("transcript_with_timestamp")) or webvtt_segments(data.get("transcript"))
    if platform == "Instagram":
        if not INSTAGRAM_ID.fullmatch(video_id):
            raise ValueError("Invalid Instagram video shortcode.")
        length = number(video.get("duration"))
        if length is not None and length > 120:
            return []
        path = "reel" if video.get("format") == "short" else "p"
        # The provider's fixed-price route is used only on selection. Do not opt in to long AI transcription.
        data = call(token, IG_TRANSCRIPT, url=f"https://www.instagram.com/{path}/{video_id}/")
        results = data.get("transcripts")
        for row in results if isinstance(results, list) else []:
            row = mapping(row)
            if row.get("shortcode") == video_id:
                return timestamp_segments(row.get("transcript_with_timestamp"))
        return []
    raise ValueError("Unsupported transcript platform.")


def provider_message(error, subject):
    if error.status in (401, 403):
        return "Treg rejected the server’s credentials or access to this profile."
    if error.status == 402:
        return "The Treg account is out of credits."
    if error.status == 429:
        return "Treg limited requests. Try again later."
    if error.status == 504:
        return f"Treg ran out of time while fetching {subject}."
    return f"Treg could not return {subject}."


def already_checked(existing):
    if not isinstance(existing, dict):
        return set(existing or ())
    return {key for key, value in existing.items() if (value.get("status") if isinstance(value, dict) else value)
            in {"ok", "no_captions"}}


def import_events(token, profile, existing=None, *, limit=MAX_VIDEOS, max_caption_calls=MAX_CAPTION_CALLS, time_budget=230):
    if isinstance(profile, str):
        profile = normalize_profile(profile)
    limit = max(1, min(MAX_VIDEOS, int(limit)))
    deadline = time.monotonic() + time_budget
    try:
        uploads, issue = list_uploads(token, profile, limit, deadline)
    except ProviderError as error:
        yield {"kind": "done", "failed": True, "message": provider_message(error, "this profile’s uploads")}
        return
    yield {"kind": "listed", "total": len(uploads)}
    yield {"kind": "videos", "videos": uploads, "partial": bool(issue)}
    skipped = already_checked(existing)
    fresh = [video for video in uploads if video["id"] not in skipped]
    if profile["platform"] == "Instagram":
        # Reels remain pending until a user opens one. A list import must not AI-transcribe the feed.
        yield {"kind": "done", "failed": bool(issue), "message": issue}
        return
    captions = fresh[:max(0, min(MAX_CAPTION_CALLS, int(max_caption_calls)))]
    if len(captions) < len(fresh) and not issue:
        issue = "Some transcripts are still waiting to be checked."
    with ThreadPoolExecutor(max_workers=CAPTION_CONCURRENCY) as pool:
        for offset in range(0, len(captions), CAPTION_CONCURRENCY):
            if time.monotonic() + 17 > deadline:
                issue = "The import ran out of time. Any saved captions are still available."
                break
            batch = {pool.submit(fetch_transcript, token, profile, row): row
                     for row in captions[offset:offset + CAPTION_CONCURRENCY]}
            stopped = False
            for future in as_completed(batch):
                row = batch[future]
                try:
                    segments = future.result()
                    status = "ok" if segments else "no_captions"
                except ProviderError as error:
                    issue = provider_message(error, "all captions")
                    stopped |= error.status in QUOTA_ERRORS
                    segments, status = [], "provider_error"
                yield {"kind": "item", "video": {**row, "status": status}, "segments": segments}
            if stopped:
                break
    yield {"kind": "done", "failed": bool(issue), "message": issue}
