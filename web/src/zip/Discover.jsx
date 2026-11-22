import { useEffect, useRef, useState } from 'react';
import { Header, Loading, ErrorBox, Empty, ClipRow, fdate } from './ui.jsx';
import { searchDiscover } from './discover-model.mjs';
import { TopicGraph } from './TopicGraph.jsx';
import { SplitReel } from './SplitReel.jsx';

// One clip per video, newest first, so the list shows distinct moments instead of repeats.
function distinct(clips, limit = 6) {
  const seen = new Map();
  for (const clip of clips.slice().sort((a, b) => b.video.publishedAt.localeCompare(a.video.publishedAt))) {
    const entry = seen.get(clip.video.id);
    if (entry) entry.more += 1; else seen.set(clip.video.id, { clip, more: 0 });
  }
  return [...seen.values()].slice(0, limit);
}

export function Discover({ accounts, entries, findStories, findMatches, loadTopics, onOpen, onResults }) {
  const [niche, setNiche] = useState(null);
  const [rows, setRows] = useState({});
  const [order, setOrder] = useState([]);
  const [selected, setSelected] = useState('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState('');
  const run = useRef(0);
  const nicheWords = useRef([]);
  const scope = JSON.stringify(accounts.map(account => account.url));
  const ready = accounts.map(account => entries?.[account.url]?.snapshot?.videos?.length ?? 0).join(',');

  async function load(term) {
    const token = run.current;
    setRows(current => ({ ...current, [term]: { status: 'loading' } }));
    const result = await searchDiscover({
      query: term, accounts, entries,
      findStories: query => findStories(query, { terms: [query], context: nicheWords.current }),
      findMatches,
    });
    if (token === run.current) setRows(current => ({ ...current, [term]: { status: 'done', ...result } }));
    return result;
  }

  useEffect(() => {
    const token = ++run.current;
    setNiche(null); setRows({}); setOrder([]); setSelected(''); setError('');
    (async () => {
      const loaded = await Promise.all(accounts.map(account => loadTopics(account.url).catch(() => null).then(data => ({ account, data }))));
      if (token !== run.current) return;
      // Use the account with the deepest transcript archive as the picture of the creator's niche.
      const { account, data } = loaded.filter(item => item.data?.topics?.length)
        .sort((a, b) => b.data.videoCount - a.data.videoCount)[0] ?? {};
      if (data) {
        setNiche({ ...data, account });
        nicheWords.current = [...new Set(data.topics.slice(0, 12).flatMap(topic => topic.term.split(' ')))].filter(word => word.length > 3);
        const lead = data.topics.filter(topic => topic.videos / data.videoCount < 0.4).slice(0, 6).map(topic => topic.term);
        setOrder(lead);
        const results = await Promise.all(lead.map(term => load(term).catch(() => null)));
        if (token !== run.current) return;
        const best = lead.find((term, i) => results[i]?.topic.sources.length && results[i].clips.length) ?? lead[0];
        setSelected(best);
      }
    })();
    return () => { run.current += 1; };
  }, [scope, ready]);

  const row = rows[selected];
  const done = row?.status === 'done' ? row : null;
  useEffect(() => { onResults(done?.clips ?? []); }, [done]);
  const moments = done ? distinct(done.clips) : [];
  const story = done?.topic.sources[0];
  const pair = story && moments[0];

  async function pick(term) {
    setSelected(term);
    setOrder(current => current.includes(term) ? current : [term, ...current]);
    if (!rows[term] || rows[term].status === 'error') await load(term);
    document.getElementById('discover-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return <>
    <Header kicker="01 / Discover" title="What's worth revisiting?"
      sub="Topics you keep coming back to, matched with this week’s news and the moments in your archive that cover them." />
    {!accounts.length ? <Empty text="Connect an account to see your topics." />
      : !niche ? <Loading />
        : <>
          <div className="border-t border-line mb-12" role="list" aria-label="Your topics">
            {order.map((term, i) => {
              const info = rows[term];
              const stories = info?.status === 'done' ? info.topic.sources.length : null;
              const videos = niche.topics.find(topic => topic.term === term)?.videos;
              return <button key={term} type="button" role="listitem" aria-pressed={selected === term} onClick={() => pick(term)}
                className="w-full flex flex-wrap items-baseline gap-x-5 gap-y-1 py-4 border-b border-line text-left">
                <span className="label w-6">0{i + 1}</span>
                <span className={`text-3xl md:text-5xl font-semibold tracking-tight ${selected === term ? 'text-emerald' : 'text-ink hover:text-emerald'}`}>{term}</span>
                {stories > 0 && <span className="label !text-emerald border border-emerald px-1.5 py-0.5">{stories} in the news</span>}
                {stories === 0 && <span className="label">Quiet this week</span>}
                {stories === null && <span className="label">Checking news…</span>}
                {videos && <span className="label ml-auto">{videos} videos</span>}
              </button>;
            })}
          </div>
          <div id="discover-detail" className="scroll-mt-6">
            {error && <ErrorBox msg={error} />}
            {!selected || !done ? (selected ? <Loading /> : null) : <>
              <h2 className="text-2xl font-semibold tracking-tight mb-2">In the news</h2>
              {done.newsError ? <ErrorBox msg="You.com news search is unavailable right now." retry={() => load(selected)} />
                : !done.topic.sources.length ? <p className="text-mute py-4">No fresh stories name “{selected}” this week.</p>
                  : <ul aria-label="You.com news" className="border-t border-line mb-10">{done.topic.sources.slice(0, 5).map(item =>
                    <li key={item.url} className="border-b border-line py-3 flex flex-wrap items-baseline gap-x-4">
                      <a className="font-medium hover:text-emerald underline underline-offset-4" href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                      <span className="text-mute text-xs">{item.publisher}{item.date && ` · ${fdate(item.date)}`}</span>
                    </li>)}</ul>}
              {pair && <SplitReel key={selected} stories={done.topic.sources} moments={moments} />}
              <h2 className="text-2xl font-semibold tracking-tight mb-2">
                {moments.length ? `${moments.length} video${moments.length === 1 ? '' : 's'} where you cover ${selected}` : `Where you cover ${selected}`}
              </h2>
              {!!done.failedArchives.length && <ErrorBox msg={`Couldn’t search ${done.failedArchives.map(item => item.platform + ' ' + item.handle).join(', ')}.`} retry={() => load(selected)} />}
              {moments.length
                ? <div className="border-t border-line">{moments.map(({ clip, more }) =>
                  <ClipRow key={clip.id} clip={clip} more={more} onOpen={onOpen} />)}</div>
                : <Empty text="No saved transcript says that exact phrase." />}
            </>}
          </div>
          <section className="mt-16" aria-label="Your niche map">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="text-2xl font-semibold tracking-tight">Your niche map</h2>
              <span className="label">From {niche.videoCount} transcripts · bigger = in more videos · click a topic</span></div>
            <TopicGraph topics={niche.topics} links={niche.links} active={selected} onPick={pick} />
            <form className="flex flex-wrap items-end gap-2 mt-6" onSubmit={event => { event.preventDefault(); const term = custom.trim(); if (term) { setCustom(''); void pick(term); } }}>
              <label className="flex-1 min-w-[200px]" htmlFor="discover-topic"><span className="label block mb-2">Look up any other topic</span>
                <input id="discover-topic" className="input" value={custom} maxLength={120} placeholder="A topic or phrase you’ve said"
                  onChange={event => setCustom(event.target.value)} /></label>
              <button className="btn btn-primary" type="submit" disabled={!custom.trim()}>Look up</button>
            </form>
          </section>
        </>}
  </>;
}

export default Discover;
