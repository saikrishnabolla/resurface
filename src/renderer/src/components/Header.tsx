import { useEffect, useRef, useState } from 'react'
import type { Channel, ImportState, Progress } from '@shared/types'
import { AlertCircle, ChevronDown, Coins, Download, Loader2, RotateCcw, Trash2, User } from 'lucide-react'
import type { TregUsage } from '@shared/types'

interface Props {
  channels: Channel[]
  channel: Channel | null
  progress: Progress | null
  importState: ImportState
  onImport(url: string): Promise<{ ok: boolean; error?: string }>
  onSwitch(id: string): void
  onRemove(id: string): void
  onRetry(): void
}

export default function Header(p: Props) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = p.importState.stage === 'catalog'

  const submit = async () => {
    const u = url.trim()
    if (!u || busy) return
    setError(null)
    const r = await p.onImport(u)
    if (r.ok) setUrl('')
    else setError(r.error ?? 'Import failed')
  }

  const pr = p.progress
  const pct = pr && pr.total ? (pr.processed / pr.total) * 100 : 0

  return (
    <header className="border-b border-line bg-panel">
      {/* Row 1: drag region + import */}
      <div className="drag flex h-[50px] items-center gap-3 pl-[84px] pr-3">
        <div className="text-[13px] font-semibold tracking-tight text-dim">Resurface</div>
        <form
          className="no-drag flex max-w-[640px] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube, TikTok or Instagram profile URL — youtube.com/@name, tiktok.com/@name, instagram.com/name"
            spellCheck={false}
            className="h-8 flex-1 rounded-md border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent/70"
          />
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {busy ? 'Importing…' : 'Import'}
          </button>
        </form>
        <div className="flex-1" />
        <TregUsagePill tick={p.progress?.processed ?? 0} />
        {p.channels.length > 0 && <ChannelMenu {...p} />}
      </div>

      {(error || p.importState.stage === 'error') && (
        <div className="flex items-center gap-2 border-t border-line bg-red-500/10 px-4 py-1.5 text-[12.5px] text-red-300">
          <AlertCircle size={14} /> {error ?? p.importState.message}
        </div>
      )}

      {/* Row 2: channel identity + progress */}
      {p.channel && (
        <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
          <Avatar src={p.channel.thumbnail} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[14px] font-semibold">{p.channel.name}</span>
              <PlatformTag platform={p.channel.platform} />
              {p.channel.handle && <span className="text-[12px] text-faint">{p.channel.handle}</span>}
            </div>
            {p.channel.description && (
              <div className="truncate text-[12px] text-dim" title={p.channel.description}>
                {p.channel.description.replace(/\s+/g, ' ')}
              </div>
            )}
          </div>
          {pr && (
            <div className="w-[300px] shrink-0">
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 text-dim">
                  {pr.active && <Loader2 size={12} className="animate-spin text-accent" />}
                  <span className="text-fg tabular-nums">
                    {pr.processed}/{pr.total}
                  </span>{' '}
                  transcripts processed
                </span>
                <span className="tabular-nums text-faint">
                  {pr.available} ok · {pr.unavailable} none
                  {pr.failed > 0 && <span className="text-red-400"> · {pr.failed} failed</span>}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
              {(pr.paused || (pr.failed > 0 && !pr.active)) && (
                <div className="mt-1 flex items-center justify-between text-[11.5px]">
                  <span className="text-amber-300/90">{pr.paused ?? ''}</span>
                  {pr.failed > 0 && !pr.active && (
                    <button onClick={p.onRetry} className="flex items-center gap-1 text-accent hover:underline">
                      <RotateCcw size={11} /> Retry failed
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  )
}

function ChannelMenu(p: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])
  return (
    <div ref={ref} className="no-drag relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-2 rounded-md border border-line px-2 text-[12.5px] text-dim hover:text-fg"
      >
        Channels <span className="text-faint">{p.channels.length}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-72 overflow-hidden rounded-lg border border-line-strong bg-raised shadow-2xl">
          {p.channels.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-2 px-2.5 py-2 hover:bg-white/5 ${c.id === p.channel?.id ? 'bg-white/5' : ''}`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => {
                  p.onSwitch(c.id)
                  setOpen(false)
                }}
              >
                <Avatar src={c.thumbnail} size={22} />
                <span className="truncate">{c.name}</span>
                <PlatformTag platform={c.platform} />
              </button>
              <button
                title="Remove channel and its transcripts"
                className="text-faint opacity-0 hover:text-red-400 group-hover:opacity-100"
                onClick={() => p.onRemove(c.id)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Avatar({ src, size }: { src: string | null; size: number }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken)
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full bg-line text-faint"
        style={{ width: size, height: size }}
      >
        <User size={size * 0.55} />
      </div>
    )
  return (
    <img
      src={src}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-line object-cover"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
    />
  )
}

const usd = (micro: number) => {
  const v = micro / 1e6
  return v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`
}

/** treg spend: calls made by this app, what they cost, and the team balance. */
function TregUsagePill({ tick }: { tick: number }) {
  const [u, setU] = useState<TregUsage | null>(null)
  const last = useRef(0)
  const load = (force = false) => {
    last.current = Date.now()
    window.api.getTregUsage(force).then(setU).catch(() => {})
  }
  useEffect(() => {
    load()
    const t = setInterval(() => load(), 60_000)
    return () => clearInterval(t)
  }, [])
  // Refresh as transcripts complete, at most every 3s.
  useEffect(() => {
    if (Date.now() - last.current > 3000) load()
  }, [tick])
  if (!u) return null
  const low = u.balanceMicro != null && u.balanceMicro < 20_000 // fewer than ~10 transcripts left
  const title = [
    'treg (ScrapeCreators transcripts)',
    `This app: ${u.calls.toLocaleString()} requests, ${u.billedCalls.toLocaleString()} billed, ${usd(u.spentMicro)} spent`,
    `This session: ${u.sessionCalls.toLocaleString()} requests, ${usd(u.sessionSpentMicro)}`,
    u.balanceMicro != null ? `Team balance: ${usd(u.balanceMicro)}` : `Balance unavailable: ${u.balanceError ?? 'unknown'}`,
    u.disabled ? `Paused: ${u.disabled} (using free fallbacks)` : '',
    'Click to refresh. Top up with: treg topup'
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <button
      onClick={() => load(true)}
      title={title}
      className={`no-drag flex h-8 items-center gap-1.5 rounded-md border px-2 text-[12px] tabular-nums ${
        low || u.disabled ? 'border-amber-500/40 text-amber-300' : 'border-line text-dim hover:text-fg'
      }`}
    >
      <Coins size={13} />
      <span>treg</span>
      <span className="text-faint">·</span>
      <span>
        {u.calls.toLocaleString()} calls
        {u.billedCalls !== u.calls && <span className="text-faint"> ({u.billedCalls.toLocaleString()} billed)</span>}
      </span>
      <span className="text-faint">·</span>
      <span>{usd(u.spentMicro)} spent</span>
      <span className="text-faint">·</span>
      <span className={low ? 'text-amber-300' : 'text-fg'}>
        {u.balanceMicro != null ? `${usd(u.balanceMicro)} left` : 'balance ?'}
      </span>
    </button>
  )
}

function PlatformTag({ platform }: { platform: string }) {
  const cls =
    platform === 'tiktok'
      ? 'bg-cyan-500/12 text-cyan-300'
      : platform === 'instagram'
        ? 'bg-fuchsia-500/12 text-fuchsia-300'
        : 'bg-red-500/12 text-red-300'
  const label = platform === 'tiktok' ? 'TikTok' : platform === 'instagram' ? 'Instagram' : 'YouTube'
  return <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium ${cls}`}>{label}</span>
}
