import { readConfig, retryAfterMs } from './tregClient'
import type { FetchOptions, FetchOutcome, TranscriptProvider } from './types'

/**
 * ScrapeCreators YouTube transcripts through treg.to, using the treg CLI's
 * existing sign-in (~/.treg/config.json, or TREG_TOKEN). The token is read
 * in the main process only and is never exposed to the renderer.
 *
 *   GET https://treg.to/call/scrapecreators.x.v1-youtube-video-transcript?url=…
 *   200 { transcript: [{text, startMs, endMs}] | null, language: "English", captionTracks: [...] }
 *
 * Billing: X-Treg-Cost-Micro per call (~1880 µ$). Failed calls are free.
 */
const TOOL = 'scrapecreators.x.v1-youtube-video-transcript'
const TIMEOUT_MS = 45_000

/** Dominant writing system of a string, or null if there's too little text. */
export function dominantScript(s: string): string | null {
  const counts: Record<string, number> = {}
  const tests: [string, RegExp][] = [
    ['latin', /\p{Script=Latin}/u],
    ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ['hangul', /\p{Script=Hangul}/u],
    ['cyrillic', /\p{Script=Cyrillic}/u],
    ['arabic', /\p{Script=Arabic}/u],
    ['hebrew', /\p{Script=Hebrew}/u],
    ['devanagari', /\p{Script=Devanagari}/u],
    ['thai', /\p{Script=Thai}/u],
    ['greek', /\p{Script=Greek}/u]
  ]
  let total = 0
  for (const ch of s.slice(0, 2000)) {
    for (const [name, re] of tests)
      if (re.test(ch)) {
        counts[name] = (counts[name] ?? 0) + 1
        total++
        break
      }
  }
  if (total < 3) return null
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

const SCRIPT_OF_LANG: Record<string, string> = {
  zh: 'cjk', ja: 'cjk', ko: 'hangul', ru: 'cyrillic', uk: 'cyrillic', bg: 'cyrillic', sr: 'cyrillic',
  mk: 'cyrillic', be: 'cyrillic', kk: 'cyrillic', ar: 'arabic', fa: 'arabic', ur: 'arabic', iw: 'hebrew',
  he: 'hebrew', yi: 'hebrew', hi: 'devanagari', mr: 'devanagari', ne: 'devanagari', th: 'thai', el: 'greek'
}
const scriptOfLang = (code: string) => SCRIPT_OF_LANG[code] ?? 'latin'

export interface TregCallInfo {
  costMicro: number
  callId: string | null
}

export class TregScrapeCreatorsProvider implements TranscriptProvider {
  readonly id = 'treg' as const
  readonly label = 'treg · ScrapeCreators'
  // treg sets no per-token concurrency limit; provider limits come back as
  // 429 share_busy / provider_rate_limited, which cool this provider down.
  readonly concurrency = 16
  /** Cost/call id of the most recent response per video (for the fetch log). */
  readonly lastCall = new Map<string, TregCallInfo>()

  isConfigured(): boolean {
    return !!readConfig().token
  }

  /** @param generation bumps only when the user explicitly refreshes a transcript */
  async fetch(videoId: string, opts: FetchOptions = {}): Promise<FetchOutcome> {
    const { generation = 0, language, title } = opts
    const base = { videoId, source: this.id }
    const cfg = readConfig()
    if (!cfg.token) return { ...base, status: 'disabled', message: 'treg is not signed in (run `treg login`).' }

    // No `language` by default: ScrapeCreators then returns clean text. Asking for a
    // language returns the manual track with caption line breaks removed without a
    // space ("thingslike"), so it's only used when the default picked the wrong language.
    const url =
      `${cfg.baseUrl}/call/${TOOL}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}` +
      (language ? `&language=${encodeURIComponent(language)}` : '')
    const headers: Record<string, string> = {
      'X-Treg-Token': cfg.token,
      // Same key on a retry after a timeout returns the stored answer for free
      // instead of paying twice.
      'Idempotency-Key': `resurface-${videoId}-${generation}${language ? `-${language}` : ''}`
    }
    if (cfg.identity && cfg.org) headers['X-Treg-Org'] = cfg.org

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    let body: any = null
    try {
      res = await fetch(url, { headers, signal: ctrl.signal })
      const text = await res.text()
      try {
        body = JSON.parse(text)
      } catch {
        body = null
      }
    } catch (e: any) {
      return {
        ...base,
        status: 'temporary',
        message: e?.name === 'AbortError' ? 'treg request timed out' : `Network problem: ${e?.message ?? e}`
      }
    } finally {
      clearTimeout(timer)
    }

    this.lastCall.set(videoId, {
      costMicro: Number(res.headers.get('x-treg-cost-micro') ?? 0) || 0,
      callId: res.headers.get('x-treg-call-id')
    })
    const fromTreg = res.headers.get('x-treg-error') === '1'
    const code: string = body?.error ?? body?.code ?? body?.detail?.error ?? ''
    const msg: string =
      body?.message ?? (typeof body?.detail === 'string' ? body.detail : body?.detail?.message) ?? `HTTP ${res.status}`

    if (res.status === 409) {
      // The same idempotent call is still running.
      return { ...base, status: 'rate_limited', message: 'Previous request still running', retryAfterMs: retryAfterMs(res, body) ?? 3000 }
    }
    if (res.ok) {
      const t = body?.transcript
      if (!Array.isArray(t) || t.length === 0)
        return { ...base, status: 'unavailable', message: 'No captions available for this video.' }
      const segments = t
        .filter((s: any) => typeof s?.text === 'string')
        .map((s: any) => {
          const start = Number(s.startMs) / 1000
          const end = Number(s.endMs) / 1000
          return {
            start: Number.isFinite(start) ? start : 0,
            duration: Number.isFinite(end) && Number.isFinite(start) ? Math.max(0, end - start) : 0,
            text: s.text as string
          }
        })
      if (!segments.length) return { ...base, status: 'unavailable', message: 'Caption track was empty.' }
      // `language` is only a display name ("English"). With no language
      // requested ScrapeCreators returns the original track when an
      // auto-generated one exists, but for manual-only videos it returns the
      // alphabetically first track (often a translation, e.g. Arabic). Catch
      // that by comparing writing systems with the title, and ask for a track in
      // the title's script instead (English first for Latin titles).
      // Note: the first auto-generated track is NOT the spoken language on
      // auto-dubbed videos (one per dub), so it can't be used as the signal.
      const tracks: any[] = Array.isArray(body.captionTracks) ? body.captionTracks : []
      const nameOf = (tr: any) => String(tr?.name?.simpleText ?? '')
      const baseLang = (code: string) => code.split('-')[0].toLowerCase()
      if (!language && title && tracks.length > 1) {
        const want = dominantScript(title)
        const got = dominantScript(segments.map((s) => s.text).join(' '))
        if (want && got && want !== got) {
          const codes = [...new Set(tracks.map((tr) => baseLang(String(tr.languageCode))))]
          const pick =
            (want === 'latin' && codes.includes('en') ? 'en' : null) ?? codes.find((c) => scriptOfLang(c) === want)
          if (pick)
            return {
              ...base,
              status: 'temporary',
              message: `treg returned "${body.language}" captions; the title suggests ${pick}`,
              retryLanguage: pick
            }
        }
      }
      const manual = tracks.find((tr) => tr?.kind !== 'asr' && nameOf(tr) === body.language)
      const auto = tracks.find((tr) => tr?.kind === 'asr' && nameOf(tr) === `${body.language} (auto-generated)`)
      const track = manual ?? auto ?? null
      const code = track ? baseLang(String(track.languageCode)) : null
      return {
        ...base,
        status: 'ok',
        language: code ?? body.language ?? null,
        // Which track was used isn't reported: certainly auto-generated only when
        // no manual track exists in that language.
        generated: auto && !manual ? true : null,
        segments,
        uploadDate: null
      }
    }

    // treg's own refusals (X-Treg-Error: 1). Nothing was charged.
    if (fromTreg || code) {
      if (['share_busy', 'provider_rate_limited', 'org_concurrency_limit', 'org_rate_limit'].includes(code) ||
          ['upstream_busy', 'provider_capacity_unavailable'].includes(code))
        return { ...base, status: 'rate_limited', message: `treg: ${code}`, retryAfterMs: retryAfterMs(res, body) }
      if (
        ['insufficient_balance', 'funds_required', 'own_key_required', 'member_spend_cap_reached',
         'trial_allowance_reached', 'not_authenticated', 'capability_pinned'].includes(code) ||
        res.status === 401
      )
        return { ...base, status: 'disabled', message: `treg: ${code || msg}` }
    }
    // Provider answers relayed as-is (no charge on 4xx/5xx).
    if (res.status === 429) return { ...base, status: 'rate_limited', message: `ScrapeCreators rate limit`, retryAfterMs: retryAfterMs(res, body) }
    if (res.status === 404) return { ...base, status: 'unavailable', message: 'Video not found (private or removed).' }
    return { ...base, status: 'temporary', message: `treg/ScrapeCreators HTTP ${res.status}: ${String(msg).slice(0, 200)}` }
  }
}

export const tregProvider = new TregScrapeCreatorsProvider()
