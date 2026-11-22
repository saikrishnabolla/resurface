export type VideoType = 'short' | 'long'
export type Platform = 'youtube' | 'tiktok' | 'instagram'
export type TranscriptStatus = 'pending' | 'processing' | 'available' | 'unavailable' | 'failed'

export interface Channel {
  id: string
  platform: Platform
  name: string
  handle: string | null
  url: string
  description: string
  thumbnail: string | null
  lastImported: number | null
}

export interface Video {
  id: string
  platform: Platform
  channelId: string
  title: string
  url: string
  thumbnail: string
  uploadDate: string | null // YYYY-MM-DD
  dateExact: boolean
  duration: number | null
  viewCount: number | null
  type: VideoType
  status: TranscriptStatus
  statusMessage: string | null
  language: string | null
  generated: boolean
  source: string | null // which provider supplied the transcript
  fetchedAt: number | null // last successful retrieval (ms epoch)
  rank: number // 0 = newest
}

export interface Segment {
  idx: number
  start: number
  duration: number
  text: string
}

export interface Progress {
  channelId: string
  total: number
  processed: number
  available: number
  unavailable: number
  failed: number
  active: boolean
  paused: string | null // reason when backing off from a rate limit
}

export interface ImportState {
  channelId: string | null
  stage: 'idle' | 'catalog' | 'transcripts' | 'done' | 'error'
  message: string | null
}

export interface SearchHit {
  chunkId: number
  videoId: string
  platform: Platform
  title: string
  thumbnail: string
  uploadDate: string | null
  type: VideoType
  start: number // exact timestamp of the first matching segment
  segIdx: number
  before: string
  highlighted: string // contains \u0001 ... \u0002 markers around matches
  after: string
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  videoCount: number
  error: string | null
  ms: number
}

export interface TregUsage {
  calls: number // all treg requests this app made
  billedCalls: number // requests that were charged
  spentMicro: number // total charged, micro-USD
  sessionCalls: number
  sessionSpentMicro: number
  balanceMicro: number | null // team balance from the treg CLI
  balanceError: string | null
  disabled: string | null // why treg is currently paused (e.g. insufficient_balance)
}

export interface Api {
  listChannels(): Promise<Channel[]>
  getVideos(channelId: string): Promise<Video[]>
  getTranscript(videoId: string): Promise<Segment[]>
  getProgress(channelId: string): Promise<Progress>
  importChannel(url: string): Promise<{ ok: boolean; channelId?: string; error?: string }>
  retryFailed(channelId: string): Promise<void>
  prioritize(videoId: string): Promise<void>
  getMetrics(channelId: string): Promise<unknown>
  getTregUsage(force?: boolean): Promise<TregUsage>
  search(channelId: string, query: string, type: 'all' | VideoType): Promise<SearchResult>
  openYouTube(videoId: string, seconds: number): Promise<void>
  copyText(text: string): Promise<void>
  exportTranscript(videoId: string): Promise<boolean>
  deleteChannel(channelId: string): Promise<void>
  onVideoUpdate(cb: (v: Video) => void): () => void
  onCatalog(cb: (channelId: string) => void): () => void
  onProgress(cb: (p: Progress) => void): () => void
  onImportState(cb: (s: ImportState) => void): () => void
}
