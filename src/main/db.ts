import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import type { Channel, Progress, SearchHit, SearchResult, Segment, Video, VideoType } from '@shared/types'

let db: Database.Database

export function openDb(): Database.Database {
  const file = join(app.getPath('userData'), 'archive.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT,
      url TEXT NOT NULL,
      description TEXT,
      thumbnail TEXT,
      last_imported INTEGER
    );
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      thumbnail TEXT,
      upload_date TEXT,
      date_exact INTEGER NOT NULL DEFAULT 0,
      duration REAL,
      view_count INTEGER,
      video_type TEXT NOT NULL,
      transcript_status TEXT NOT NULL DEFAULT 'pending',
      status_message TEXT,
      language TEXT,
      generated INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      rank INTEGER
    );
    CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id, rank);
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start REAL NOT NULL,
      duration REAL NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS segments_video ON segments(video_id, idx);
    -- Searchable passages: a few consecutive segments joined, so phrases that
    -- straddle caption boundaries still match. Each chunk keeps the segment
    -- range and per-segment character offsets for exact timestamps.
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      seg_start INTEGER NOT NULL,
      seg_end INTEGER NOT NULL,
      start REAL NOT NULL,
      offsets TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chunks_video ON chunks(video_id, seg_start);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text, content='chunks', content_rowid='id', tokenize="unicode61 remove_diacritics 2"
    );
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_aliases (
      alias TEXT PRIMARY KEY,            -- normalized channel URL the user typed
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE
    );
    -- One row per provider request, for latency / rate-limit instrumentation.
    CREATE TABLE IF NOT EXISTS fetch_log (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      video_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      outcome TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      cost_micro INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS fetch_log_ts ON fetch_log(ts);
  `)
  const cols = new Set((db.prepare(`PRAGMA table_info(videos)`).all() as any[]).map((c) => c.name))
  if (!cols.has('fetched_at')) db.exec(`ALTER TABLE videos ADD COLUMN fetched_at INTEGER`)
  if (!cols.has('last_attempt_at')) db.exec(`ALTER TABLE videos ADD COLUMN last_attempt_at INTEGER`)
  if (!cols.has('platform')) db.exec(`ALTER TABLE videos ADD COLUMN platform TEXT NOT NULL DEFAULT 'youtube'`)
  const chCols = new Set((db.prepare(`PRAGMA table_info(channels)`).all() as any[]).map((c) => c.name))
  if (!chCols.has('platform')) db.exec(`ALTER TABLE channels ADD COLUMN platform TEXT NOT NULL DEFAULT 'youtube'`)
  const logCols = new Set((db.prepare(`PRAGMA table_info(fetch_log)`).all() as any[]).map((c) => c.name))
  if (!logCols.has('cost_micro')) db.exec(`ALTER TABLE fetch_log ADD COLUMN cost_micro INTEGER NOT NULL DEFAULT 0`)

  // Channels imported with a larger limit by an older build: keep only 100
  // (long-form first, newest first) so leftover jobs aren't resumed.
  db.exec(`
    UPDATE videos SET rank = NULL WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY video_type='short', rank) AS n
        FROM videos WHERE rank IS NOT NULL
      ) WHERE n > 100
    );
  `)

  // An app quit mid-request leaves rows "processing": put them back in line.
  db.prepare(`UPDATE videos SET transcript_status='pending' WHERE transcript_status='processing'`).run()
  return db
}

// ---------------------------------------------------------------------------
// Row mapping

interface VideoRow {
  id: string
  platform: Video['platform']
  channel_id: string
  title: string
  url: string
  thumbnail: string
  upload_date: string | null
  date_exact: number
  duration: number | null
  view_count: number | null
  video_type: VideoType
  transcript_status: Video['status']
  status_message: string | null
  language: string | null
  generated: number
  source: string | null
  fetched_at: number | null
  rank: number
}

const toVideo = (r: VideoRow): Video => ({
  id: r.id,
  platform: r.platform ?? 'youtube',
  channelId: r.channel_id,
  title: r.title,
  url: r.url,
  thumbnail: r.thumbnail,
  uploadDate: r.upload_date,
  dateExact: !!r.date_exact,
  duration: r.duration,
  viewCount: r.view_count,
  type: r.video_type,
  status: r.transcript_status,
  statusMessage: r.status_message,
  language: r.language,
  generated: !!r.generated,
  source: r.source,
  fetchedAt: r.fetched_at,
  rank: r.rank
})

export function listChannels(): Channel[] {
  return db
    .prepare(`SELECT * FROM channels ORDER BY last_imported DESC`)
    .all()
    .map((r: any) => ({
      id: r.id,
      platform: r.platform ?? 'youtube',
      name: r.name,
      handle: r.handle,
      url: r.url,
      description: r.description ?? '',
      thumbnail: r.thumbnail,
      lastImported: r.last_imported
    }))
}

export function getVideos(channelId: string): Video[] {
  return (
    db.prepare(`SELECT * FROM videos WHERE channel_id=? AND rank IS NOT NULL ORDER BY rank`).all(channelId) as VideoRow[]
  ).map(toVideo)
}

export function getVideo(videoId: string): Video | null {
  const r = db.prepare(`SELECT * FROM videos WHERE id=?`).get(videoId) as VideoRow | undefined
  return r ? toVideo(r) : null
}

export function getSegments(videoId: string): Segment[] {
  return db
    .prepare(`SELECT idx, start, duration, text FROM segments WHERE video_id=? ORDER BY idx`)
    .all(videoId) as Segment[]
}

export function getProgress(channelId: string): Omit<Progress, 'active' | 'paused'> {
  const r = db
    .prepare(
      `SELECT COUNT(*) total,
         SUM(transcript_status='available') available,
         SUM(transcript_status='unavailable') unavailable,
         SUM(transcript_status='failed') failed
       FROM videos WHERE channel_id=? AND rank IS NOT NULL`
    )
    .get(channelId) as any
  const available = r.available ?? 0
  const unavailable = r.unavailable ?? 0
  const failed = r.failed ?? 0
  return { channelId, total: r.total ?? 0, available, unavailable, failed, processed: available + unavailable + failed }
}

// ---------------------------------------------------------------------------
// Catalog writes

export interface CatalogVideo {
  id: string
  title: string
  url: string
  thumbnail: string
  timestamp: number | null
  duration: number | null
  view_count: number | null
  type: VideoType
}

export interface CatalogChannel {
  id: string
  platform?: 'youtube' | 'tiktok' | 'instagram'
  name: string
  handle: string | null
  url: string
  description: string
  thumbnail: string | null
}

export function saveCatalog(ch: CatalogChannel, videos: CatalogVideo[]): void {
  const upCh = db.prepare(`
    INSERT INTO channels (id, platform, name, handle, url, description, thumbnail, last_imported)
    VALUES (@id, @platform, @name, @handle, @url, @description, @thumbnail, @now)
    ON CONFLICT(id) DO UPDATE SET platform=excluded.platform, name=excluded.name, handle=excluded.handle, url=excluded.url,
      description=excluded.description, thumbnail=COALESCE(excluded.thumbnail, channels.thumbnail),
      last_imported=excluded.last_imported`)
  const clearRank = db.prepare(`UPDATE videos SET rank=NULL WHERE channel_id=?`)
  const upV = db.prepare(`
    INSERT INTO videos (id, platform, channel_id, title, url, thumbnail, upload_date, date_exact, duration, view_count, video_type, rank)
    VALUES (@id, @platform, @channel_id, @title, @url, @thumbnail, @upload_date, @date_exact, @duration, @view_count, @type, @rank)
    ON CONFLICT(id) DO UPDATE SET platform=excluded.platform, channel_id=excluded.channel_id, title=excluded.title, url=excluded.url,
      thumbnail=CASE WHEN videos.thumbnail LIKE 'resurface-thumb:%' THEN videos.thumbnail ELSE excluded.thumbnail END,
      upload_date=CASE WHEN videos.date_exact=1 THEN videos.upload_date ELSE excluded.upload_date END,
      duration=COALESCE(excluded.duration, videos.duration),
      view_count=COALESCE(excluded.view_count, videos.view_count),
      video_type=excluded.video_type, rank=excluded.rank`)
  db.transaction(() => {
    const platform = ch.platform ?? 'youtube'
    upCh.run({ ...ch, platform, now: Date.now() })
    clearRank.run(ch.id)
    videos.forEach((v, i) =>
      upV.run({
        id: v.id,
        platform,
        channel_id: ch.id,
        // TikTok/Instagram give exact post times; YouTube's flat listing is approximate.
        date_exact: platform === 'youtube' ? 0 : 1,
        title: v.title,
        url: v.url,
        thumbnail: v.thumbnail,
        upload_date: v.timestamp ? new Date(v.timestamp * 1000).toISOString().slice(0, 10) : null,
        duration: v.duration,
        view_count: v.view_count,
        type: v.type,
        rank: i
      })
    )
  })()
}

/** Videos in the current import set that still need a transcript, newest first. */
export function pendingVideoIds(channelId: string, includeFailed: boolean): string[] {
  const statuses = includeFailed ? `('pending','processing','failed')` : `('pending','processing')`
  return (
    db
      // Long-form before Shorts, newest first within each.
      .prepare(
        `SELECT id FROM videos WHERE channel_id=? AND rank IS NOT NULL AND transcript_status IN ${statuses}
         ORDER BY video_type='short', rank`
      )
      .all(channelId) as { id: string }[]
  ).map((r) => r.id)
}

export function channelsWithPending(): string[] {
  return (
    db
      .prepare(`SELECT DISTINCT channel_id FROM videos WHERE rank IS NOT NULL AND transcript_status IN ('pending','processing')`)
      .all() as { channel_id: string }[]
  ).map((r) => r.channel_id)
}

export function setStatus(videoId: string, status: Video['status'], message: string | null = null): void {
  db.prepare(`UPDATE videos SET transcript_status=?, status_message=? WHERE id=?`).run(status, message, videoId)
}

/** Keep the existing transcript visible while a user-requested refresh runs. */
export function setStatusMessage(videoId: string, message: string | null): void {
  db.prepare(`UPDATE videos SET status_message=? WHERE id=?`).run(message, videoId)
}

export function touchAttempt(videoId: string): void {
  db.prepare(`UPDATE videos SET last_attempt_at=? WHERE id=?`).run(Date.now(), videoId)
}

export function logFetch(videoId: string, provider: string, outcome: string, latencyMs: number, costMicro = 0): void {
  db.prepare(
    `INSERT INTO fetch_log (ts, video_id, provider, outcome, latency_ms, cost_micro) VALUES (?,?,?,?,?,?)`
  ).run(Date.now(), videoId, provider, outcome, Math.round(latencyMs), Math.round(costMicro))
}

export interface ProviderStatRow {
  provider: string
  requests: number
  ok: number
  unavailable: number
  rateLimited: number
  errors: number
  avgOkMs: number | null
  costMicro: number
}

export function providerStats(sinceTs: number): ProviderStatRow[] {
  return db
    .prepare(
      `SELECT provider, COUNT(*) requests,
         SUM(outcome='ok') ok, SUM(outcome='unavailable') unavailable,
         SUM(outcome='rate_limited') rateLimited, SUM(outcome IN ('temporary','disabled')) errors,
         AVG(CASE WHEN outcome='ok' THEN latency_ms END) avgOkMs, COALESCE(SUM(cost_micro),0) costMicro
       FROM fetch_log WHERE ts >= ? GROUP BY provider`
    )
    .all(sinceTs) as ProviderStatRow[]
}

export function tregSpend(sinceTs = 0): { calls: number; billedCalls: number; spentMicro: number } {
  return db
    .prepare(
      `SELECT COUNT(*) calls, COALESCE(SUM(cost_micro > 0), 0) billedCalls, COALESCE(SUM(cost_micro), 0) spentMicro
       FROM fetch_log WHERE provider LIKE 'treg%' AND ts >= ?`
    )
    .get(sinceTs) as any
}

export function setThumbnail(videoId: string, thumb: string): void {
  db.prepare(`UPDATE videos SET thumbnail=? WHERE id=?`).run(thumb, videoId)
}

export function setChannelThumbnail(channelId: string, thumb: string): void {
  db.prepare(`UPDATE channels SET thumbnail=? WHERE id=?`).run(thumb, channelId)
}

export function channelPlatform(channelId: string): 'youtube' | 'tiktok' | 'instagram' {
  return ((db.prepare(`SELECT platform FROM channels WHERE id=?`).get(channelId) as any)?.platform ?? 'youtube') as any
}

export function channelForAlias(alias: string): string | null {
  const r = db.prepare(`SELECT channel_id FROM channel_aliases WHERE alias=?`).get(alias) as any
  if (r) return r.channel_id
  // Also match a known @handle or channel id directly.
  const h = alias.match(/youtube\.com\/(@[^/]+)$/i)?.[1]
  if (h) {
    const c = db.prepare(`SELECT id FROM channels WHERE lower(handle)=lower(?)`).get(h) as any
    if (c) return c.id
  }
  const id = alias.match(/\/channel\/(UC[A-Za-z0-9_-]{22})$/)?.[1]
  if (id && db.prepare(`SELECT 1 FROM channels WHERE id=?`).get(id)) return id
  return null
}

export function saveAlias(alias: string, channelId: string): void {
  db.prepare(`INSERT OR REPLACE INTO channel_aliases (alias, channel_id) VALUES (?, ?)`).run(alias, channelId)
}

export function countByStatus(channelId: string): { available: number; total: number } {
  return db
    .prepare(
      `SELECT COUNT(*) total, COALESCE(SUM(transcript_status='available'),0) available
       FROM videos WHERE channel_id=? AND rank IS NOT NULL`
    )
    .get(channelId) as any
}

export function videoTitles(channelId: string): { id: string; title: string; rank: number }[] {
  return db
    .prepare(`SELECT id, title, rank FROM videos WHERE channel_id=? AND rank IS NOT NULL`)
    .all(channelId) as any[]
}

export function bumpAttempts(videoId: string): number {
  db.prepare(`UPDATE videos SET attempts=attempts+1 WHERE id=?`).run(videoId)
  return (db.prepare(`SELECT attempts FROM videos WHERE id=?`).get(videoId) as any).attempts
}

export function resetAttempts(videoId: string): void {
  db.prepare(`UPDATE videos SET attempts=0 WHERE id=?`).run(videoId)
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const CHUNK_CHARS = 280
const CHUNK_SECONDS = 30

export interface TranscriptPayload {
  segments: { start: number; duration: number; text: string }[]
  language: string | null
  generated: boolean | null
  source: string
  upload_date: string | null
}

/** Store a transcript and index it, all in one transaction. */
export function saveTranscript(videoId: string, t: TranscriptPayload): void {
  const delSeg = db.prepare(`DELETE FROM segments WHERE video_id=?`)
  const delChunk = db.prepare(`DELETE FROM chunks WHERE video_id=?`)
  const insSeg = db.prepare(`INSERT INTO segments (video_id, idx, start, duration, text) VALUES (?,?,?,?,?)`)
  const insChunk = db.prepare(
    `INSERT INTO chunks (video_id, seg_start, seg_end, start, offsets, text) VALUES (?,?,?,?,?,?)`
  )
  const upd = db.prepare(`
    UPDATE videos SET transcript_status='available', status_message=NULL, language=?, generated=?, source=?, attempts=0,
      fetched_at=CAST(strftime('%s','now') AS INTEGER)*1000,
      upload_date=COALESCE(?, upload_date), date_exact=CASE WHEN ? IS NOT NULL THEN 1 ELSE date_exact END
    WHERE id=?`)

  db.transaction(() => {
    delChunk.run(videoId)
    delSeg.run(videoId)
    let cStart = -1
    let cText = ''
    let cOffsets: [number, number, number][] = [] // [char offset, segment idx, start]
    let cTime = 0
    const flush = (end: number) => {
      if (cStart >= 0 && cText) insChunk.run(videoId, cStart, end, cTime, JSON.stringify(cOffsets), cText)
      cStart = -1
      cText = ''
      cOffsets = []
    }
    t.segments.forEach((s, i) => {
      insSeg.run(videoId, i, s.start, s.duration, s.text)
      const text = norm(s.text)
      if (!text) return
      if (cStart < 0) {
        cStart = i
        cTime = s.start
      }
      cOffsets.push([cText ? cText.length + 1 : 0, i, s.start])
      cText = cText ? cText + ' ' + text : text
      if (cText.length >= CHUNK_CHARS || s.start + s.duration - cTime >= CHUNK_SECONDS) flush(i)
    })
    flush(t.segments.length - 1)
    upd.run(t.language, t.generated ? 1 : 0, t.source, t.upload_date, t.upload_date, videoId)
  })()
}

export function deleteChannel(channelId: string): void {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM chunks WHERE video_id IN (SELECT id FROM videos WHERE channel_id=?)`
    ).run(channelId)
    db.prepare(`DELETE FROM segments WHERE video_id IN (SELECT id FROM videos WHERE channel_id=?)`).run(channelId)
    db.prepare(`DELETE FROM videos WHERE channel_id=?`).run(channelId)
    db.prepare(`DELETE FROM channels WHERE id=?`).run(channelId)
  })()
}

