import { useEffect, useRef, useState } from 'react';
import { Header, fmt } from './ui.jsx';
import stories from './demo-jahbari.json';

function Short({ story, index }) {
  const video = useRef(null);
  const [sound, setSound] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  // Play while on screen, pause otherwise, so ten videos don't all run at once.
  useEffect(() => {
    const el = video.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const watch = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) el.play().catch(() => {}); else el.pause(); }, { threshold: 0.6 });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const replay = () => { const el = video.current; if (el) { el.currentTime = 0; void el.play(); } };
  return <article className="border border-line p-5 mb-5 grid sm:grid-cols-[220px_minmax(0,1fr)] gap-6" aria-label={`Reel ${index + 1}`}>
    <div>
      <video ref={video} src={`/demo/jahbari/${story.file}`} className="w-full aspect-[9/16] bg-surface border border-line" muted={!sound}
        playsInline loop controls preload="metadata" aria-label={`Reel for: ${story.title}`} />
      <div className="flex gap-2 mt-2">
        <button type="button" className="btn !py-1 !text-[11px]" onClick={replay}>Replay</button>
        <button type="button" className="btn !py-1 !text-[11px]" aria-pressed={sound} onClick={() => setSound(on => !on)}>Sound {sound ? 'on' : 'off'}</button>
      </div>
    </div>
    <div className="min-w-0">
      <p className="label mb-2"><span className="text-emerald">{index + 1}</span> · {story.date} · {story.source}</p>
      <h3 className="text-xl font-semibold tracking-tight leading-snug">{story.title}</h3>
      <a href={story.url} target="_blank" rel="noreferrer" className="text-mute text-xs underline underline-offset-4 hover:text-emerald">Read the story</a>
      <p className="label mt-5 mb-1">The clip of you</p>
      <p className="font-medium leading-snug">“{story.quote}”</p>
      <p className="text-mute text-xs mt-1">{story.beat} · <a className="underline underline-offset-4 hover:text-emerald" target="_blank" rel="noreferrer"
        href={`https://www.youtube.com/watch?v=${story.video}&t=${Math.floor(story.start)}s`}>Watch at {fmt(story.start)}</a></p>
      <form className="flex gap-2 mt-5 max-w-sm" onSubmit={event => { event.preventDefault(); if (note.trim()) { setSent(true); setNote(''); } }}>
        <input className="input !py-1 !text-xs min-w-0 flex-1" aria-label={`Feedback on reel ${index + 1}`} value={note} maxLength={300}
          placeholder="Feedback on this one" onChange={event => { setNote(event.target.value); setSent(false); }} />
        <button className="btn !py-1 !text-xs" type="submit" disabled={!note.trim()}>Send</button>
      </form>
      {sent && <p className="label mt-1">Noted (not saved yet)</p>}
    </div>
  </article>;
}

// Pre-rendered demo: ten finished reels for Jahbari Taylor (22 Nov 2026), made offline from his archive and that week's news.
export function DemoReels() {
  const [mode, setMode] = useState('looks');
  const frameRef = useRef(null);
  // The looks page is same-origin: grow its frame to fit, so the page scrolls once.
  useEffect(() => {
    if (mode !== 'looks') return undefined;
    const fit = () => { try { const frame = frameRef.current; frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'; } catch { /* keep default */ } };
    const timer = window.setInterval(fit, 1000);
    return () => window.clearInterval(timer);
  }, [mode]);
  return <>
    <Header kicker="03 / Demo" title="This week’s news, with your own clips"
      sub="Ten reels made for Jahbari Taylor from the week’s news and clips he already posted. Pre-rendered for the demo." />
    <div className="flex gap-2 mb-8" role="group" aria-label="Demo view">
      {[['looks', 'Three looks per story'], ['shorts', 'Finished shorts']].map(([key, label]) =>
        <button key={key} type="button" className="btn" aria-pressed={mode === key}
          style={mode === key ? { borderColor: '#7BDDB0', color: '#7BDDB0' } : undefined} onClick={() => setMode(key)}>{label}</button>)}
    </div>
    {mode === 'looks'
      ? <iframe title="Three looks per story" src="/demo/jahbari/variations/index.html" className="w-full border border-line bg-cream" style={{ height: '1600px' }} ref={frameRef} />
      : stories.map((story, i) => <Short key={story.file} story={story} index={i} />)}
  </>;
}
export default DemoReels;
