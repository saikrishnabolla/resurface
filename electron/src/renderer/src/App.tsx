import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Channel, ImportState, Progress, Video } from '@shared/types'
import Header from './components/Header'
import VideoList from './components/VideoList'
import SearchPanel from './components/SearchPanel'
import TranscriptPanel from './components/TranscriptPanel'
import { Film, Search } from 'lucide-react'

export interface Selection {
  videoId: string
  segIdx?: number
  query?: string
  nonce: number
}

const LAST_KEY = 'resurface:lastChannel'

export default function App() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<string | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [importState, setImportState] = useState<ImportState>({ channelId: null, stage: 'idle', message: null })
  const [tab, setTab] = useState<'videos' | 'search'>('videos')
  const [selection, setSelection] = useState<Selection | null>(null)

  const refreshChannels = useCallback(async () => {
    const list = await window.api.listChannels()
    setChannels(list)
    return list
  }, [])

  // Initial load: restore the last opened channel.
  useEffect(() => {
    refreshChannels().then((list) => {
      let last: string | null = null
      try {
        last = localStorage.getItem(LAST_KEY)
      } catch {}
      const pick = list.find((c) => c.id === last) ?? list[0]
      if (pick) setChannelId(pick.id)
    })
  }, [refreshChannels])

  // Load videos + progress for the current channel.
  useEffect(() => {
    if (!channelId) {
      setVideos([])
      setProgress(null)
      return
    }
    try {
      localStorage.setItem(LAST_KEY, channelId)
    } catch {}
    let cancelled = false
    window.api.getVideos(channelId).then((v) => !cancelled && setVideos(v))
    window.api.getProgress(channelId).then((p) => !cancelled && setProgress(p))
    return () => {
      cancelled = true
    }
  }, [channelId])

  // Live updates from the background importer.
  useEffect(() => {
    const offs = [
      window.api.onVideoUpdate((v) => {
        if (v.channelId !== channelId) return
        setVideos((prev) => prev.map((x) => (x.id === v.id ? v : x)))
      }),
      window.api.onProgress((p) => {
        if (p.channelId === channelId) setProgress(p)
      }),
      window.api.onCatalog(async (id) => {
        await refreshChannels()
        if (id === channelId) {
          setVideos(await window.api.getVideos(id))
        } else {
          setSelection(null)
          setChannelId(id)
        }
      }),
      window.api.onImportState((s) => setImportState(s))
    ]
    return () => offs.forEach((off) => off())
  }, [channelId, refreshChannels])

  const channel = channels.find((c) => c.id === channelId) ?? null
  const selectedVideo = useMemo(
    () => (selection ? (videos.find((v) => v.id === selection.videoId) ?? null) : null),
    [selection, videos]
  )

  const open = (videoId: string, segIdx?: number, query?: string) => {
    setSelection({ videoId, segIdx, query, nonce: Date.now() })
    // Not cached yet? Move it to the front of the transcript queue.
    const v = videos.find((x) => x.id === videoId)
    if (v && v.status !== 'available' && v.status !== 'unavailable') window.api.prioritize(videoId)
  }

  const switchChannel = (id: string) => {
    setSelection(null)
    setChannelId(id)
  }

  const removeChannel = async (id: string) => {
    await window.api.deleteChannel(id)
    const list = await refreshChannels()
    if (id === channelId) switchChannel(list[0]?.id ?? (null as any))
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        channels={channels}
        channel={channel}
        progress={progress}
        importState={importState}
        onImport={(url) => window.api.importChannel(url)}
        onSwitch={switchChannel}
        onRemove={removeChannel}
        onRetry={() => channelId && window.api.retryFailed(channelId)}
      />

      {!channel ? (
        <EmptyState busy={importState.stage === 'catalog'} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col border-r border-line">
            <div className="flex items-center gap-1 border-b border-line px-3 py-2">
              <TabButton active={tab === 'videos'} onClick={() => setTab('videos')} icon={<Film size={14} />}>
                Videos <span className="text-faint">{videos.length}</span>
              </TabButton>
              <TabButton active={tab === 'search'} onClick={() => setTab('search')} icon={<Search size={14} />}>
                Search transcripts{' '}
                <span className="text-faint">
                  {progress?.available ?? 0}/{videos.length} searchable
                </span>
              </TabButton>
            </div>
            <div className={tab === 'videos' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <VideoList videos={videos} selectedId={selection?.videoId ?? null} onSelect={(id) => open(id)} />
            </div>
            <div className={tab === 'search' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <SearchPanel
                channelId={channel.id}
                active={tab === 'search'}
                searchable={progress?.available ?? 0}
                total={videos.length}
                selectedChunk={selection}
                onOpen={open}
              />
            </div>
          </section>
          {selectedVideo && (
            <TranscriptPanel
              key={selectedVideo.id}
              video={selectedVideo}
              selection={selection!}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function TabButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] ${
        props.active ? 'bg-raised text-fg' : 'text-dim hover:text-fg'
      }`}
    >
      {props.icon}
      {props.children}
    </button>
  )
}

function EmptyState({ busy }: { busy: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mb-2 text-[15px] font-medium">{busy ? 'Loading channel…' : 'No channel imported yet'}</div>
        <p className="text-dim leading-relaxed">
          Paste a YouTube channel, TikTok profile or Instagram profile URL above, like{' '}
          <span className="text-fg">youtube.com/@veritasium</span> or <span className="text-fg">tiktok.com/@nasa</span>. The latest
          100 videos appear right away, and their transcripts are collected in the background so you can search every word.
        </p>
      </div>
    </div>
  )
}
