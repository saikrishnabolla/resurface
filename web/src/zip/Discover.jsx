import { useEffect, useRef, useState } from 'react';
import { Header, Loading, ErrorBox, Empty, ClipRow } from './ui.jsx';
import { searchDiscover } from './discover-model.mjs';
import { TopicGraph } from './TopicGraph.jsx';

export function Discover({ accounts, entries, findStories, findMatches, loadTopics, onOpen, onResults }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [sort, setSort] = useState('date');
  const [searching, setSearching] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const sequence = useRef(0);
  const scope = JSON.stringify(accounts.map(account => account.url));
  const [niche, setNiche] = useState(null);
  const [feed, setFeed] = useState([]);
  const ready = accounts.map(account => entries?.[account.url]?.snapshot?.videos?.length ?? 0).join(',');
  useEffect(() => {
    let live = true;
    setNiche(null); setFeed([]);
    (async () => {
      for (const account of accounts) {
        const data = await loadTopics(account.url).catch(() => null);
        if (!live || !data?.topics?.length) continue;
        setNiche({ ...data, account });
        const lead = data.topics.filter(topic => topic.videos / data.videoCount < 0.4).slice(0, 4);
        const stories = await Promise.allSettled(lead.map(topic => findStories(topic.term)));
        if (live) setFeed(lead.map((topic, i) => ({ topic, stories: stories[i].status === 'fulfilled' ? stories[i].value.stories.slice(0, 3) : [] })));
        return;
      }
    })();
    return () => { live = false; };
  }, [scope, ready]);
  useEffect(() => {
    setResult(null);
    setSearching(false);
    return () => { sequence.current += 1; };
  }, [scope]);

  async function search(term) {
    const keyword = term.trim();
    if (!keyword || !accounts.length) return;
    const attempt = ++sequence.current;
    setSearching(true);
    setResult(null);
    onResults([]);
    const next = await searchDiscover({ query: keyword, accounts, entries, findStories, findMatches });
    if (attempt !== sequence.current) return;
    setResult(next);
    setShowSources(true);
    onResults(next.clips);
    setSearching(false);
  }

  const list = (result?.clips ?? []).slice().sort((a, b) => sort === 'len'
    ? (a.end - a.start) - (b.end - b.start)
    : b.video.publishedAt.localeCompare(a.video.publishedAt));
  const retry = result ? () => search(result.topic.name) : undefined;
  const allArchivesFailed = result && result.failedArchives.length === accounts.length;
  return <>
    <Header kicker="01 / Discover" title="What's worth revisiting?"
      sub="Look up a topic in today’s news and find where it appears in your archive." />
    {niche && <section className="mb-10" aria-label="Your niche">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-2xl font-semibold tracking-tight">Your niche</h2>
        <span className="label">From {niche.videoCount} transcripts · bigger = in more videos · click a topic</span></div>
      <TopicGraph topics={niche.topics} links={niche.links} active={query} onPick={term => { setQuery(term); void search(term); }} />
    </section>}
    {feed.length > 0 && <section className="mb-10" aria-label="Latest news for your niche">
      <h2 className="text-2xl font-semibold tracking-tight mb-3">Latest for your niche</h2>
      <p className="text-mute text-xs mb-3">Last-week news from You.com on the topics you talk about most.</p>
      <div className="border-t border-line">{feed.map(({ topic, stories }) => <div key={topic.term} className="py-4 border-b border-line">
        <div className="flex items-baseline gap-3 flex-wrap"><span className="text-xl font-semibold text-emerald">{topic.term}</span>
          <span className="label">{topic.videos} videos</span>
          <button type="button" className="btn" onClick={() => { setQuery(topic.term); void search(topic.term); }}>Find my clips</button></div>
        {stories.length ? <ul className="mt-2">{stories.map(story => <li key={story.url} className="py-1">
          <a className="hover:text-emerald underline underline-offset-4" href={story.url} target="_blank" rel="noreferrer">{story.title}</a></li>)}</ul>
          : <p className="text-mute text-sm mt-1">No recent stories.</p>}
      </div>)}</div></section>}
    <form className="flex flex-wrap items-end gap-2 mb-8" onSubmit={event => { event.preventDefault(); void search(query); }}>
      <label className="flex-1 min-w-[200px]" htmlFor="discover-topic"><span className="label block mb-2">Topic</span>
        <input id="discover-topic" className="input" value={query} maxLength={120} required
          placeholder="Search for a topic or phrase" onChange={event => setQuery(event.target.value)} /></label>
      <button className="btn btn-primary" type="submit" disabled={!query.trim() || !accounts.length}>
        {searching ? 'Searching…' : 'Search'}
      </button>
    </form>
    <div className="border-t border-line mb-12">
      {result && <>
        <button type="button" aria-expanded={showSources} aria-controls="discover-sources"
          onClick={() => setShowSources(!showSources)}
          className="w-full flex flex-wrap items-baseline gap-x-5 gap-y-2 py-4 border-b border-line text-left">
          <span className="label w-6">01</span>
          <span className="text-3xl md:text-4xl font-semibold tracking-tight text-emerald break-words min-w-0 max-w-full">{result.topic.name}</span>
          <span className="label !text-emerald border border-emerald px-1.5 py-0.5">
            {result.newsError ? 'Sources unavailable' : `${result.topic.sources.length} news sources`}
          </span>
        </button>
        <div id="discover-sources" hidden={!showSources}>
          {result.newsError ? <ErrorBox msg="You.com news search is unavailable. You can still open archive matches." retry={retry} />
            : !result.topic.sources.length ? <p className="text-mute py-4">No recent You.com sources found for this topic.</p>
            : <ul aria-label="You.com news sources">{result.topic.sources.map(source =>
              <li key={source.url} className="border-b border-line py-3">
                <a className="font-medium hover:text-emerald underline underline-offset-4" href={source.url}
                  target="_blank" rel="noreferrer">{source.title}</a>
                <p className="text-mute text-xs mt-1">{source.publisher}</p>
              </li>)}</ul>}
        </div>
      </>}
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3 mb-2">
      <h2 className="text-2xl font-semibold tracking-tight">
        {searching ? 'Searching archive' : !result ? 'Archive matches' :
          allArchivesFailed ? 'Archive matches unavailable' :
            `${list.length} clip${list.length === 1 ? '' : 's'} found for ${result.topic.name}`}
      </h2>
      <select className="input !w-auto" aria-label="Sort clips" value={sort} onChange={event => setSort(event.target.value)}>
        <option value="date">Newest video</option><option value="len">Shortest clip</option>
      </select>
    </div>
    {searching ? <Loading /> : result ? <>
      {!!result.failedArchives.length && <ErrorBox
        msg={`Couldn’t search ${result.failedArchives.map(item => item.platform + ' ' + item.handle).join(', ')}.`} retry={retry} />}
      {!allArchivesFailed && (list.length
        ? <div className="border-t border-line mt-4">{list.map(clip =>
          <ClipRow key={clip.id} clip={clip} onOpen={onOpen} />)}</div>
        : <Empty text="No saved transcripts contain that exact phrase. Try a shorter search." />)}
    </> : <Empty text={accounts.length
      ? 'Search for a topic or phrase to find matching moments in your archive.'
      : 'Connect an account to search its archive.'} />}
  </>;
}

export default Discover;
