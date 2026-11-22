import { tregCall, type TregResult } from './tregClient'
import type { FetchOptions, FetchOutcome, TranscriptProvider, TranscriptSegment } from './types'
import type { CatalogChannel, CatalogVideo } from '../db'

/**
 * TikTok and Instagram through treg → ScrapeCreators.
 *  Catalog:     profile + paginated video list (≈ $0.0019 per page/profile call)
 *  Transcripts: TikTok   = the video's own captions (WEBVTT), no AI fallback
 *               Instagram = ScrapeCreators' AI speech-to-text (Instagram has no
 *                           caption tracks to read), labelled as such in the UI
 */
export type Platform = 'youtube' | 'tiktok' | 'instagram'

const IG_RESERVED = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'stories', 'accounts', 'direct', 'about', 'developer'])

/** Detect the platform and canonical profile URL, or null if unrecognised. */
export function parseProfileUrl(raw: string): { platform: Platform; handle: string; canonical: string } | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s) && /^(www\.|m\.|vm\.)?(tiktok|instagram)\.com\//i.test(s)) s = 'https://' + s
  s = s.split(/[?#]/)[0]
  let m = s.match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})/i)
  if (m) {
    const handle = m[1].toLowerCase()
    return { platform: 'tiktok', handle, canonical: `https://www.tiktok.com/@${handle}` }
  }
  m = s.match(/^https?:\/\/(?:www\.|m\.)?instagram\.com\/([A-Za-z0-9._]{1,30})(?:\/|$)/i)
  if (m && !IG_RESERVED.has(m[1].toLowerCase())) {
    const handle = m[1].toLowerCase()
    return { platform: 'instagram', handle, canonical: `https://www.instagram.com/${handle}` }
  }
  return null
}

export type CallLogger = (tool: string, r: TregResult, ms: number) => void
/** Called after each page so the UI can show videos while later pages load. */
export type PageCallback = (channel: CatalogChannel & { platform: Platform }, videosSoFar: CatalogVideo[]) => void

export class CatalogError extends Error {
  constructor(
    public kind: 'not_found' | 'temporary' | 'disabled' | 'rate_limited',
    message: string
  ) {
    super(message)
  }
}

async function call(tool: string, query: Record<string, string | undefined>, log: CallLogger): Promise<any> {
  const t0 = performance.now()
  const r = await tregCall(tool, query, { timeoutMs: 60_000 })
  log(tool, r, performance.now() - t0)
  if (r.ok) return r.body
  const f = r.failure!
  throw new CatalogError(f.kind === 'unavailable' ? 'not_found' : f.kind, f.message)
}

const first = <T,>(...xs: (T | null | undefined)[]): T | null => xs.find((x) => x != null && (x as any) !== '') ?? null
const urlOf = (x: any): string | null =>
  typeof x === 'string' ? x : Array.isArray(x?.url_list) ? (x.url_list[0] ?? null) : Array.isArray(x) ? urlOf(x[0]) : (x?.url ?? null)
// Same split as the YouTube side: anything under 3 minutes counts as short-form.
const typeFor = (duration: number | null) => (duration != null && duration >= 180 ? 'long' : 'short')
const MAX_PAGES = 15
const byDate = (m: Map<string, CatalogVideo>, limit: number) =>
  [...m.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, limit)

// ---------------------------------------------------------------------------
// TikTok

