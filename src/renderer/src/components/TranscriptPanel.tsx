import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Segment, Video } from '@shared/types'
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, FileDown, Loader2, Search, X } from 'lucide-react'
import { fmtDate, fmtTime, fmtViews, norm, openAtTitle, platformName, termsRegex, transcriptKind } from '../util'
import type { Selection } from '../App'
import StatusPill from './StatusPill'

interface Para {
  start: number
  segs: { idx: number; start: number; text: string; from: number; to: number }[]
  text: string
}

/** Group caption lines into readable paragraphs (~30–60s, preferring sentence ends). */
function toParagraphs(segments: Segment[]): Para[] {
  const out: Para[] = []
  let cur: Para | null = null
  for (const s of segments) {
    const text = norm(s.text)
    if (!text) continue
    if (cur) {
      const span = s.start - cur.start
      const prev = cur.segs[cur.segs.length - 1].text
      if (span >= 60 || (span >= 25 && /[.?!…]["')\]]?$/.test(prev))) {
        out.push(cur)
        cur = null
      }
    }
    if (!cur) cur = { start: s.start, segs: [], text: '' }
    const from = cur.text ? cur.text.length + 1 : 0
    cur.text = cur.text ? cur.text + ' ' + text : text
    cur.segs.push({ idx: s.idx, start: s.start, text, from, to: from + text.length })
  }
  if (cur) out.push(cur)
  return out
}

interface Props {
  video: Video
  selection: Selection
  onClose(): void
}

export default function TranscriptPanel({ video, selection, onClose }: Props) {
  const [segments, setSegments] = useState<Segment[] | null>(null)
  const [query, setQuery] = useState(selection.query ?? '')
  const [current, setCurrent] = useState(0)
  const [copied, setCopied] = useState(false)
  const [focusSeg, setFocusSeg] = useState<number | undefined>(selection.segIdx)
  const bodyRef = useRef<HTMLDivElement>(null)

  // A new click from search results (same video) updates query + focus.
  useEffect(() => {
    setQuery(selection.query ?? '')
    setFocusSeg(selection.segIdx)
  }, [selection.nonce])

  useEffect(() => {
    if (video.status !== 'available') {
      setSegments(null)
      return
    }
    window.api.getTranscript(video.id).then(setSegments)
  }, [video.id, video.status])

  const paras = useMemo(() => (segments ? toParagraphs(segments) : []), [segments])

  // Local search: matches per paragraph, numbered globally.
  const matches = useMemo(() => {
    const re = termsRegex(query)
    const out: { p: number; from: number; to: number; seg: number }[] = []
    if (!re) return out
    paras.forEach((para, p) => {
      for (const m of para.text.matchAll(re)) {
        const from = m.index!
        const seg = para.segs.find((s) => from < s.to + 1)?.idx ?? para.segs[0].idx
        out.push({ p, from, to: from + m[0].length, seg })
      }
    })
    return out
  }, [paras, query])

  // When arriving from search, make the "current" match the one at the clicked passage.
  useEffect(() => {
    if (focusSeg != null && matches.length) {
      const i = matches.findIndex((m) => m.seg >= focusSeg)
      setCurrent(i >= 0 ? i : 0)
    } else setCurrent(0)
  }, [matches, focusSeg])

  // Scroll to the focused segment once the transcript is rendered.
  useLayoutEffect(() => {
    if (focusSeg == null || !paras.length || !bodyRef.current) return
    let el: HTMLElement | null = null
    for (let i = focusSeg; i >= 0 && !el; i--) el = bodyRef.current.querySelector(`[data-seg="${i}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
    }
  }, [paras, focusSeg, selection.nonce])

  const goto = (i: number) => {
    if (!matches.length) return
    const n = (i + matches.length) % matches.length
    setCurrent(n)
    setFocusSeg(undefined)
    requestAnimationFrame(() =>
      bodyRef.current?.querySelector(`[data-m="${n}"]`)?.scrollIntoView({ block: 'center' })
    )
  }

  const plain = () =>
    paras.map((p) => `[${fmtTime(p.start)}] ${p.text}`).join('\n\n')

  const copy = async () => {
    await window.api.copyText(plain())
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <aside className="flex w-[46%] min-w-[420px] max-w-[720px] flex-col bg-panel">
      <div className="flex gap-3 border-b border-line p-3">
        <img
          src={video.thumbnail}
          referrerPolicy="no-referrer"
          className="h-[68px] w-[120px] shrink-0 cursor-pointer rounded bg-line object-cover"
          onClick={() => window.api.openYouTube(video.id, 0)}
        />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[14px] font-semibold leading-snug">{video.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-faint">
            <span>{video.type === 'short' ? 'Short' : 'Long-form'}</span>
            <span>· {fmtDate(video.uploadDate, video.dateExact)}</span>
            {video.duration != null && <span>· {fmtTime(video.duration)}</span>}
            {video.viewCount != null && <span>· {fmtViews(video.viewCount)}</span>}
            {video.status === 'available' && (
              <span>
                · {transcriptKind(video)}
              </span>
            )}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <ToolButton onClick={() => window.api.openYouTube(video.id, 0)} icon={<ExternalLink size={13} />}>
              {platformName(video.platform)}
            </ToolButton>
            <ToolButton disabled={!paras.length} onClick={copy} icon={copied ? <Check size={13} /> : <Copy size={13} />}>
              {copied ? 'Copied' : 'Copy'}
            </ToolButton>
            <ToolButton
              disabled={!paras.length}
              onClick={() => window.api.exportTranscript(video.id)}
              icon={<FileDown size={13} />}
            >
              Export .txt
            </ToolButton>
          </div>
        </div>
        <button onClick={onClose} className="self-start text-faint hover:text-fg" title="Close">
          <X size={16} />
        </button>
      </div>

      {video.status === 'available' && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setFocusSeg(undefined)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') goto(current + (e.shiftKey ? -1 : 1))
                if (e.key === 'Escape') setQuery('')
              }}
              placeholder="Search this transcript"
              spellCheck={false}
              className="h-7 w-full rounded-md border border-line bg-bg pl-7 pr-2 text-[12.5px] outline-none focus:border-accent/70"
            />
          </div>
          {query.trim() && (
            <>
              <span className="w-16 text-right text-[11.5px] tabular-nums text-faint">
                {matches.length ? `${current + 1}/${matches.length}` : '0 found'}
              </span>
              <button className="text-dim hover:text-fg" onClick={() => goto(current - 1)}>
                <ChevronUp size={15} />
              </button>
              <button className="text-dim hover:text-fg" onClick={() => goto(current + 1)}>
                <ChevronDown size={15} />
              </button>
            </>
          )}
        </div>
      )}

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {video.status !== 'available' ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-dim">
            <StatusPill video={video} />
            {video.status === 'processing' || video.status === 'pending' ? (
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />{' '}
                {video.platform === 'instagram' ? 'Transcribing…' : 'Fetching captions…'}
              </div>
            ) : (
              <div className="max-w-sm text-[12.5px] leading-relaxed">
                {video.statusMessage ?? 'No transcript.'}
              </div>
            )}
          </div>
        ) : !segments ? (
          <div className="py-16 text-center text-dim">Loading…</div>
        ) : (
          paras.map((para, p) => (
            <div key={p} className="mb-4 flex gap-3">
              <button
                onClick={() => window.api.openYouTube(video.id, para.start)}
                title={openAtTitle(video.platform)}
                className="mt-[2px] h-5 w-[52px] shrink-0 rounded text-right text-[11.5px] tabular-nums text-accent/90 hover:bg-accent/10 hover:text-accent"
              >
                {fmtTime(para.start)}
              </button>
              <p className="text-[13.5px] leading-[1.7] text-fg/90">
                {para.segs.map((s, si) => (
                  <span key={s.idx}>
                    {si > 0 && ' '}
                    <span
                      data-seg={s.idx}
                      className="rounded-sm"
                      title={fmtTime(s.start)}
                      onDoubleClick={() => window.api.openYouTube(video.id, s.start)}
                    >
                      {renderSeg(s, para, p, matches, current)}
                    </span>
                  </span>
                ))}
              </p>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function renderSeg(
  s: Para['segs'][number],
  _para: Para,
  p: number,
  matches: { p: number; from: number; to: number }[],
  current: number
) {
  const parts: React.ReactNode[] = []
  let pos = s.from
  matches.forEach((m, i) => {
    if (m.p !== p || m.to <= s.from || m.from >= s.to) return
    const a = Math.max(m.from, s.from)
    const b = Math.min(m.to, s.to)
    if (a > pos) parts.push(s.text.slice(pos - s.from, a - s.from))
    parts.push(
      <mark key={i} data-m={m.from >= s.from ? i : undefined} className={i === current ? 'current' : ''}>
        {s.text.slice(a - s.from, b - s.from)}
      </mark>
    )
    pos = b
  })
  if (pos < s.to) parts.push(s.text.slice(pos - s.from))
  return parts
}

function ToolButton(props: {
  onClick(): void
  icon: React.ReactNode
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex h-6 items-center gap-1 rounded border border-line px-2 text-[11.5px] text-dim hover:border-line-strong hover:text-fg disabled:opacity-40"
    >
      {props.icon}
      {props.children}
    </button>
  )
}
