/** Common contract for every transcript source. */

export type ProviderId = 'treg' | 'yta' | 'ytdlp' | 'treg-tiktok' | 'treg-instagram'

export interface TranscriptSegment {
  start: number // seconds
  duration: number // seconds
  text: string
}

export type FetchOutcome =
  | {
      status: 'ok'
      videoId: string
      source: ProviderId
      language: string | null
      generated: boolean | null
      segments: TranscriptSegment[]
      uploadDate: string | null // YYYY-MM-DD when the provider happens to know it
    }
  /** The video genuinely has no accessible captions. Authoritative: no fallback. */
  | { status: 'unavailable'; videoId: string; source: ProviderId; message: string }
  /** The provider is throttling us. Cool the provider down, try the next one. */
  | { status: 'rate_limited'; videoId: string; source: ProviderId; message: string; retryAfterMs: number | null }
  /** The provider can't be used at all right now (bad key, quota used up). */
  | { status: 'disabled'; videoId: string; source: ProviderId; message: string }
  /**
   * Network / 5xx / parse failure, or a transcript in the wrong language. Try
   * the next provider; retry later. `retryLanguage` = ask this provider again
   * for that specific language.
   */
  | { status: 'temporary'; videoId: string; source: ProviderId; message: string; retryLanguage?: string }

export interface FetchOptions {
  generation?: number // bumps only on an explicit user refresh
  language?: string // ask for this caption language
  title?: string // video title, used to sanity-check the transcript's language
  url?: string // the video's page URL (TikTok / Instagram tools take URLs)
}

export interface TranscriptProvider {
  readonly id: ProviderId
  readonly label: string
  /** Max simultaneous requests to this provider. */
  readonly concurrency: number
  /** Whether the provider is configured (e.g. has an API key). */
  isConfigured(): boolean
  fetch(videoId: string, opts?: FetchOptions): Promise<FetchOutcome>
}
