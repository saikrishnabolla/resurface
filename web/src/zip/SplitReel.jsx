import { useState } from 'react';
import { Thumb, fmt } from './ui.jsx';

const cut = (text, max) => text.length > max ? text.slice(0, max) + '…' : text;
const badge = date => Number.isFinite(Date.parse(date))
  ? new Date(date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '').toUpperCase()
  : 'THIS WEEK';

// Three looks per story. Each one is a vertical reel: the news on top, the creator's own clip below.
const LOOKS = [
  { id: 'simple', label: 'Simple', theme: 'Midnight lemon', bg: '#0B0B0B', fg: '#FFFFFF', tag: '#FFE14D', tagFg: '#0B0B0B', art: '#FFE14D' },
  { id: 'exaggerated', label: 'Exaggerated', theme: 'Butter violet', bg: '#FBEA9A', fg: '#14110A', tag: '#5B3DF5', tagFg: '#FFFFFF', art: '#5B3DF5' },
  { id: 'funny', label: 'Funny', theme: 'Electric blue', bg: '#2438F5', fg: '#FFFFFF', tag: '#FFE14D', tagFg: '#0B0B0B', art: '#FFFFFF' },
];

function Reel({ look, story, clip, replay }) {
  const [sound, setSound] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 mb-1.5 text-[10px] uppercase tracking-wider">
      <span className="text-mute truncate"><b className="text-ink">{look.label}</b> {look.theme}</span>
      <button type="button" aria-pressed={sound} onClick={() => setSound(on => !on)}
        className="border border-line px-1.5 py-0.5 text-mute hover:text-ink">Sound {sound ? 'on' : 'off'}</button>
    </div>
    <div key={replay} className="reel aspect-[9/16] grid grid-rows-[11fr_9fr] overflow-hidden border border-line bg-cream">
      <div className="relative p-3 flex flex-col" style={{ background: look.bg, color: look.fg }}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold">
          <span className="px-1.5 py-0.5" style={{ background: look.tag, color: look.tagFg }}>{badge(story.date)}</span>
          <span className="opacity-70 truncate">{story.publisher}</span>
        </div>
        <p className="font-extrabold leading-tight text-[15px] mt-2">{cut(story.title, 70)}</p>
        <div className="flex-1 mt-2 border border-dashed flex items-center justify-center text-[9px] uppercase tracking-wider opacity-70"
          style={{ borderColor: look.art }}>News graphic · placeholder</div>
      </div>
      <div className="relative">
        <Thumb title={clip.video.title} thumbnail={clip.video.thumbnail} className="absolute inset-0 !border-0" />
        <span className="absolute top-2 left-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 bg-black/70 text-white">Your clip · placeholder</span>
        <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-1 rounded-full bg-white text-black">▶ Watch the full video</span>
        <p className="absolute inset-x-0 bottom-0 px-3 pb-2 pt-8 text-center text-[11px] font-semibold text-white bg-gradient-to-t from-black/80 to-transparent">
          {cut(clip.excerpt, 60)}</p>
      </div>
    </div>
    <form className="flex gap-1.5 mt-2" onSubmit={event => { event.preventDefault(); if (note.trim()) { setSent(true); setNote(''); } }}>
      <input className="input !py-1 !text-[11px] min-w-0 flex-1" aria-label={`Feedback on the ${look.label} reel`} value={note} maxLength={300}
        placeholder="Feedback on this one" onChange={event => { setNote(event.target.value); setSent(false); }} />
      <button className="btn !py-1 !text-[11px]" type="submit" disabled={!note.trim()}>Send</button>
    </form>
    {sent && <p className="label mt-1">Noted (not saved yet)</p>}
  </div>;
}

function StoryReels({ index, story, clip }) {
  const [replay, setReplay] = useState(0);
  return <article className="border border-line p-5 mb-5" aria-label={`Reels for story ${index + 1}`}>
    <div className="flex items-start justify-between gap-4">
      <h3 className="text-lg font-semibold tracking-tight"><span className="text-mute mr-2">{index + 1}</span>{story.title}</h3>
      <button type="button" className="btn shrink-0" onClick={() => setReplay(n => n + 1)}>Replay</button>
    </div>
    <p className="text-mute text-xs mt-1 mb-4">Clip: “{cut(clip.excerpt, 140)}” · {clip.video.title} · Watch at {fmt(clip.start)}</p>
    <div className="grid grid-cols-3 gap-3 sm:gap-5">
      {LOOKS.map(look => <Reel key={look.id} look={look} story={story} clip={clip} replay={replay} />)}
    </div>
  </article>;
}

// One row per news story: the story paired with one of the creator's own earlier clips, in three looks.
// News graphics and clip footage are placeholders until real videos are wired in.
export function SplitReel({ stories, moments }) {
  return <section aria-label="Split reels" className="mb-10">
    <h2 className="text-2xl font-semibold tracking-tight mb-1">Reels, ready to review</h2>
    <p className="text-mute text-sm mb-5">The story on top, what you already said below. Pick the look that fits.</p>
    {stories.slice(0, 5).map((story, i) =>
      <StoryReels key={story.url} index={i} story={story} clip={moments[i % moments.length].clip} />)}
  </section>;
}
