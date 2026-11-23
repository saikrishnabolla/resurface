import json
import os
import re
import sqlite3
import time
import unicodedata
from collections import deque
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlencode, urlsplit
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


IMAGE_HOSTS = ("tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "tiktokv.com", "tiktokv.us", "tiktokv.eu",
               "byteoversea.com", "ibytedtos.com", "muscdn.com", "cdninstagram.com", "fbcdn.net", "ytimg.com")
MAX_IMAGE = 3_000_000


def fetch_image(url):
    import requests
    try:
        parsed = urlsplit(url or "")
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.port not in (None, 443) or parsed.username is not None or not any(
                host == allowed or host.endswith("." + allowed) for allowed in IMAGE_HOSTS):
            return None
    except ValueError:
        return None
    try:
        with requests.get(url, timeout=(3, 5), stream=True, allow_redirects=False,
                          headers={"User-Agent": "Mozilla/5.0"}) as reply:
            if reply.status_code != 200 or not reply.headers.get("content-type", "").startswith("image/"):
                return None
            body = bytearray()
            deadline = time.monotonic() + 7
            for chunk in reply.iter_content(65536):
                if len(body) + len(chunk) > MAX_IMAGE or time.monotonic() > deadline:
                    return None
                body.extend(chunk)
            return bytes(body)
    except requests.exceptions.RequestException:
        return None


