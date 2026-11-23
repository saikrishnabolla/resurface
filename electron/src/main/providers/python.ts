import { worker, WorkerError } from '../worker'
import type { FetchOutcome, ProviderId, TranscriptProvider } from './types'

interface PyTranscript {
  segments: { start: number; duration: number; text: string }[]
  language: string
  generated: boolean
  upload_date: string | null
}

/** Adapter for the free providers that run in the bundled Python worker. */
class PythonProvider implements TranscriptProvider {
  constructor(
    readonly id: ProviderId,
    readonly label: string,
    private cmd: 'yta' | 'ytdlp',
    readonly concurrency: number
  ) {}

  isConfigured(): boolean {
    return true
  }

  async fetch(videoId: string): Promise<FetchOutcome> {
    // The Python path picks the spoken-language track itself.
    const base = { videoId, source: this.id }
    try {
      const t = await worker.request<PyTranscript>(this.cmd, { video_id: videoId }, 90_000)
      if (!t.segments?.length) return { ...base, status: 'unavailable', message: 'Caption track was empty.' }
      return {
        ...base,
        status: 'ok',
        language: t.language || null,
        generated: t.generated,
        segments: t.segments,
        uploadDate: t.upload_date
      }
    } catch (e) {
      const err = e instanceof WorkerError ? e : new WorkerError('temporary', String(e))
      switch (err.kind) {
        case 'unavailable':
          return { ...base, status: 'unavailable', message: err.message }
        case 'rate_limited':
          return { ...base, status: 'rate_limited', message: err.message, retryAfterMs: null }
        default:
          return { ...base, status: 'temporary', message: err.message }
      }
    }
  }
}

// YouTube throttles by IP, so the free providers stay at low concurrency.
export const ytaProvider = new PythonProvider('yta', 'youtube-transcript-api', 'yta', 2)
export const ytdlpProvider = new PythonProvider('ytdlp', 'yt-dlp', 'ytdlp', 1)
