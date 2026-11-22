import * as db from './db'
import { worker, WorkerError } from './worker'
import { tregProvider } from './providers/treg'
import { ytaProvider, ytdlpProvider } from './providers/python'
import {
  CatalogError,
  instagramCatalog,
  instagramProvider,
  parseProfileUrl,
  tiktokCatalog,
  tiktokProvider,
  type PageCallback,
  type Platform
} from './providers/social'
import { cacheMany, cacheThumb } from './thumbs'
import type { FetchOutcome, ProviderId, TranscriptProvider } from './providers/types'
import type { ImportState, Progress, Video } from '@shared/types'

/** Provider chain, in priority order. The free YouTube scrapers are fallbacks only. */
const YT_PROVIDERS: TranscriptProvider[] = [tregProvider, ytaProvider, ytdlpProvider]
// RESURFACE_PROVIDERS=yta,ytdlp restricts the YouTube chain (used by the benchmark).
const YT_CHAIN = process.env.RESURFACE_PROVIDERS
  ? YT_PROVIDERS.filter((p) => process.env.RESURFACE_PROVIDERS!.split(',').includes(p.id))
  : YT_PROVIDERS
/** Provider chain per platform, in priority order. */
const CHAINS: Record<Platform, TranscriptProvider[]> = {
  youtube: YT_CHAIN,
  tiktok: [tiktokProvider],
  instagram: [instagramProvider]
}
const PROVIDERS: TranscriptProvider[] = [...YT_PROVIDERS, tiktokProvider, instagramProvider]
// Default number of latest videos to import (overridable per import; null = all).
const DEFAULT_LIMIT = Number(process.env.RESURFACE_LIMIT) || 100

const MAX_ROUNDS = 3 // full passes through the chain before a video is marked failed
/** If the preferred provider is cooling down for less than this, wait for it instead of falling back. */
const WAIT_FOR_PREFERRED_MS = 30_000
const DISABLE_MS = 10 * 60_000

type Emit = {
  video(v: Video): void
  catalog(channelId: string): void
  progress(p: Progress): void
  importState(s: ImportState): void
}

interface Job {
  videoId: string
  channelId: string
  platform: Platform
  priority: number // lower runs first: 0 = user opened it, 1 = background
  order: number // newest first within a priority
  tried: Set<ProviderId> // providers that failed temporarily this round
  round: number
  notBefore: number
  running?: boolean
  tregLanguage?: string // default treg answer was in the wrong language: ask for this one
}

interface ProviderState {
  active: number
  cooldownUntil: number
  strikes: number
  disabledUntil: number
  lastError: string | null
}

interface RunMetrics {
  channelId: string
  startedAt: number
  cachedShownMs: number | null // time until a previously imported catalog was on screen
  catalogMs: number | null // time until the fresh yt-dlp catalog was on screen
  cacheHits: number // transcripts already in SQLite at import
  needed: number // transcripts that had to be fetched
  firstTranscriptMs: number | null
  allIndexedMs: number | null
}

