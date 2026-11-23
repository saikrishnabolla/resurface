import type { ReactNode } from 'react'

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function fmtViews(n: number | null): string {
  if (n == null) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B views`
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M views`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K views`
  return `${n} view${n === 1 ? '' : 's'}`
}

export function fmtDate(d: string | null, exact = true): string {
  if (!d) return 'Unknown date'
  const dt = new Date(d + 'T12:00:00')
  const s = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return exact ? s : `~${s}`
}

export const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Render text containing \u0001…\u0002 markers (from SQLite highlight()). */
export function renderMarked(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\u0001([\s\S]*?)\u0002/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={k++}>{m[1]}</mark>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Parse a query with the same rules as global search: "quoted phrases",
 * bare words, trailing * for prefix. Returns a regex that finds any term.
 */
export function termsRegex(query: string): RegExp | null {
  const terms: string[] = []
  const re = /"([^"]*)"?|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query))) {
    let t = (m[1] ?? m[2] ?? '').trim()
    if (!t || t === 'OR') continue
    const prefix = t.endsWith('*')
    t = t.replace(/[*"]/g, '').trim()
    if (!/[\p{L}\p{N}]/u.test(t)) continue
    const body = t
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^\\p{L}\\p{N}]+')
    terms.push(`(?<![\\p{L}\\p{N}])${body}${prefix ? '' : '(?![\\p{L}\\p{N}])'}`)
  }
  if (!terms.length) return null
  terms.sort((a, b) => b.length - a.length)
  return new RegExp(terms.join('|'), 'giu')
}

export const platformName = (p: string | undefined) =>
  p === 'tiktok' ? 'TikTok' : p === 'instagram' ? 'Instagram' : 'YouTube'

/** Tooltip for a timestamp link. TikTok/Instagram links can't seek. */
export const openAtTitle = (p: string | undefined) =>
  p === 'tiktok' || p === 'instagram'
    ? `Open on ${platformName(p)} (${platformName(p)} links can't jump to a time)`
    : 'Open on YouTube at this moment'

/** How the transcript was made, for display. */
export function transcriptKind(v: { platform?: string; source?: string | null; generated: boolean; language: string | null }) {
  if (v.source === 'treg-instagram') return 'AI transcript'
  const lang = v.language ? `${v.language} ` : ''
  return `${lang}${v.generated ? 'auto-captions' : 'captions'}`
}

export function ytUrl(id: string, t = 0): string {
  return `https://www.youtube.com/watch?v=${id}${t ? `&t=${Math.floor(t)}s` : ''}`
}