export async function tiktokCatalog(handle: string, limit: number, log: CallLogger, onPage?: PageCallback) {
  const prof = await call('scrapecreators.tiktok.user.profile', { handle }, log)
  const u = prof?.user ?? prof?.userInfo?.user
  if (!u) throw new CatalogError('not_found', `TikTok profile @${handle} not found.`)
  const uniqueId: string = u.uniqueId ?? handle
  const channel: CatalogChannel & { platform: Platform } = {
    id: `tt_${u.id ?? uniqueId}`,
    name: u.nickname || uniqueId,
    handle: '@' + uniqueId,
    url: `https://www.tiktok.com/@${uniqueId}`,
    description: u.signature ?? '',
    thumbnail: first(u.avatarLarger, u.avatarMedium, u.avatarThumb),
    platform: 'tiktok'
  }

  const seen = new Map<string, CatalogVideo>()
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES && seen.size < limit + 10; page++) {
    const body = await call(
      'scrapecreators.x.v3-tiktok-profile-videos',
      { handle: uniqueId, user_id: u.id ? String(u.id) : undefined, sort_by: 'latest', max_cursor: cursor },
      log
    )
    const list: any[] = body?.aweme_list ?? body?.videos ?? []
    for (const a of list) {
      const id = a?.aweme_id ?? a?.id
      if (!id || a?.image_post_info) continue // photo slideshows have no video to transcribe
      const d = Number(a?.video?.duration)
      const duration = Number.isFinite(d) && d > 0 ? (d > 1000 ? d / 1000 : d) : null // ms on v3
      seen.set(String(id), {
        id: `tt_${id}`,
        title: (a?.desc || '').trim() || '(no caption)',
        url: `https://www.tiktok.com/@${uniqueId}/video/${id}`,
        thumbnail: first(urlOf(a?.video?.cover), urlOf(a?.video?.origin_cover), urlOf(a?.video?.dynamic_cover)) ?? '',
        timestamp: Number(a?.create_time) || null,
        duration,
        view_count: a?.statistics?.play_count ?? null,
        type: typeFor(duration)
      })
    }
    onPage?.(channel, byDate(seen, limit))
    const more = body?.has_more === true || body?.has_more === 1
    const next = body?.max_cursor != null ? String(body.max_cursor) : undefined
    if (!more || !list.length || !next || next === cursor) break
    cursor = next
  }
  // Pinned videos come first in the feed regardless of date: order by time.
  return { channel, videos: byDate(seen, limit) }
}

/** Parse a WEBVTT document into segments (seconds). */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const out: TranscriptSegment[] = []
  const ts = (t: string) => {
    const p = t.trim().split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN
  }
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i].split('-->')
    const start = ts(a)
    const end = ts(b.trim().split(/\s+/)[0])
    const text = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text || !Number.isFinite(start)) continue
    out.push({ start, duration: Number.isFinite(end) ? Math.max(0, end - start) : 0, text })
  }
  return out
}

function segmentsFromTimestamps(x: any): TranscriptSegment[] {
  if (!Array.isArray(x)) return []
  return x
    .map((s: any) => {
      const start = Number(s?.start ?? s?.start_time ?? s?.startTime)
      const end = Number(s?.end ?? s?.end_time ?? s?.endTime)
      const text = String(s?.text ?? '').trim()
      return { start, duration: Number.isFinite(end) ? Math.max(0, end - start) : 0, text }
    })
    .filter((s) => s.text && Number.isFinite(s.start))
}

class TikTokTranscriptProvider implements TranscriptProvider {
  readonly id = 'treg-tiktok' as const
  readonly label = 'treg · ScrapeCreators (TikTok)'
  readonly concurrency = 10
  readonly lastCall = new Map<string, { costMicro: number }>()
  isConfigured() {
    return true
  }
  async fetch(videoId: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
    const base = { videoId, source: this.id }
    if (!opts.url) return { ...base, status: 'unavailable', message: 'Missing video URL.' }
    const r = await tregCall('scrapecreators.x.v1-tiktok-video-transcript', { url: opts.url }, { idempotencyKey: `resurface-${videoId}-${opts.generation ?? 0}` })
    this.lastCall.set(videoId, { costMicro: r.costMicro })
    if (!r.ok) return failureOutcome(base, r)
    const b = r.body ?? {}
    let segments = segmentsFromTimestamps(b.transcript_with_timestamp)
    if (!segments.length && typeof b.transcript === 'string') segments = parseVtt(b.transcript)
    if (!segments.length) return { ...base, status: 'unavailable', message: 'This TikTok has no captions.' }
    return { ...base, status: 'ok', language: b.language ?? null, generated: null, segments, uploadDate: null }
  }
}

// ---------------------------------------------------------------------------
// Instagram