def browser_image_type(body):
    """Only formats every browser can show. HEIC and others are refused."""
    if not body:
        return None
    if body[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if body[:4] == b"RIFF" and body[8:12] == b"WEBP":
        return "image/webp"
    return None


def proxied(profile, video, has_cover=False):
    """Platform image links expire and block hotlinking, so non-YouTube covers are served from our cache."""
    if profile["platform"] == "YouTube" or not (has_cover or video.get("thumbnail")):
        return video
    return {**video, "thumbnail": "/api/import_youtube?" + urlencode(
        {"profile": profile["url"], "thumb": video["id"]})}


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
                        Path(__file__).resolve().parents[1] / ".cache" / "live-archive.sqlite3"))
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
            sql("""CREATE TABLE IF NOT EXISTS resurface_covers (
                profile_key TEXT NOT NULL, video_id TEXT NOT NULL, image BYTEA NOT NULL,
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
            rows = sql("""SELECT metadata, status, c.video_id IS NOT NULL FROM resurface_videos v
                          LEFT JOIN resurface_covers c ON c.profile_key=v.profile_key AND c.video_id=v.video_id
                          WHERE v.profile_key=? AND position<? ORDER BY position LIMIT 200""",
                       (key, capacity(profile))).fetchall()
        saved_at, lease_until, message = archive
        return {"profile": profile, "savedAt": saved_at or None, "importing": lease_until > time.time(),
                "message": message, "videos": [{**proxied(profile, json.loads(data), cover), "status": status}
                                               for data, status, cover in rows]}

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

    def save_covers(self, profile, covers):
        """Save browser-safe images for existing archive rows without touching metadata or transcripts."""
        key = key_for(profile)
        saved = 0
        with self.connect() as sql:
            for video_id, image in covers:
                if not browser_image_type(image) or len(image) > MAX_IMAGE:
                    continue
                row = sql("""INSERT INTO resurface_covers (profile_key, video_id, image)
                    SELECT profile_key, video_id, ? FROM resurface_videos
                    WHERE profile_key=? AND video_id=? AND position<?
                    ON CONFLICT (profile_key, video_id) DO NOTHING RETURNING video_id""",
                    (image, key, video_id, capacity(profile))).fetchone()
                saved += bool(row)
        return saved

    def thumbnail(self, profile, video_id):
        with self.connect() as sql:
            row = sql("""SELECT metadata, image FROM resurface_videos v LEFT JOIN resurface_covers c
                         ON c.profile_key=v.profile_key AND c.video_id=v.video_id
                         WHERE v.profile_key=? AND v.video_id=? AND position<?""",
                      (key_for(profile), video_id, capacity(profile))).fetchone()
        if row is None:
            return None
        metadata, image = row
        if image:
            body = bytes(image)
            return body, browser_image_type(body)
        body = fetch_image(json.loads(metadata).get("thumbnail"))
        kind = browser_image_type(body)
        if not kind:
            return None
        self.save_covers(profile, [(video_id, body)])
        return body, kind

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

    def topics(self, profile):
        with self.connect() as sql:
            rows = sql("""SELECT metadata, segments FROM resurface_videos
                WHERE profile_key=? AND position<? AND status='ok' ORDER BY position LIMIT 200""",
                (key_for(profile), capacity(profile))).fetchall()
        return topic_graph(rows)

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

STOP = set("""about above after again all also always am an and any are around because been before being between both but can cant could did does doing dont down each even every few for from get gets getting go goes going gonna got had has have having her here hers him his how i id if im in into is it its ive just kind know let like little look lot made make many may maybe me might more most much must my need never not now of off okay on one only or other our out over own people really right said same say see she should so some something sort still such take than that thats the their them then there these they thing things think this those through too two up us very want was way we well were what when where which while who why will with would yeah yes you your youre actually basically literally gonna going wanna kinda stuff anything another next give myself stay tuned cuz sometimes low key everything nothing someone sometimes done tknow ofmine description box feel feeling feels music applause laughter hello beautiful morning quick quickly super excited cute child anyway definitely check comment below somebody last night real tiktok love work life good great better makes making content guys guy video videos today time times one two three first second back come comes came use used using go put pretty because cause also thank thanks hey hi welcome subscribe channel""".split())


TOPIC_STOP = STOP | set("""please totally different ago year years month months days week weeks
later recently tonight yesterday tomorrow honestly seriously genuinely truly super absolutely
pretty sorry welcome firstly secondly lastly don doesn didn won isn wasn weren aren hasn haven
couldn wouldn shouldn couldnve wouldnt shouldnt wasnt isnt couldnt doesnt didnt yall let's""".split())

NON_TOPICS = {"pro tip", "long story", "same thing", "every single", "full disclosure", "little bit"}


def topic_words(text):
    # Captions often spell contractions as "don t" or "don’t". Keep them out of topic candidates.
    text = re.sub(r"\b(don|doesn|didn|can|couldn|won|wouldn|shouldn|isn|aren|wasn|weren|hasn|haven)[’'\s]+t\b",
                  r"\1t", text, flags=re.IGNORECASE)
    return normalize(text).split()


def topic_graph(rows, limit=24):
    docs = []
    for video, raw in rows:
        meta = json.loads(video)
        words = []
        lines = json.loads(raw)
        previous = None
        for line in lines:
            if previous is not None and line["start"] - previous > 8:
                words.append(".")
            words.extend(topic_words(line["text"]))
            previous = line["start"]
        docs.append((meta, words, lines))
    df = {}
    for meta, words, _ in docs:
        counts = {}
        for i, w in enumerate(words):
            if len(w) > 3 and w not in TOPIC_STOP and w.isalpha():
                counts[w] = counts.get(w, 0) + 1
            if i and w != words[i - 1] and all(len(word) > 2 and word.isalpha() and word not in TOPIC_STOP
                                              for word in (w, words[i - 1])):
                key = words[i - 1] + " " + w
                if key not in NON_TOPICS:
                    counts[key] = counts.get(key, 0) + 1
        for term, n_said in counts.items():
            # Single words need stronger evidence than a phrase.
            if " " in term or n_said >= 8:
                df.setdefault(term, set()).add(meta["id"])
    n = max(len(docs), 1)
    ranked = sorted(((len(v) * (1 - len(v) / n) ** 2 * (2.2 if " " in t else 1.0), t) for t, v in df.items() if len(v) >= 3), reverse=True)
    chosen = []
    for _, term in ranked:
        clash = [c for c in chosen if " " in term and " " in c and set(term.split()) & set(c.split())
                 and len(df[term]) <= 2.6 * len(df[c]) and len(df[c]) <= 2.6 * len(df[term])]
        if clash:
            if len(df[term]) > max(len(df[c]) for c in clash):
                chosen = [c for c in chosen if c not in clash]
                chosen.append(term)
            continue
        if any(term in c.split() and len(df[c]) >= 0.6 * len(df[term]) for c in chosen if " " in c and term != c):
            continue
        if any(c in term.split() and len(df[term]) >= 0.6 * len(df[c]) for c in chosen if " " not in c and term != c):
            chosen = [c for c in chosen if not (" " not in c and c in term.split())]
        chosen.append(term)
        if len(chosen) >= limit:
            break
    patterns = {t: re.compile(r"\b" + r" ".join(map(re.escape, t.split())) + r"\b") for t in chosen}
    pair, nodes = {}, {t: {"term": t, "videos": len(df[t]), "mentions": 0, "sample": None} for t in chosen}
    for meta, words, lines in docs:
        text = " ".join(words)
        present = [t for t in chosen if meta["id"] in df[t]]
        for t in present:
            nodes[t]["mentions"] += len(patterns[t].findall(text))
            if nodes[t]["sample"] is None:
                for line in lines:
                    if patterns[t].search(normalize(line["text"])):
                        nodes[t]["sample"] = {"id": meta["id"], "title": meta["title"], "start": line["start"]}
                        break
        for i, a in enumerate(present):
            for b in present[i + 1:]:
                pair[(a, b)] = pair.get((a, b), 0) + 1
    links = [{"a": a, "b": b, "weight": n} for (a, b), n in pair.items() if n >= 2]
    return {"videoCount": len(docs), "topics": sorted(nodes.values(), key=lambda n: -n["videos"]),
            "links": sorted(links, key=lambda l: -l["weight"])[:80]}


def normalize(text):
    return re.sub(r"[\W_]+", " ", unicodedata.normalize("NFKC", text).lower()).strip()
