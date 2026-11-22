import json
import logging
import os
import re
from hashlib import sha256
from ipaddress import ip_address
from threading import Thread
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from server.archive_store import ArchiveStore
from server.treg_archive import ProviderError, fetch_transcript, import_events, normalize_profile, provider_message

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
store = ArchiveStore()
logger = logging.getLogger(__name__)
VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{1,80}")


def reply(data, status=200):
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def error(message, status):
    return reply({"error": message}, status)


def public_quota(headers, kind):
    if os.environ.get("VERCEL_ENV") != "production":
        return None
    forwarded = headers.get("x-vercel-forwarded-for") or headers.get("x-forwarded-for", "")
    try:
        ip = str(ip_address(forwarded))
    except ValueError:
        ip = "unknown"
    retry = store.consume_public_quota(kind, sha256(ip.encode()).hexdigest())
    if retry:
        return JSONResponse({"error": "Daily archive limit reached. Try again tomorrow (UTC)."},
                            status_code=429, headers={"Cache-Control": "no-store", "Retry-After": str(retry)})
    return None


def payload(event):
    return json.dumps(event, ensure_ascii=False) + "\n"


def stream(token, profile, lease, existing):
    inventoried, message = False, "Import stopped. Check for new videos to retry."
    done = {"kind": "done", "failed": True, "message": message}
    try:
        yield payload({"kind": "start", "profile": profile})
        for event in import_events(token, profile, existing=existing):
            kind = event["kind"]
            if kind == "videos":
                store.inventory(profile, event["videos"], partial=event.get("partial", False))
                inventoried = True
                yield payload({**event, "videos": store.snapshot(profile)["videos"]})
            elif kind == "item":
                store.record(profile, event["video"], event["segments"])
                # Captions are read separately for the video the user selects.
                yield payload({"kind": "item", "video": event["video"]})
            elif kind == "done":
                done = event
                message = event.get("message")
            else:
                yield payload(event)
    except Exception as exc:
        logger.error("Archive import failed: %s", type(exc).__name__)
    finally:
        store.finish(profile, lease, inventoried, message)
    yield payload(done)


def run_local_import(token, profile, lease, existing):
    try:
        for _ in stream(token, profile, lease, existing):
            pass
    except Exception as exc:
        logger.error("Background archive import failed: %s", type(exc).__name__)


def load_caption(profile, video_id, token, headers):
    if not VIDEO_ID.fullmatch(video_id):
        return error("Invalid video.", 400)
    store.setup()
    video = store.video(profile, video_id)
    if video is None:
        return error("This video isn’t in the saved archive.", 404)
    if video["status"] in ("ok", "no_captions"):
        return reply(store.transcript(profile, video_id))
    if profile["platform"] != "Instagram" and (store.snapshot(profile) or {}).get("importing"):
        return reply({"status": "pending", "segments": []}, 202)
    if not token:
        return error("Treg is not configured.", 503)
    if not store.claim_caption(profile, video_id):
        return reply({"status": "pending", "segments": []}, 202)
    try:
        result = store.transcript(profile, video_id)
        if result and result["status"] in ("ok", "no_captions"):
            return reply(result)
        limited = public_quota(headers, "caption")
        if limited is not None:
            return limited
        segments = fetch_transcript(token, profile, video)
        status = "ok" if segments else "no_captions"
        store.record(profile, {**video, "status": status}, segments)
        return reply({"status": status, "segments": segments})
    except ProviderError as exc:
        store.record(profile, {**video, "status": "provider_error"}, [])
        return error(provider_message(exc, "this transcript"), 502)
    finally:
        store.release_caption(profile, video_id)


@app.get("/api/import_youtube")
def read_archive(profile: str = "", video: str = "", q: str = ""):
    try:
        account = normalize_profile(profile)
    except (ValueError, TypeError):
        return error("Enter a public YouTube, TikTok, or Instagram profile URL.", 400)
    if (video and not VIDEO_ID.fullmatch(video)) or len(q) > 120:
        return error("Invalid video or transcript search.", 400)
    try:
        store.setup()
        if video:
            result = store.transcript(account, video)
        elif q:
            return reply({"matches": store.find(account, q)})
        else:
            result = store.snapshot(account)
        return reply(result) if result is not None else error("Nothing saved for this profile yet.", 404)
    except Exception as exc:
        logger.error("Cannot read archive: %s", type(exc).__name__)
        return error("Archive storage isn’t available.", 503)


@app.post("/api/import_youtube")
async def update_archive(request: Request):
    origin = request.headers.get("origin")
    try:
        other_origin = origin and urlsplit(origin).netloc != request.headers.get("host")
    except ValueError:
        other_origin = True
    if request.headers.get("sec-fetch-site") == "cross-site" or other_origin:
        return error("This request must come from Resurface.", 403)
    try:
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 4096:
                return error("Request is too large.", 413)
            raw.extend(chunk)
        body = json.loads(raw)
        profile = normalize_profile(body.get("profileUrl"))
        refresh = body.get("refresh") is True
        video = body.get("video")
    except (ValueError, TypeError, AttributeError):
        return error("Enter a public YouTube, TikTok, or Instagram profile URL.", 400)
    try:
        if video is not None:
            if not isinstance(video, str):
                return error("Invalid video.", 400)
            return await run_in_threadpool(load_caption, profile, video, os.environ.get("TREG_API_KEY"), request.headers)
        await run_in_threadpool(store.setup)
        snapshot = await run_in_threadpool(store.snapshot, profile)
        if snapshot and (snapshot["importing"] or (snapshot["savedAt"] and not refresh)):
            return reply(snapshot)
        token = os.environ.get("TREG_API_KEY")
        if not token:
            return error("Treg is not configured.", 503)
        limited = await run_in_threadpool(public_quota, request.headers, "import")
        if limited is not None:
            return limited
        lease = await run_in_threadpool(store.claim, profile, refresh)
        if not lease:
            return reply(await run_in_threadpool(store.snapshot, profile))
    except Exception as exc:
        logger.error("Cannot start archive import: %s", type(exc).__name__)
        return error("Archive storage isn’t available.", 503)
    existing = {item["id"]: item["status"] for item in (snapshot or {}).get("videos", [])}
    if not os.environ.get("VERCEL"):
        Thread(target=run_local_import, args=(token, profile, lease, existing), daemon=True).start()
        return reply(await run_in_threadpool(store.snapshot, profile), 202)
    return StreamingResponse(stream(token, profile, lease, existing), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store"})
