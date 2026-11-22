import { CircleNotchIcon, TrayIcon, WarningIcon } from '@phosphor-icons/react';
import { useState } from 'react';

export const fmt = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export const fdate = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

export const Header = ({ title, sub, right, kicker }) => (
  <header className="flex flex-wrap items-end justify-between gap-4 mb-10"><div>
    {kicker && <p className="label !text-emerald mb-3">{kicker}</p>}
    <h1 className="text-5xl md:text-7xl font-semibold tracking-tight leading-[0.95]">{title}</h1>
    {sub && <p className="text-mute mt-4 max-w-xl">{sub}</p>}</div>{right}</header>
);
export const Loading = () => <div role="status" className="flex items-center gap-2 text-mute py-12"><CircleNotchIcon className="animate-spin" size={16} />Loading</div>;
export const ErrorBox = ({ msg, retry }) => (
  <div role="alert" className="border border-line bg-surface p-5 flex items-center gap-3">
    <WarningIcon size={18} className="text-emerald" /><div className="flex-1"><b>Something went wrong.</b><div className="text-mute">{msg}</div></div>
    {retry && <button type="button" className="btn" onClick={retry}>Retry</button>}</div>
);
export const Empty = ({ text }) => <div className="border border-dashed border-line p-10 text-center text-mute"><TrayIcon className="block mx-auto mb-2" size={20} aria-hidden="true" />{text}</div>;
export function Thumb({ title, className = '', thumbnail }) {
  const [failed, setFailed] = useState(null);
  return <div className={`bg-surface border border-line flex items-center justify-center overflow-hidden ${className}`} title={title}>
    {thumbnail && thumbnail !== failed ? <img src={thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setFailed(thumbnail)} />
      : <svg width="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="#7BDDB0" /></svg>}
  </div>;
}
export function ClipRow({ clip, onOpen, more = 0 }) {
  const { video, topic } = clip;
  return <div className="flex flex-wrap gap-4 sm:gap-5 py-5 border-b border-line items-start">
    <Thumb title={video?.title ?? ''} thumbnail={video?.thumbnail} className="w-24 sm:w-40 aspect-video shrink-0" />
    <div className="flex-1 min-w-[120px]">
      <div className="label">{fdate(video?.publishedAt)} · from {fmt(clip.start)} · {Math.round(clip.end - clip.start)}s{topic && ` · ${topic.name}`}</div>
      <p className="text-lg font-semibold mt-1 leading-snug">“{clip.excerpt}”</p>
      <p className="text-mute mt-1 text-xs">{video?.title}{more > 0 && ` · ${more} more moment${more === 1 ? '' : 's'} in this video`}</p>
    </div>
    <button type="button" className="btn" onClick={() => onOpen(clip)}>Open in Archive</button>
  </div>;
}
