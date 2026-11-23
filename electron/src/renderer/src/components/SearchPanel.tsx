import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit, SearchResult, VideoType } from '@shared/types'
import { ExternalLink, Search } from 'lucide-react'
import { fmtDate, fmtTime, openAtTitle, renderMarked } from '../util'
import type { Selection } from '../App'

interface Props {
  channelId: string
  active: boolean
  searchable: number
  total: number
  selectedChunk: Selection | null
  onOpen(videoId: string, segIdx: number, query: string): void
}

export default function SearchPanel(p: Props) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | VideoType>('all')
  const [res, setRes] = useState<SearchResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (p.active) inputRef.current?.focus()
  }, [p.active])

  // Debounced search; re-runs as more transcripts become searchable.
  useEffect(() => {
    if (!q.trim()) {
      setRes(null)
      return
    }
    const my = ++seq.current
    const t = setTimeout(async () => {
      const r = await window.api.search(p.channelId, q, type)
      if (my === seq.current) setRes(r)
    }, 120)
    return () => clearTimeout(t)
  }, [q, type, p.channelId, p.searchable])

  const groups = useMemo(() => {
    const out: { videoId: string; first: SearchHit; hits: SearchHit[] }[] = []
    const byId = new Map<string, (typeof out)[number]>()
    for (const h of res?.hits ?? []) {
      let g = byId.get(h.videoId)
      if (!g) {
        g = { videoId: h.videoId, first: h, hits: [] }
        byId.set(h.videoId, g)
        out.push(g)
      }
      g.hits.push(h)
    }
    return out
  }, [res])

  return (
    <>
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder='Search every transcript — money   "my parents"   New York'
              spellCheck={false}
              className="h-8 w-full rounded-md border border-line bg-bg pl-8 pr-2 text-[13px] outline-none focus:border-accent/70"
            />
          </div>
          <div className="flex rounded-md border border-line p-0.5">
            {(
              [
                ['all', 'All'],
                ['short', 'Shorts'],
                ['long', 'Long-form']
              ] as ['all' | VideoType, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded px-2 py-0.5 text-[12px] ${type === t ? 'bg-raised text-fg' : 'text-dim hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-faint">
          <span>
            {res && !res.error ? (
              <>
                <span className="text-fg tabular-nums">{res.total.toLocaleString()}</span> match
                {res.total === 1 ? '' : 'es'} in <span className="text-fg tabular-nums">{res.videoCount}</span> video
                {res.videoCount === 1 ? '' : 's'} · {res.ms} ms
                {res.total > res.hits.length && ` · showing first ${res.hits.length}`}
              </>
            ) : res?.error ? (
              <span className="text-red-300">{res.error}</span>
            ) : (
              'Words must all appear in a passage. Use "quotes" for exact phrases, OR for either, word* for prefixes.'
            )}
          </span>
          <span className="shrink-0 pl-3 tabular-nums">
            {p.searchable}/{p.total} videos searchable
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {res && !res.error && res.total === 0 && (
          <div className="p-8 text-center text-dim">
            No matches in {p.searchable} indexed transcript{p.searchable === 1 ? '' : 's'}.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.videoId} className="border-b border-line">
            <div className="flex items-center gap-3 px-3 pb-1.5 pt-3">
              <img
                src={g.first.thumbnail}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-[36px] w-[64px] shrink-0 rounded bg-line object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{g.first.title}</div>
                <div className="text-[11.5px] text-faint">
                  {g.first.type === 'short' ? 'Short' : 'Long-form'} · {fmtDate(g.first.uploadDate)} · {g.hits.length}{' '}
                  match{g.hits.length === 1 ? '' : 'es'}
                </div>
              </div>
            </div>
            <div className="pb-2">
              {g.hits.map((h) => {
                const sel =
                  p.selectedChunk?.videoId === h.videoId && p.selectedChunk?.segIdx === h.segIdx
                return (
                  <div
                    key={h.chunkId}
                    onClick={() => p.onOpen(h.videoId, h.segIdx, q)}
                    className={`group flex cursor-pointer gap-3 py-1.5 pl-[88px] pr-3 hover:bg-white/[0.03] ${
                      sel ? 'bg-accent/10' : ''
                    }`}
                  >
                    <button
                      title={openAtTitle(h.platform)}
                      onClick={(e) => {
                        e.stopPropagation()
                        window.api.openYouTube(h.videoId, h.start)
                      }}
                      className="flex h-5 shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 text-[11.5px] tabular-nums text-accent hover:bg-accent/20"
                    >
                      {fmtTime(h.start)}
                      <ExternalLink size={10} className="opacity-60" />
                    </button>
                    <p className="text-[12.5px] leading-relaxed text-dim">
                      <span className="text-faint">{h.before} </span>
                      <span className="text-fg/90">{renderMarked(h.highlighted)}</span>
                      <span className="text-faint"> {h.after}</span>
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