export function normalizeChannelInput(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (s.startsWith('@')) s = 'https://www.youtube.com/' + s
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  s = s.split(/[?#]/)[0].replace(/\/+$/, '')
  const m = s.match(
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[^/]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[^/]+|user\/[^/]+)(?:\/.*)?$/i
  )
  if (!m) return null
  const path = m[1].startsWith('channel/') ? m[1] : m[1].toLowerCase()
  return 'https://www.youtube.com/' + path
}

/**
 * Background transcript queue: priority-ordered jobs, bounded concurrency per
 * provider, per-provider cooldowns (honoring Retry-After) and fallback down the
 * provider chain only when the preferred provider can't serve.
 */
export class Importer {
  private jobs = new Map<string, Job>()
  private state = new Map<ProviderId, ProviderState>()
  private timer: NodeJS.Timeout | null = null
  private wakeAt = 0
  private seq = 0
  private runs = new Map<string, RunMetrics>()
  readonly sessionStart = Date.now()

  constructor(private emit: Emit) {
    for (const p of PROVIDERS)
      this.state.set(p.id, { active: 0, cooldownUntil: 0, strikes: 0, disabledUntil: 0, lastError: null })
  }

  // -------------------------------------------------------------------------
  // Catalog

  async importChannel(
    url: string,
    limit: number | null = DEFAULT_LIMIT
  ): Promise<{ ok: boolean; channelId?: string; error?: string }> {
    const t0 = Date.now()
    const social = parseProfileUrl(url)
    const alias = social ? social.canonical : normalizeChannelInput(url)
    if (!alias) {
      const message =
        'Paste a YouTube channel (youtube.com/@name, /channel/ID), TikTok profile (tiktok.com/@name) or Instagram profile (instagram.com/name) URL.'
      this.emit.importState({ channelId: null, stage: 'error', message })
      return { ok: false, error: message }
    }
    const knownId = db.channelForAlias(alias)
    const run: RunMetrics = {
      channelId: knownId ?? '',
      startedAt: t0,
      cachedShownMs: null,
      catalogMs: null,
      cacheHits: 0,
      needed: 0,
      firstTranscriptMs: null,
      allIndexedMs: null
    }

    // A channel seen before: show its cached catalog + transcripts right away,
    // resume its transcript work, and refresh the catalog behind it.
    if (knownId) {
      this.emit.catalog(knownId)
      run.cachedShownMs = Date.now() - t0
      this.enqueueChannel(knownId, true)
      this.pushProgress(knownId)
      this.emit.importState({ channelId: knownId, stage: 'catalog', message: 'Showing cached videos · refreshing catalog…' })
    } else {
      this.emit.importState({
        channelId: null,
        stage: 'catalog',
        message: social ? `Loading @${social.handle}'s latest videos via treg…` : 'Finding channel and latest videos…'
      })
    }

    let res: any
    for (let attempt = 0; ; attempt++) {
      try {
        if (social) {
          res = await this.socialCatalog(social.platform, social.handle, limit ?? 100, alias)
        } else {
          // Listing a whole large channel can take a while (yt-dlp pages ~100 per request).
          res = await worker.request('channel', { url, limit, channel_id: knownId }, limit && limit <= 500 ? 120_000 : 900_000)
        }
        break
      } catch (e) {
        const err = e as WorkerError | CatalogError
        if (err instanceof CatalogError && err.kind === 'disabled') {
          const message = `${err.message} — top up with \`treg topup\` to import TikTok/Instagram profiles.`
          this.emit.importState({ channelId: knownId, stage: 'error', message })
          return knownId ? { ok: true, channelId: knownId } : { ok: false, error: message }
        }
        if ((err.kind === 'temporary' || err.kind === 'rate_limited') && attempt < 2) {
          await sleep(2000 * (attempt + 1))
          continue
        }
        if (knownId) {
          // Cached data stays usable; just report the failed refresh.
          this.emit.importState({ channelId: knownId, stage: 'error', message: `Catalog refresh failed: ${err.message}` })
          return { ok: true, channelId: knownId }
        }
        this.emit.importState({ channelId: null, stage: 'error', message: err.message })
        return { ok: false, error: err.message }
      }
    }
    db.saveCatalog(res.channel, res.videos)
    const channelId = res.channel.id as string
    // Videos that fell outside this import (a smaller limit) leave the queue: no fetching, no cost.
    for (const [id, job] of this.jobs)
      if (job.channelId === channelId && !job.running && db.getVideo(id)?.rank == null) this.jobs.delete(id)
    db.saveAlias(alias, channelId)
    this.emit.catalog(channelId)
    if (social) void this.cacheImages(channelId, res.channel.thumbnail, res.videos)
    run.channelId = channelId
    run.catalogMs = Date.now() - t0
    const counts = db.countByStatus(channelId)
    run.cacheHits = counts.available
    this.enqueueChannel(channelId, true)
    run.needed = this.pendingCount(channelId)
    if (run.needed === 0) run.allIndexedMs = Date.now() - t0
    this.runs.set(channelId, run)

    const n = res.videos.length
    const what = social ? 'profile' : 'channel'
    const note =
      limit == null ? ' (all public videos)' : n < limit ? ` (${what} has ${n} public video${n === 1 ? '' : 's'})` : ''
    this.emit.importState({
      channelId,
      stage: 'transcripts',
      message: `Loaded ${n} videos${note} in ${(run.catalogMs / 1000).toFixed(1)}s · ${counts.available} transcripts cached`
    })
    console.log(
      `[import] ${res.channel.name}: catalog ${run.catalogMs}ms (yt-dlp ${JSON.stringify(res.timings ?? {})}), ` +
        `cached view ${run.cachedShownMs ?? '-'}ms, ${run.cacheHits} cached, ${run.needed} to fetch`
    )
    this.pushProgress(channelId)
    return { ok: true, channelId }
  }

  /** TikTok / Instagram catalog via treg; every call is logged with its cost. */
  private async socialCatalog(platform: Platform, handle: string, limit: number, alias: string) {
    const log = (_tool: string, r: { ok: boolean; costMicro: number; failure: { kind: string } | null }, ms: number) =>
      db.logFetch('', `treg-${platform}-catalog`, r.ok ? 'ok' : (r.failure?.kind ?? 'temporary'), ms, r.costMicro)
    // Show each page as it arrives and start transcribing right away.
    const onPage: PageCallback = (channel, videos) => {
      db.saveCatalog(channel, videos)
      db.saveAlias(alias, channel.id)
      this.emit.catalog(channel.id)
      this.enqueueChannel(channel.id, false)
      this.pushProgress(channel.id)
    }
    return platform === 'tiktok' ? tiktokCatalog(handle, limit, log, onPage) : instagramCatalog(handle, limit, log, onPage)
  }

  /** Signed TikTok/Instagram image URLs expire: keep local copies. */
  private async cacheImages(channelId: string, avatar: string | null, videos: { id: string; thumbnail: string }[]) {
    if (avatar) {
      const local = await cacheThumb(`ch_${channelId}`, avatar)
      if (local) db.setChannelThumbnail(channelId, local)
    }
    await cacheMany(
      videos.filter((v) => v.thumbnail.startsWith('https://')).map((v) => ({ name: v.id, url: v.thumbnail })),
      (name, local) => db.setThumbnail(name, local)
    )
    this.emit.catalog(channelId) // re-read with local images
  }

  // -------------------------------------------------------------------------
  // Queue

  /** Queue every not-yet-done transcript of a channel. Cached ones are skipped. */
  enqueueChannel(channelId: string, includeFailed: boolean): void {
    const platform = db.channelPlatform(channelId)
    for (const id of db.pendingVideoIds(channelId, includeFailed)) {
      if (this.jobs.has(id)) continue
      if (includeFailed) db.resetAttempts(id)
      this.jobs.set(id, {
        videoId: id,
        channelId,
        platform,
        priority: 1,
        order: this.seq++,
        tried: new Set(),
        round: 0,
        notBefore: 0
      })
      db.setStatus(id, 'pending')
    }
    this.pump()
  }

  resumeAll(): void {
    for (const ch of db.channelsWithPending()) this.enqueueChannel(ch, false)
  }

  /** The user opened this video: fetch it next. */
  prioritize(videoId: string): void {
    const v = db.getVideo(videoId)
    if (!v || v.status === 'available' || v.status === 'unavailable') return
    let job = this.jobs.get(videoId)
    if (!job) {
      job = { videoId, channelId: v.channelId, platform: v.platform, priority: 0, order: 0, tried: new Set(), round: 0, notBefore: 0 }
      this.jobs.set(videoId, job)
      db.resetAttempts(videoId)
      db.setStatus(videoId, 'pending')
      this.emitVideo(videoId)
    }
    job.priority = 0
    job.order = -Date.now() // most recently opened first
    job.notBefore = 0
    this.pump()
  }

  private pendingCount(channelId: string): number {
    let n = 0
    for (const j of this.jobs.values()) if (j.channelId === channelId) n++
    return n
  }

  isActive(channelId: string): boolean {
    return this.pendingCount(channelId) > 0
  }

  progress(channelId: string): Progress {
    return { ...db.getProgress(channelId), active: this.isActive(channelId), paused: this.pausedReason() }
  }

  private pausedReason(): string | null {
    const now = Date.now()
    const usable = PROVIDERS.filter((p) => this.usable(p, now))
    if (usable.length || this.jobs.size === 0) return null
    const next = Math.min(...PROVIDERS.map((p) => this.readyAt(p)))
    const secs = Math.max(1, Math.round((next - now) / 1000))
    return `Transcript providers are rate limiting — resuming in ${secs}s`
  }

  private pushProgress(channelId: string): void {
    this.emit.progress(this.progress(channelId))
  }

  private readyAt(p: TranscriptProvider): number {
    const s = this.state.get(p.id)!
    return Math.max(s.cooldownUntil, s.disabledUntil)
  }

  private usable(p: TranscriptProvider, now: number): boolean {
    return p.isConfigured() && this.readyAt(p) <= now
  }

  /**
   * Which provider should serve this job now? Returns null to wait. Falls back
   * past a provider only when it's disabled/unconfigured, long cooling down, or
   * already failed for this job in the current round.
   */
  private pick(job: Job, now: number): { provider: TranscriptProvider | null; wakeAt: number } {
    const chain = CHAINS[job.platform] ?? YT_CHAIN
    for (const p of chain) {
      if (job.tried.has(p.id) || !p.isConfigured()) continue
      const s = this.state.get(p.id)!
      if (s.disabledUntil > now) continue
      if (s.cooldownUntil > now) {
        if (s.cooldownUntil - now < WAIT_FOR_PREFERRED_MS) return { provider: null, wakeAt: s.cooldownUntil }
        continue
      }
      return { provider: p, wakeAt: 0 }
    }
    // Everything left is unavailable right now: wait for the earliest one.
    const waits = chain.filter((p) => !job.tried.has(p.id) && p.isConfigured()).map((p) => this.readyAt(p))
    return { provider: null, wakeAt: waits.length ? Math.min(...waits) : now + 5000 }
  }

  private pump(): void {
    const now = Date.now()
    let wake = Infinity
    const ordered = [...this.jobs.values()]
      .filter((j) => !j.running)
      .sort((a, b) => a.priority - b.priority || a.order - b.order)
    for (const job of ordered) {
      if (job.notBefore > now) {
        wake = Math.min(wake, job.notBefore)
        continue
      }
      const { provider, wakeAt } = this.pick(job, now)
      if (!provider) {
        if (wakeAt) wake = Math.min(wake, wakeAt)
        continue
      }
      const s = this.state.get(provider.id)!
      // Videos the user opened get 2 reserved slots so they never wait behind background work.
      const limit = provider.concurrency + (job.priority === 0 ? 2 : 0)
      if (s.active >= limit) continue // a later job may need a different provider
      s.active++
      job.running = true
      this.run(job, provider).finally(() => {
        s.active--
        job.running = false
        this.pump()
      })
    }
    if (wake !== Infinity) this.schedule(wake)
  }

  private schedule(at: number): void {
    if (this.timer && this.wakeAt <= at) return
    if (this.timer) clearTimeout(this.timer)
    this.wakeAt = at
    this.timer = setTimeout(
      () => {
        this.timer = null
        this.pump()
        // Progress text includes a countdown while paused.
        const chans = new Set([...this.jobs.values()].map((j) => j.channelId))
        chans.forEach((c) => this.pushProgress(c))
      },
      Math.max(50, at - Date.now())
    )
  }

  private async run(job: Job, provider: TranscriptProvider): Promise<void> {
    const { videoId } = job
    const v = db.getVideo(videoId)
    if (!v || v.rank == null || v.status === 'available' || v.status === 'unavailable') {
      this.jobs.delete(videoId)
      return
    }
    if (v.status !== 'processing') {
      db.setStatus(videoId, 'processing')
      this.emitVideo(videoId)
    }
    db.touchAttempt(videoId)
    const call = async (lang?: string): Promise<FetchOutcome> => {
      const t0 = performance.now()
      let out: FetchOutcome
      try {
        out = await provider.fetch(videoId, { language: lang, title: v.title, url: v.url })
      } catch (e: any) {
        out = { status: 'temporary', videoId, source: provider.id, message: String(e?.message ?? e) }
      }
      const calls = (provider as { lastCall?: Map<string, { costMicro: number }> }).lastCall
      const cost = calls?.get(videoId)?.costMicro ?? 0
      calls?.delete(videoId)
      const label = out.status === 'temporary' && out.retryLanguage ? 'wrong_language' : out.status
      db.logFetch(videoId, provider.id, label, performance.now() - t0, cost)
      return out
    }
    let out = await call(provider.id === 'treg' ? job.tregLanguage : undefined)
    if (out.status === 'temporary' && out.retryLanguage) {
      job.tregLanguage = out.retryLanguage
      // Prefer the free path (it picks the right track, unaltered). If it can't
      // run now, ask treg again for the spoken language explicitly.
      if (!this.usable(ytaProvider, Date.now())) out = await call(out.retryLanguage)
    }
    const st = this.state.get(provider.id)!

    switch (out.status) {
      case 'ok': {
        st.strikes = 0
        st.lastError = null
        db.saveTranscript(videoId, {
          segments: out.segments,
          language: out.language,
          generated: out.generated,
          source: provider.id,
          upload_date: out.uploadDate
        })
        this.jobs.delete(videoId)
        this.noteIndexed(job.channelId)
        break
      }
      case 'unavailable': {
        // Captions are a property of the video: one provider saying "none" is enough.
        db.setStatus(videoId, 'unavailable', out.message)
        this.jobs.delete(videoId)
        this.noteIndexed(job.channelId)
        break
      }
      case 'rate_limited': {
        // Cool this provider down (Retry-After if given, else exponential) and
        // put the job back without counting it as a failure.
        st.strikes++
        const base = provider.id === 'treg' ? 2000 : 60_000
        const backoff = Math.min(provider.id === 'treg' ? 120_000 : 15 * 60_000, base * 2 ** (st.strikes - 1))
        st.cooldownUntil = Math.max(st.cooldownUntil, Date.now() + (out.retryAfterMs ?? backoff))
        st.lastError = out.message
        db.setStatus(videoId, 'pending', `Waiting: ${provider.label} rate limit`)
        break
      }
      case 'disabled': {
        st.disabledUntil = Date.now() + DISABLE_MS
        st.lastError = out.message
        console.warn(`[providers] ${provider.label} disabled for 10 min: ${out.message}`)
        db.setStatus(videoId, 'pending', `${out.message} — using fallback`)
        break
      }
      case 'temporary': {
        st.lastError = out.message
        job.tried.add(provider.id)
        const remaining = (CHAINS[job.platform] ?? YT_CHAIN).filter((p) => p.isConfigured() && !job.tried.has(p.id))
        if (remaining.length) {
          db.setStatus(videoId, 'pending', `${provider.label} failed (${out.message}); trying fallback`)
          break
        }
        // Every provider failed this round: back off, then start over.
        job.round++
        job.tried.clear()
        if (job.round >= MAX_ROUNDS) {
          db.setStatus(videoId, 'failed', out.message)
          this.jobs.delete(videoId)
          this.noteIndexed(job.channelId)
        } else {
          job.notBefore = Date.now() + 3000 * 3 ** (job.round - 1) // 3s, 9s
          db.setStatus(videoId, 'pending', `Retrying: ${out.message}`)
        }
        break
      }
    }
    this.emitVideo(videoId)
  }

  /** Track first-transcript / all-done timings for the import run. */
  private noteIndexed(channelId: string): void {
    const run = this.runs.get(channelId)
    if (!run) return
    const now = Date.now() - run.startedAt
    if (run.firstTranscriptMs == null) run.firstTranscriptMs = now
    if (run.allIndexedMs == null && this.pendingCount(channelId) === 0) {
      run.allIndexedMs = now
      const stats = db.providerStats(run.startedAt)
      console.log(`[import] done: ${JSON.stringify(this.metrics(channelId))}`)
      void stats
    }
  }

  /** Why a provider is paused right now (disabled / cooling down), or null. */
  providerPause(id: ProviderId): string | null {
    const st = this.state.get(id)
    if (!st) return null
    const now = Date.now()
    if (st.disabledUntil > now) return st.lastError ?? 'disabled'
    if (st.cooldownUntil > now) return `rate limited (${Math.ceil((st.cooldownUntil - now) / 1000)}s)`
    return null
  }

  metrics(channelId: string) {
    const run = this.runs.get(channelId) ?? null
    const since = run?.startedAt ?? this.sessionStart
    return {
      run,
      cacheHitRate: run && run.cacheHits + run.needed ? run.cacheHits / (run.cacheHits + run.needed) : null,
      providers: db.providerStats(since).map((r) => ({
        ...r,
        avgOkMs: r.avgOkMs == null ? null : Math.round(r.avgOkMs),
        state: this.state.get(r.provider as ProviderId) ?? null
      }))
    }
  }

  private emitVideo(videoId: string): void {
    const v = db.getVideo(videoId)
    if (!v) return
    this.emit.video(v)
    this.pushProgress(v.channelId)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