// ---------------------------------------------------------------------------
// Search

/**
 * Turn user input into a safe FTS5 query.
 *  - "quoted text" -> exact phrase
 *  - bare words    -> each must appear (AND)
 *  - word*         -> prefix match
 *  - OR between terms is passed through
 */
export function buildFtsQuery(input: string): string {
  const parts: string[] = []
  const re = /"([^"]*)"?|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m[1] !== undefined) {
      const phrase = m[1].replace(/"/g, ' ').trim()
      if (phrase) parts.push(`"${phrase}"`)
    } else {
      let w = m[2]
      if (w === 'OR') {
        if (parts.length && parts[parts.length - 1] !== 'OR') parts.push('OR')
        continue
      }
      const prefix = w.endsWith('*')
      w = w.replace(/["*]/g, '')
      // Skip pure punctuation (would make an empty phrase).
      if (!/[\p{L}\p{N}]/u.test(w)) continue
      parts.push(`"${w}"${prefix ? '*' : ''}`)
    }
  }
  while (parts[parts.length - 1] === 'OR') parts.pop()
  if (parts[0] === 'OR') parts.shift()
  return parts.join(' ')
}

const CONTEXT = 90

export function search(channelId: string, input: string, type: 'all' | VideoType): SearchResult {
  const t0 = performance.now()
  const q = buildFtsQuery(input)
  if (!q) return { hits: [], total: 0, videoCount: 0, error: null, ms: 0 }
  const typeSql = type === 'all' ? '' : `AND v.video_type = @type`
  const where = `chunks_fts MATCH @q AND v.channel_id=@channelId AND v.rank IS NOT NULL
                 AND v.transcript_status='available' ${typeSql}`
  try {
    const rows = db
      .prepare(
        `SELECT c.id, c.video_id, c.seg_start, c.start, c.offsets,
                highlight(chunks_fts, 0, char(1), char(2)) AS h,
                v.title, v.thumbnail, v.upload_date, v.video_type, v.platform
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN videos v ON v.id = c.video_id
         WHERE ${where}
         ORDER BY v.rank, c.start
         LIMIT 2000`
      )
      .all({ q, channelId, type }) as any[]
    const agg = db
      .prepare(
        `SELECT COUNT(*) n, COUNT(DISTINCT c.video_id) vids
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN videos v ON v.id = c.video_id
         WHERE ${where}`
      )
      .get({ q, channelId, type }) as any

    const neighbor = db.prepare(`SELECT text FROM chunks WHERE id=? AND video_id=?`)

    const hits: SearchHit[] = rows.map((r) => {
      // Locate the first highlighted term -> which segment it is in -> exact time.
      const mark = Math.max(0, r.h.indexOf('\u0001'))
      const offsets = JSON.parse(r.offsets) as [number, number, number][]
      let k = 0
      while (k + 1 < offsets.length && offsets[k + 1][0] <= mark) k++
      const [, segIdx, start] = offsets[k] ?? [0, r.seg_start, r.start]
      const prev = neighbor.get(r.id - 1, r.video_id) as any
      const next = neighbor.get(r.id + 1, r.video_id) as any
      return {
        chunkId: r.id,
        videoId: r.video_id,
        platform: r.platform ?? 'youtube',
        title: r.title,
        thumbnail: r.thumbnail,
        uploadDate: r.upload_date,
        type: r.video_type,
        start,
        segIdx,
        before: prev ? '…' + prev.text.slice(-CONTEXT).replace(/^\S*\s/, '') : '',
        highlighted: r.h,
        after: next ? next.text.slice(0, CONTEXT).replace(/\s\S*$/, '') + '…' : ''
      }
    })
    return { hits, total: agg.n, videoCount: agg.vids, error: null, ms: Math.round(performance.now() - t0) }
  } catch (e: any) {
    return { hits: [], total: 0, videoCount: 0, error: 'Invalid search: ' + e.message, ms: 0 }
  }
}
