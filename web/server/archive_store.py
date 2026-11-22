import json
import os
import re
import sqlite3
import time
import unicodedata
from collections import deque
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


def key_for(profile):
    url = profile["url"]
    return url if "/channel/" in url else url.lower()


def capacity(profile):
    return 200 if profile["platform"] == "YouTube" else 100


def latest(profile, inventory):
    ordered = sorted(inventory, key=lambda item: item.get("publishedAt") or "", reverse=True)
    if profile["platform"] != "YouTube":
        return ordered[:100]
    counts = {"short": 0, "video": 0}
    result = []
    for video in ordered:
        kind = "short" if video.get("format") == "short" else "video"
        if counts[kind] < 100:
            result.append(video)
            counts[kind] += 1
    return result


class ArchiveStore:
    @contextmanager
    def connect(self):
        dsn = os.environ.get("DATABASE_URL")
        if dsn:
            import psycopg
            db = psycopg.connect(dsn, connect_timeout=6)
        elif os.environ.get("VERCEL"):
            raise RuntimeError("Archive storage is not configured.")
        else:
            path = Path(os.environ.get("RESURFACE_ARCHIVE_DB",
                        Path(__file__).resolve().parents[2] / ".cache" / "live-archive.sqlite3"))
            path.parent.mkdir(parents=True, exist_ok=True)
            db = sqlite3.connect(path, timeout=5)
        try:
            def sql(query, values=()):
                return db.execute(query.replace("?", "%s") if dsn else query, values)
            yield sql
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def setup(self):
        with self.connect() as sql:
            sql("""CREATE TABLE IF NOT EXISTS resurface_archives (
                profile_key TEXT PRIMARY KEY, lease TEXT NOT NULL, lease_until BIGINT NOT NULL,
                saved_at BIGINT NOT NULL, message TEXT NOT NULL)""")
            sql("""CREATE TABLE IF NOT EXISTS resurface_videos (
                profile_key TEXT NOT NULL, video_id TEXT NOT NULL, position INTEGER NOT NULL,
                metadata TEXT NOT NULL, status TEXT NOT NULL, segments TEXT NOT NULL,
                PRIMARY KEY (profile_key, video_id))""")
            sql("""CREATE TABLE IF NOT EXISTS resurface_caption_claims (
                profile_key TEXT NOT NULL, video_id TEXT NOT NULL, lease_until BIGINT NOT NULL,
                PRIMARY KEY (profile_key, video_id))""")

    def claim(self, profile, refresh):
        key, now, lease = key_for(profile), int(time.time()), uuid4().hex
        with self.connect() as sql:
            return sql("""INSERT INTO resurface_archives
                (profile_key, lease, lease_until, saved_at, message) VALUES (?, ?, ?, 0, '')
                ON CONFLICT (profile_key) DO UPDATE SET lease=excluded.lease, lease_until=excluded.lease_until
                WHERE resurface_archives.lease_until < ?
                  AND (resurface_archives.saved_at=0 OR ?=1)
                RETURNING lease""", (key, lease, now + 310, now, int(refresh))).fetchone() is not None and lease or None

    def snapshot(self, profile):
        key = key_for(profile)
        with self.connect() as sql:
            archive = sql("SELECT saved_at, lease_until, message FROM resurface_archives WHERE profile_key=?", (key,)).fetchone()
            if archive is None:
                return None
            rows = sql("""SELECT metadata, status FROM resurface_videos WHERE profile_key=? AND position<?
                          ORDER BY position LIMIT 200""", (key, capacity(profile))).fetchall()
        saved_at, lease_until, message = archive
        return {"profile": profile, "savedAt": saved_at or None, "importing": lease_until > time.time(),
                "message": message, "videos": [{**json.loads(data), "status": status} for data, status in rows]}

    def inventory(self, profile, videos, partial=False):
        key = key_for(profile)
        with self.connect() as sql:
            if partial:
                old = sql("SELECT metadata FROM resurface_videos WHERE profile_key=? AND position<?",
                          (key, capacity(profile))).fetchall()
                merged = {video["id"]: video for (data,) in old if (video := json.loads(data))}
                merged.update({video["id"]: video for video in videos})
                videos = list(merged.values())
            sql("UPDATE resurface_videos SET position=200 WHERE profile_key=?", (key,))
            for index, video in enumerate(latest(profile, videos)):
                sql("""INSERT INTO resurface_videos (profile_key, video_id, position, metadata, status, segments)
                    VALUES (?, ?, ?, ?, 'pending', '[]')
                    ON CONFLICT (profile_key, video_id) DO UPDATE SET position=excluded.position, metadata=excluded.metadata""",
                    (key, video["id"], index, json.dumps(video)))

    def record(self, profile, video, segments):
        with self.connect() as sql:
            sql("""UPDATE resurface_videos SET status=?, segments=? WHERE profile_key=? AND video_id=?""",
                (video["status"], json.dumps(segments), key_for(profile), video["id"]))

    def finish(self, profile, lease, inventoried, message):
        now = int(time.time()) if inventoried else 0
        with self.connect() as sql:
            sql("""UPDATE resurface_archives SET lease='', lease_until=0,
                saved_at=CASE WHEN ?>0 THEN ? ELSE saved_at END, message=?
                WHERE profile_key=? AND lease=?""", (now, now, message or "", key_for(profile), lease))

    def transcript(self, profile, video_id):
        with self.connect() as sql:
            row = sql("SELECT status, segments FROM resurface_videos WHERE profile_key=? AND video_id=? AND position<?",
                      (key_for(profile), video_id, capacity(profile))).fetchone()
        return {"status": row[0], "segments": json.loads(row[1])} if row else None

    def video(self, profile, video_id):
        with self.connect() as sql:
            row = sql("SELECT metadata, status FROM resurface_videos WHERE profile_key=? AND video_id=? AND position<?",
                      (key_for(profile), video_id, capacity(profile))).fetchone()
        return {**json.loads(row[0]), "status": row[1]} if row else None

    def claim_caption(self, profile, video_id):
        now = int(time.time())
        with self.connect() as sql:
            return sql("""INSERT INTO resurface_caption_claims (profile_key, video_id, lease_until)
                VALUES (?, ?, ?) ON CONFLICT (profile_key, video_id) DO UPDATE SET lease_until=excluded.lease_until
                WHERE resurface_caption_claims.lease_until < ? RETURNING video_id""",
                (key_for(profile), video_id, now + 65, now)).fetchone() is not None

    def release_caption(self, profile, video_id):
        with self.connect() as sql:
            sql("DELETE FROM resurface_caption_claims WHERE profile_key=? AND video_id=?", (key_for(profile), video_id))

    def find(self, profile, term):
        words = normalize(term).split()
        if not words:
            return []
        with self.connect() as sql:
            rows = sql("""SELECT metadata, segments FROM resurface_videos
                WHERE profile_key=? AND position<? AND status='ok' ORDER BY position LIMIT 200""",
                (key_for(profile), capacity(profile))).fetchall()
        result = []
        for video, raw_segments in rows:
            meta = json.loads(video)
            previous = None
            recent = deque(maxlen=len(words))
            seen = set()
            for line in json.loads(raw_segments):
                if previous is not None and line["start"] - previous["start"] > 8:
                    recent.clear()
                for word in normalize(line["text"]).split():
                    recent.append((word, line))
                    if word != words[-1] or len(recent) != len(words):
                        continue
                    if any(expected != actual for expected, (actual, _) in zip(words, recent)):
                        continue
                    start = recent[0][1]["start"]
                    if start in seen:
                        continue
                    seen.add(start)
                    matched_cues = []
                    for _, cue in recent:
                        if not matched_cues or matched_cues[-1] is not cue:
                            matched_cues.append(cue)
                    result.append({"id": meta["id"], "title": meta["title"], "start": start,
                                   "text": " ".join(cue["text"] for cue in matched_cues)})
                    if len(result) >= 20:
                        return result
                previous = line
        return result


def normalize(text):
    return re.sub(r"[\W_]+", " ", unicodedata.normalize("NFKC", text).lower()).strip()
