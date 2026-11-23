import { useMemo, useState } from 'react'
import type { Video } from '@shared/types'
import { Search } from 'lucide-react'
import { fmtDate, fmtTime, fmtViews } from '../util'
import StatusPill from './StatusPill'

type Filter = 'all' | 'short' | 'long' | 'transcript'
type Sort = 'newest' | 'oldest' | 'longest' | 'shortest' | 'views'

interface Props {
  videos: Video[]
  selectedId: string | null
  onSelect(id: string): void
}

export default function VideoList({ videos, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('newest')
  const [q, setQ] = useState('')

  const counts = useMemo(
    () => ({
      all: videos.length,
      short: videos.filter((v) => v.type === 'short').length,
      long: videos.filter((v) => v.type === 'long').length,
      transcript: videos.filter((v) => v.status === 'available').length
    }),
    [videos]
  )

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = videos.filter((v) => {
      if (filter === 'short' && v.type !== 'short') return false
      if (filter === 'long' && v.type !== 'long') return false
      if (filter === 'transcript' && v.status !== 'available') return false
      if (needle && !v.title.toLowerCase().includes(needle)) return false
      return true
    })
    const dur = (v: Video) => v.duration ?? -1
    switch (sort) {
      case 'newest': // channel upload order is exact, dates may be approximate
        return list.sort((a, b) => a.rank - b.rank)
      case 'oldest':
        return list.sort((a, b) => b.rank - a.rank)
      case 'longest':
        return list.sort((a, b) => dur(b) - dur(a))
      case 'shortest':
        return list.sort((a, b) => dur(a) - dur(b))
      case 'views':
        return list.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1))
    }
  }, [videos, filter, sort, q])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter titles"
            className="h-7 w-full rounded-md border border-line bg-bg pl-7 pr-2 text-[12.5px] outline-none focus:border-accent/70"
          />
        </div>
        <div className="flex rounded-md border border-line p-0.5">
          {(
            [
              ['all', 'All'],
              ['short', 'Shorts'],
              ['long', 'Long-form'],
              ['transcript', 'With transcript']
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-2 py-0.5 text-[12px] ${filter === f ? 'bg-raised text-fg' : 'text-dim hover:text-fg'}`}
            >
              {label} <span className="text-faint">{counts[f]}</span>
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-7 rounded-md border border-line bg-bg px-2 text-[12.5px] text-dim outline-none"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="longest">Longest</option>
          <option value="shortest">Shortest</option>
          <option value="views">Most viewed</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && <div className="p-6 text-center text-dim">No videos match.</div>}
        {shown.map((v) => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`flex w-full items-center gap-3 border-b border-line/60 px-3 py-2 text-left hover:bg-white/[0.03] ${
              selectedId === v.id ? 'bg-accent/10 hover:bg-accent/10' : ''
            }`}
          >
            <div className="relative h-[54px] w-[96px] shrink-0 overflow-hidden rounded bg-line">
              <img src={v.thumbnail} loading="lazy" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              {v.duration != null && (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[10.5px] tabular-nums">
                  {fmtTime(v.duration)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[13px] leading-snug">{v.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint">
                <span
                  className={`rounded px-1.5 py-px text-[10.5px] font-medium ${
                    v.type === 'short' ? 'bg-pink-500/15 text-pink-300' : 'bg-sky-500/15 text-sky-300'
                  }`}
                >
                  {v.type === 'short' ? 'Short' : 'Long-form'}
                </span>
                <span title={v.dateExact ? undefined : 'Approximate — exact date loads with the transcript'}>
                  {fmtDate(v.uploadDate, v.dateExact)}
                </span>
                {v.viewCount != null && <span>· {fmtViews(v.viewCount)}</span>}
              </div>
            </div>
            <StatusPill video={v} />
          </button>
        ))}
      </div>
    </>
  )
}
