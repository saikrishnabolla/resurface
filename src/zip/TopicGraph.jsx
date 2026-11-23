import { useMemo } from 'react';

const W = 720, H = 400;

// Small deterministic force layout: topics repel, shared videos attract.
export function layout(topics, links) {
  const index = new Map(topics.map((topic, i) => [topic.term, i]));
  const max = Math.max(...topics.map(topic => topic.videos), 1);
  const nodes = topics.map((topic, i) => {
    const angle = (i / Math.max(topics.length, 1)) * Math.PI * 2;
    return { ...topic, x: W / 2 + Math.cos(angle) * 260, y: H / 2 + Math.sin(angle) * 150, vx: 0, vy: 0,
      r: 6 + 16 * Math.sqrt(topic.videos / max) };
  });
  const edges = links.filter(l => index.has(l.a) && index.has(l.b))
    .map(l => ({ a: nodes[index.get(l.a)], b: nodes[index.get(l.b)], weight: l.weight }));
  for (let step = 0; step < 220; step++) {
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 60);
      const push = 16000 / d2;
      a.vx += dx / Math.sqrt(d2) * push; a.vy += dy / Math.sqrt(d2) * push;
    }
    for (const { a, b, weight } of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, pull = 0.0006 * Math.min(weight, 20);
      a.vx += dx * pull; a.vy += dy * pull; b.vx -= dx * pull; b.vy -= dy * pull;
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.0015; n.vy += (H / 2 - n.y) * 0.003;
      n.x = Math.min(W - n.r - 8, Math.max(n.r + 8, n.x + n.vx * 0.5));
      n.y = Math.min(H - n.r - 14, Math.max(n.r + 14, n.y + n.vy * 0.5)); n.vx *= 0.6; n.vy *= 0.6;
    }
  }
  return { nodes, edges };
}

export function TopicGraph({ topics, links, active, onPick }) {
  const { nodes, edges } = useMemo(() => layout(topics, links), [topics, links]);
  const top = Math.max(...links.map(l => l.weight), 1);
  return <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Topics this creator talks about" className="w-full border border-line bg-surface">
    {edges.map(({ a, b, weight }) => <line key={a.term + b.term} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
      stroke="currentColor" className="text-mute" strokeOpacity={0.1 + 0.4 * weight / top} strokeWidth={0.5 + 2 * weight / top} />)}
    {nodes.map(n => <g key={n.term} tabIndex={0} role="button" aria-pressed={active === n.term}
      aria-label={`${n.term}, in ${n.videos} videos`} style={{ cursor: 'pointer', outline: 'none' }}
      onClick={() => onPick(n.term)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(n.term); } }}>
      <circle cx={n.x} cy={n.y} r={n.r} className={active === n.term ? 'fill-emerald' : 'fill-emerald/40'} stroke="currentColor" strokeWidth={active === n.term ? 2 : 0.5} />
      <text x={n.x} y={n.y + n.r + 11} textAnchor="middle" fontSize="11" fill="currentColor">{n.term}</text>
    </g>)}
  </svg>;
}