export async function instagramCatalog(handle: string, limit: number, log: CallLogger, onPage?: PageCallback) {
  const prof = await call('scrapecreators.instagram.user.profile', { handle }, log)
  const u = prof?.data?.user ?? prof?.user
  if (!u?.id) throw new CatalogError('not_found', `Instagram profile @${handle} not found (or it is private).`)
  const username: string = u.username ?? handle
  const channel: CatalogChannel & { platform: Platform } = {
    id: `ig_${u.id}`,
    name: u.full_name || username,
    handle: '@' + username,
    url: `https://www.instagram.com/${username}`,
    description: u.biography ?? '',
    thumbnail: first(u.profile_pic_url_hd, u.profile_pic_url),
    platform: 'instagram'
  }

  const seen = new Map<string, CatalogVideo>()
  let maxId: string | undefined
  for (let page = 0; page < MAX_PAGES && seen.size < limit; page++) {
    const body = await call('scrapecreators.x.v1-instagram-user-reels', { user_id: String(u.id), max_id: maxId }, log)
    const items: any[] = body?.items ?? body?.data?.items ?? []
    for (const it of items) {
      const m = it?.media ?? it
      const code = m?.code ?? m?.shortcode
      if (!code) continue
      const caption = typeof m?.caption === 'string' ? m.caption : m?.caption?.text
      const d = Number(m?.video_duration)
      const duration = Number.isFinite(d) && d > 0 ? d : null
      seen.set(code, {
        id: `ig_${code}`,
        title:
          (caption || m?.clips_metadata?.reusable_text_attribute_string || '').trim().split('\n')[0].slice(0, 200) ||
          '(no caption)',
        url: m?.url ?? `https://www.instagram.com/reel/${code}/`,
        thumbnail: first(m?.display_uri, m?.image_versions2?.candidates?.[0]?.url, m?.thumbnail_url) ?? '',
        timestamp: Number(m?.taken_at) || null,
        duration,
        view_count: m?.play_count ?? m?.ig_play_count ?? m?.view_count ?? null,
        type: typeFor(duration)
      })
    }
    onPage?.(channel, byDate(seen, limit))
    const more = body?.paging_info?.more_available
    const next = body?.paging_info?.max_id
    if (!more || !items.length || !next || next === maxId) break
    maxId = String(next)
  }
  return { channel, videos: byDate(seen, limit) }
}

class InstagramTranscriptProvider implements TranscriptProvider {
  readonly id = 'treg-instagram' as const
  readonly label = 'treg · ScrapeCreators (Instagram, AI)'
  readonly concurrency = 10
  readonly lastCall = new Map<string, { costMicro: number }>()
  isConfigured() {
    return true
  }
  async fetch(videoId: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
    const base = { videoId, source: this.id }
    if (!opts.url) return { ...base, status: 'unavailable', message: 'Missing reel URL.' }
    const r = await tregCall('scrapecreators.x.v2-instagram-media-transcript', { url: opts.url }, { idempotencyKey: `resurface-${videoId}-${opts.generation ?? 0}`, timeoutMs: 120_000 })
    this.lastCall.set(videoId, { costMicro: r.costMicro })
    if (!r.ok) {
      // Reels over 2 minutes need opt-in long transcription (10 credits per minute).
      if (r.status === 400 && /too long/i.test(`${r.body?.message ?? ''} ${r.failure?.message ?? ''}`))
        return { ...base, status: 'unavailable', message: 'Longer than 2 minutes: Instagram AI transcription is limited to 2 min.' }
      return failureOutcome(base, r)
    }
    const t = (r.body?.transcripts ?? [])[0]
    let segments = segmentsFromTimestamps(t?.transcript_with_timestamp)
    if (!segments.length && typeof t?.text === 'string' && t.text.trim()) {
      // No timing returned: keep the text (one segment per sentence, all at 0:00).
      segments = t.text
        .trim()
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .map((text: string) => ({ start: 0, duration: 0, text }))
    }
    if (!segments.length) return { ...base, status: 'unavailable', message: 'No speech found in this reel.' }
    return { ...base, status: 'ok', language: null, generated: true, segments, uploadDate: null }
  }
}

function failureOutcome(base: { videoId: string; source: any }, r: TregResult): FetchOutcome {
  const f = r.failure!
  if (f.kind === 'rate_limited') return { ...base, status: 'rate_limited', message: f.message, retryAfterMs: f.retryAfterMs }
  if (f.kind === 'disabled') return { ...base, status: 'disabled', message: f.message }
  if (f.kind === 'unavailable') return { ...base, status: 'unavailable', message: f.message }
  return { ...base, status: 'temporary', message: f.message }
}

export const tiktokProvider = new TikTokTranscriptProvider()
export const instagramProvider = new InstagramTranscriptProvider()
