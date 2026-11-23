import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from requests import Session
from youtube_transcript_api import IpBlocked, RequestBlocked, YouTubeTranscriptApi
from yt_dlp import YoutubeDL


class TimedSession(Session):
    def request(self, *args, **kwargs):
        kwargs.setdefault("timeout", (4, 8))
        return super().request(*args, **kwargs)


def listing(url, count):
    with YoutubeDL({"extract_flat": "in_playlist", "playlistend": count, "quiet": True,
                    "socket_timeout": 8, "extractor_retries": 0, "retries": 0}) as ydl:
        return ydl.extract_info(url, download=False)


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def import_events(url, limit, output=None):
    started = time.monotonic()
    direct = re.fullmatch(r"https://www.youtube.com/channel/(UC[A-Za-z0-9_-]{22})", url)
    if direct:
        channel_id = direct.group(1)
    else:
        identity = listing(url + "/videos", 1)
        channel_id = identity.get("channel_id") or identity.get("id")
    if not channel_id or not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel_id):
        yield {"kind": "done", "failed": True, "message": "This YouTube channel could not be found."}
        return
    uploads = listing("https://www.youtube.com/playlist?list=UU" + channel_id[2:], limit)
    items = {entry["id"]: entry for entry in uploads.get("entries", [])
             if entry and re.fullmatch(r"[A-Za-z0-9_-]{11}", entry.get("id", ""))}
    yield {"kind": "listed", "total": len(items)}
    rows = []
    blocked = False
    timed_out = False

    def persist():
        if output is None:
            return
        write_json(output / "manifest.json", {
            "channel_id": channel_id, "channel_url": url,
            "generated_at": datetime.now(timezone.utc).isoformat(), "videos": rows,
        })

    with TimedSession() as session:
        transcript_api = YouTubeTranscriptApi(http_client=session)
        for video_id, entry in items.items():
            segments = []
            row = {"id": video_id, "title": entry.get("title") or "Untitled video",
                   "status": "pending", "duration_seconds": entry.get("duration"),
                   "upload_date": entry.get("upload_date"),
                   "url": f"https://www.youtube.com/watch?v={video_id}"}
            if blocked:
                row["status"] = "skipped_after_block"
            elif timed_out or time.monotonic() - started > 135:
                row["status"] = "not_checked"
                timed_out = True
            else:
                try:
                    transcript = transcript_api.fetch(video_id, languages=["en", "en-US", "en-GB"])
                    segments = [{"text": x.text, "start": x.start, "duration": x.duration,
                                 "end": round(x.start + x.duration, 3)} for x in transcript]
                    if not segments:
                        row["status"] = "empty"
                    else:
                        row.update(status="ok", language=transcript.language_code,
                                   generated=transcript.is_generated, segment_count=len(segments),
                                   transcript=f"{video_id}.json")
                        if output is not None:
                            write_json(output / row["transcript"], {**row, "segments": segments})
                except (IpBlocked, RequestBlocked) as error:
                    blocked = True
                    row["status"] = type(error).__name__
                except Exception as error:
                    row["status"] = type(error).__name__
            rows.append(row)
            persist()
            yield {"kind": "item", "video": row, **({"segments": segments} if output is None and row["status"] == "ok" else {})}

    persist()
    yield {"kind": "done", "blocked": blocked, "timedOut": timed_out}


def run(url, output, limit):
    for event in import_events(url, limit, output):
        print(json.dumps(event, ensure_ascii=False), flush=True)
    return int(event.get("failed", False))


if __name__ == "__main__":
    try:
        exit_code = run(sys.argv[1], None if sys.argv[2] == "-" else Path(sys.argv[2]), int(sys.argv[3]))
    except Exception:
        print(json.dumps({"kind": "done", "failed": True, "message": "YouTube could not list uploads for this channel."}), flush=True)
        exit_code = 1
    sys.exit(exit_code)
