import type { Video } from '@shared/types'
import { Loader2 } from 'lucide-react'

const STYLES: Record<Video['status'], [string, string]> = {
  available: ['Available', 'bg-emerald-500/12 text-emerald-300 border-emerald-500/20'],
  processing: ['Processing', 'bg-accent/10 text-accent border-accent/25'],
  pending: ['Processing', 'bg-transparent text-faint border-line'],
  unavailable: ['Unavailable', 'bg-transparent text-dim border-line'],
  failed: ['Failed', 'bg-red-500/10 text-red-300 border-red-500/25']
}

export default function StatusPill({ video }: { video: Video }) {
  const [label, cls] = STYLES[video.status]
  const title =
    video.status === 'pending'
      ? video.statusMessage ?? 'Queued'
      : video.status === 'available'
        ? video.source === 'treg-instagram'
          ? 'AI speech-to-text transcript (Instagram)'
          : `${video.language ?? ''} ${video.generated ? 'auto-generated' : 'manual'} captions`.trim()
        : (video.statusMessage ?? undefined)
  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {video.status === 'processing' && <Loader2 size={10} className="animate-spin" />}
      {video.status === 'pending' ? 'Queued' : label}
    </span>
  )
}
