import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon, ArrowSquareOutIcon, BookmarkSimpleIcon, CircleNotchIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import './workspace.css';
import { prepareTranscript, transcriptRows } from './transcript.mjs';
import { CreatorOnboarding } from './Onboarding.jsx';
import { normalizeAccount, normalizeWorkspace, readWorkspace, workspaceKey } from './creator-workspace.mjs';
import { Discover } from './zip/Discover.jsx';
import { DemoReels } from './zip/DemoReels.jsx';
import { Header, Thumb, Empty, fdate, fmt } from './zip/ui.jsx';
import './zip/zip.css';

const ARCHIVE = '/api/import_youtube';
const startup = new URLSearchParams(window.location.search);

function time(value) {
  const seconds = Math.floor(value);
  const tail = String(seconds % 60).padStart(2, '0');
  return Math.floor(seconds / 60) + ':' + tail;
}

function safeUrl(raw) {
  if (typeof raw === 'string' && raw.startsWith('/api/import_youtube?')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

async function request(path, { body, signal } = {}) {
  const r = await fetch(path, {
    signal,
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : 'The request didn’t finish. Try again.'), { status: r.status });
  }
  return r;
}

async function readEvents(response, onEvent) {
  if (!response.body) throw new Error('The import stream did not open.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '', done = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += chunk.value;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        onEvent(event);
        if (event.kind === 'done') done = true;
      }
    }
    if (!done) throw new Error('The connection ended early. Videos already saved are still available.');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const archivePath = (url, params = {}) => ARCHIVE + '?' + new URLSearchParams({ profile: url, ...params });

function Player({ profile, video, target, frame }) {
  const id = encodeURIComponent(video.id);
  let src = '';
  if (profile.platform === 'YouTube') {
    const params = new URLSearchParams({ rel: '0' });
    if (target) {
      params.set('autoplay', '1');
      params.set('start', String(Math.floor(target.start)));
    }
    src = 'https://www.youtube.com/embed/' + id + '?' + params;
  } else if (profile.platform === 'TikTok') {
    src = 'https://www.tiktok.com/player/v1/' + id;
  } else if (profile.platform === 'Instagram') {
    src = 'https://www.instagram.com/reel/' + id + '/embed/';
  }
  if (!src) return null;
  return <div className={'player-shell' + (profile.platform !== 'YouTube' ? ' vertical-player' : '')}>
    <iframe key={profile.platform === 'YouTube' ? target?.serial : video.id} ref={frame} title={video.title}
      src={src} allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  </div>;
}

function VideoDetail({ profile, video, jump, importing }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState(jump || null);
  const [retry, setRetry] = useState(0);
  const frame = useRef(null);
  const captions = useRef(null);

  function seek(start) {
    setTarget(current => ({ start, serial: (current?.serial ?? 0) + 1 }));
    if (profile.platform === 'TikTok') {
      const player = frame.current?.contentWindow;
      player?.postMessage({ type: 'seekTo', value: start, 'x-tiktok-player': true }, 'https://www.tiktok.com');
    }
  }
  useEffect(() => {
    if (!jump || profile.platform !== 'TikTok') return;
    function ready(event) {
      if (event.origin === 'https://www.tiktok.com' && event.source === frame.current?.contentWindow &&
          event.data?.['x-tiktok-player'] === true && event.data?.type === 'onPlayerReady') seek(jump.start);
    }
    window.addEventListener('message', ready);
    return () => window.removeEventListener('message', ready);
  }, [jump, profile.platform]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const read = () => request(archivePath(profile.url, { video: video.id }), { signal: controller.signal }).then(r => r.json());
      let data = await read();
      if (((profile.platform === 'Instagram' || !importing) && data.status === 'pending')
          || (retry && data.status === 'provider_error')) {
        const reply = await request(ARCHIVE, { signal: controller.signal,
          body: { profileUrl: profile.url, video: video.id } });
        data = await reply.json();
        if (reply.status === 202) {
          for (let i = 0; i < 20 && data.status === 'pending' && !controller.signal.aborted; i++) {
            await new Promise(resolve => setTimeout(resolve, 2200));
            if (!controller.signal.aborted) data = await read();
          }
        }
      }
      if (!controller.signal.aborted) { setRecord(data); setError(''); }
    }
    load()
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [profile.url, profile.platform, video.id, video.status, importing, retry]);

  useEffect(() => {
    const parent = captions.current;
    const selectedRow = parent?.querySelector('[aria-current="true"]');
    if (selectedRow && parent) parent.scrollTop = selectedRow.offsetTop - (parent.clientHeight - selectedRow.offsetHeight) / 2;
  }, [target, record]);

  const source = safeUrl(video.url);
  const transcript = useMemo(() => prepareTranscript(record?.segments ?? []), [record]);
  const shown = useMemo(() => transcriptRows(transcript, filter), [transcript, filter]);
  const hasTranscript = transcript.paragraphs.length > 0;
  return <section className="video-detail" aria-label="Selected video">
    <div className="video-detail-heading">
      <h2>{video.title}</h2>
      {source && <a className="workspace-link" href={source} target="_blank" rel="noreferrer">
        Open on {profile.platform} <ArrowSquareOutIcon aria-hidden="true" />
      </a>}
    </div>
    <Player profile={profile} video={video} target={target} frame={frame} />
    <div className="transcript-heading">
      <h3>Transcript</h3>
      <label className="library-search"><MagnifyingGlassIcon aria-hidden="true" />
        <input aria-label="Find in transcript" placeholder="Find in transcript" value={filter}
          disabled={!hasTranscript} onChange={event => {
            setFilter(event.target.value);
            if (captions.current) captions.current.scrollTop = 0;
          }} maxLength={100} />
      </label>
    </div>
    {profile.platform === 'Instagram' && hasTranscript && <p className="video-date">AI transcript · Times are approximate</p>}
    {error ? <p className="workspace-message" role="alert">{error}{' '}
      <button className="time-link" type="button" onClick={() => { setError(''); setRetry(value => value + 1); }}>Retry</button></p>
      : !record || record.status === 'pending' ? <p className="workspace-message">{profile.platform === 'Instagram'
        ? 'Getting this video’s transcript…' : 'Waiting for captions…'}</p>
      : !hasTranscript ? <p className="workspace-message">{record.status === 'provider_error'
        ? <>Couldn’t fetch a timed transcript.{' '}<button className="time-link" type="button"
          onClick={() => { setRecord(null); setRetry(value => value + 1); }}>Retry</button></> : 'No timed transcript available.'}</p>
      : !shown.length ? <p className="workspace-message">No matching transcript text.</p>
      : <ol ref={captions} className="transcript-lines" aria-label="Transcript paragraphs">
        {shown.map(({ start, text, before, match, after, key, times }) => <li key={key}
          aria-current={target && times.includes(target.start) ? 'true' : undefined}>
          {profile.platform === 'Instagram' ? <span className="time-label">{time(start)}</span>
            : <button type="button" className="time-link" onClick={() => seek(start)}
              aria-label={'Jump to ' + time(start)}>{time(start)}</button>}
          <p>{match ? <>{before}<mark>{match}</mark>{after}</> : text}</p>
        </li>)}
      </ol>}
  </section>;
}

const lookupAccounts = body => request('/api/accounts', { body }).then(response => response.json());
const findStories = (query, extra = {}) => request('/api/discover', { body: { query, ...extra } }).then(response => response.json());
const loadTopics = url => request(archivePath(url, { topics: '1' })).then(response => response.json());
const findMatches = (url, q) => request(archivePath(url, { q })).then(response => response.json());

function useCreatorArchives(accounts) {
  const [entries, setEntries] = useState({});
  const lifetime = useRef(null);
  const jobs = useRef(new Map());
  const permitted = useRef(new Set());
  const accountKey = JSON.stringify(accounts.map(({ url }) => url));

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function update(url, patch, signal) {
    if (signal.aborted || !permitted.current.has(url)) return;
    setEntries(current => ({ ...current, [url]: { ...current[url], ...patch } }));
  }

  async function run(url, signal, refresh) {
    const read = () => request(archivePath(url), { signal }).then(response => response.json());
    const publish = snapshot => update(url, { snapshot, phase: snapshot.importing ? 'importing'
      : snapshot.savedAt ? 'ready' : 'error', error: !snapshot.importing && !snapshot.savedAt
      ? snapshot.message || 'Couldn’t import this account.' : '' }, signal);
    try {
      update(url, { phase: refresh ? 'importing' : 'checking', error: '' }, signal);
      let snapshot = refresh ? null : await read().catch(error => {
        if (error.status !== 404) throw error;
        return null;
      });
      if (snapshot?.savedAt || snapshot?.importing) {
        publish(snapshot);
      } else {
        if (signal.aborted || !permitted.current.has(url)) return;
        update(url, { phase: 'importing' }, signal);
        const response = await request(ARCHIVE, { body: { profileUrl: url, refresh }, signal });
        if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
          await readEvents(response, event => {
            if (signal.aborted || !permitted.current.has(url)) return;
            if (event.kind === 'start' || event.kind === 'videos' || event.kind === 'item') {
              setEntries(current => {
                const prev = current[url] ?? {};
                const saved = prev.snapshot ?? { videos: [] };
                const next = event.kind === 'start' ? { ...saved, profile: event.profile, importing: true }
                  : event.kind === 'videos' ? { ...saved, videos: event.videos }
                  : { ...saved, videos: saved.videos.map(video => video.id === event.video.id ? { ...video, ...event.video } : video) };
                return { ...current, [url]: { ...prev, snapshot: next } };
              });
            }
          });
          snapshot = await read();
        } else snapshot = await response.json();
        publish(snapshot);
      }
      while (snapshot?.importing && !signal.aborted && permitted.current.has(url)) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        if (signal.aborted || !permitted.current.has(url)) break;
        snapshot = await read();
        publish(snapshot);
      }
    } catch (error) {
      update(url, { phase: 'error', error: error.message }, signal);
    }
  }

  function start(url, refresh = false) {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || !permitted.current.has(url)) return;
    const current = jobs.current.get(url);
    if (current?.signal === signal) return current.promise;
    const promise = run(url, signal, refresh).finally(() => {
      if (jobs.current.get(url)?.promise === promise) jobs.current.delete(url);
    });
    jobs.current.set(url, { signal, promise });
    return promise;
  }

  useEffect(() => {
    const urls = JSON.parse(accountKey);
    permitted.current = new Set(urls);
    let cancelled = false;
    const signal = lifetime.current.signal;
    // Show saved libraries right away even if another account needs a live import.
    async function load() {
      const needsImport = await Promise.all(urls.map(async url => {
        const superseded = () => cancelled || signal.aborted || jobs.current.get(url)?.signal === signal;
        if (superseded()) return false;
        try {
          const snapshot = await request(archivePath(url), { signal }).then(response => response.json());
          if (superseded()) return false;
          update(url, { snapshot, error: '', phase: snapshot.importing ? 'importing'
            : snapshot.savedAt ? 'ready' : 'queued' }, signal);
          return !snapshot.savedAt || snapshot.importing;
        } catch (error) {
          if (superseded()) return false;
          update(url, error.status === 404 ? { phase: 'queued', error: '' } : { phase: 'error', error: error.message }, signal);
          return error.status === 404;
        }
      }));
      for (const [i, url] of urls.entries()) {
        if (cancelled || signal.aborted) break;
        if (needsImport[i]) await start(url);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [accountKey]);

  return { entries, start };
}

function ArchiveSearch({ profileUrl, query, setQuery, matches, setMatches, onMatch, years, year, setYear, topics, topic, setTopic }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const searchRun = useRef(null);
  useEffect(() => {
    setBusy(false); setError('');
    return () => searchRun.current?.abort();
  }, [profileUrl, query]);
  async function search(event) {
    event.preventDefault();
    searchRun.current?.abort();
    const controller = new AbortController();
    searchRun.current = controller;
    const { signal } = controller;
    setBusy(true); setError(''); setMatches(null);
    try {
      const data = await request(archivePath(profileUrl, { q: query.trim() }), { signal }).then(r => r.json());
      if (!signal.aborted) setMatches(data.matches);
    } catch (error) { if (!signal.aborted) setError(error.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  return <section className="mb-5">
    <form className="flex flex-wrap gap-2" onSubmit={search}>
      <input className="input flex-1 min-w-[170px]" aria-label="Search this account’s transcripts" placeholder="Search title or transcript"
        value={query} required maxLength={120} onChange={event => {
          searchRun.current?.abort(); setQuery(event.target.value); setMatches(null);
        }} />
      <select className="input !w-auto" aria-label="Year" value={year} onChange={event => setYear(event.target.value)}>
        <option value="">All years</option>{years.map(value => <option key={value}>{value}</option>)}
      </select>
      <select className="input !w-auto" aria-label="Topic" value={topic} onChange={event => setTopic(event.target.value)}>
        <option value="">All topics</option>{topics.map(value => <option key={value}>{value}</option>)}
      </select>
      <button className="btn" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search archive'}</button>
    </form>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {matches && (matches.length ? <ul className="p-0 list-none" aria-label="Archive mentions">{matches.map(match => <li className="border-t py-2" key={match.id + ':' + match.start}>
      <button type="button" className="time-link" onClick={() => onMatch(match)}>{time(match.start)}</button>{' '}
      <strong>{match.title}</strong><p>{match.text}</p>
    </li>)}</ul> : <p className="workspace-message">No transcript lines match.</p>)}
  </section>;
}

function CreatorArchive({ workspace, onEdit, entries, start, sourceJump, clips }) {
  const initialProfile = normalizeAccount(startup.get('profile'))?.url;
  const isInitial = workspace.accounts.some(account => account.url === initialProfile);
  const [activeUrl, setActiveUrl] = useState(isInitial ? initialProfile : workspace.accounts[0].url);
  const [selected, setSelected] = useState(isInitial ? startup.get('video') ?? '' : '');
  const [format, setFormat] = useState(isInitial && startup.get('format') === 'short' ? 'short' : 'video');
  const [jump, setJump] = useState(null);
  const [year, setYear] = useState('');
  const [topic, setTopic] = useState('');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const detail = useRef(null);
  const account = workspace.accounts.find(item => item.url === activeUrl) ?? workspace.accounts[0];
  const entry = entries[account.url];
  const archive = entry?.snapshot;
  const busy = !entry || ['queued', 'checking', 'importing'].includes(entry.phase);
  const error = entry?.error;
  useEffect(() => {
    if (account.url === activeUrl) return;
    selectAccount(account.url);
  }, [account.url, activeUrl]);
  useEffect(() => {
    if (!sourceJump || !workspace.accounts.some(item => item.url === sourceJump.profile.url)) return;
    setActiveUrl(sourceJump.profile.url); resetFilters();
    setSelected(sourceJump.video.id); setJump({ start: sourceJump.start, serial: sourceJump.serial });
    window.history.replaceState(null, '', '?' + new URLSearchParams({ profile: sourceJump.profile.url, video: sourceJump.video.id }));
  }, [sourceJump]);
  useEffect(() => {
    if (jump && detail.current) detail.current.scrollIntoView({ block: 'nearest' });
  }, [jump, archive?.savedAt]);

  const videos = archive?.videos ?? [];
  const youtube = account.platform === 'YouTube';
  const shorts = youtube ? videos.filter(video => video.format === 'short') : [];
  const regular = youtube ? videos.filter(video => video.format !== 'short') : videos;
  const selectedVideo = videos.find(video => video.id === selected);
  const activeFormat = selectedVideo && youtube ? selectedVideo.format : format;
  const shown = youtube && activeFormat === 'short' ? shorts : regular;
  const accountClips = clips.filter(clip => clip.profile.url === account.url);
  const topics = [...new Set(accountClips.map(clip => clip.topic.name))];
  const years = [...new Set(videos.map(video => video.publishedAt?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const listed = shown.filter(video => video.id === selected || (
    (!year || video.publishedAt?.startsWith(year)) &&
    (!topic || accountClips.some(clip => clip.topic.name === topic && clip.video.id === video.id)) &&
    (!query.trim() || video.title.toLowerCase().includes(query.trim().toLowerCase()) || matches?.some(match => match.id === video.id))
  ));
  function resetFilters() {
    setQuery(''); setMatches(null); setYear(''); setTopic('');
  }
  function selectAccount(url) {
    setActiveUrl(url); setSelected(''); setFormat('video'); setJump(null); resetFilters();
    window.history.replaceState(null, '', '?' + new URLSearchParams({ profile: url }));
  }
  const pick = (id, match = null) => {
    setSelected(id); setJump(match);
    if (archive?.profile) window.history.replaceState(null, '', '?' + new URLSearchParams({ profile: archive.profile.url, video: id }));
  };
  function chooseFormat(kind) {
    setSelected(''); setFormat(kind); setJump(null);
    if (archive?.profile) window.history.replaceState(null, '', '?' + new URLSearchParams({
      profile: archive.profile.url, format: kind,
    }));
  }

  return <>
        <Header kicker="02 / Archive" title="My Archive" sub="Your connected video library, searchable by title and transcript." />
        <section className="bg-surface border border-line p-5 mb-6" aria-label="Your social accounts">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2"><h2 className="label">Connected accounts</h2>
            <button type="button" className="btn" onClick={onEdit}>Edit accounts</button>
          </div>
          <div className="flex flex-wrap gap-2">{workspace.accounts.map(item => {
            const state = entries[item.url];
            const count = state?.snapshot?.videos?.length ?? 0;
            const status = !state || state.phase === 'checking' ? 'Checking archive…'
              : state.phase === 'queued' ? 'Waiting to import' : state.phase === 'importing'
              ? (count ? count + ' videos found · Importing…' : 'Importing…')
              : state.phase === 'error' ? 'Couldn’t import' : count + (count === 1 ? ' video' : ' videos');
            return <button key={item.url} type="button" className={`btn ${item.url === account.url ? 'btn-gold' : ''}`} aria-pressed={item.url === account.url}
              onClick={() => { if (item.url !== account.url) selectAccount(item.url); }}>
              <strong>{item.platform}</strong><span className="text-mute">{item.handle}</span><small role="status" className="text-mute">{status}</small>
            </button>;
          })}</div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <p className="text-sm flex items-center gap-2"><b>{workspace.name}</b> · {account.platform} · {videos.length} indexed
              {archive?.savedAt && <BookmarkSimpleIcon aria-label="Saved archive" />}</p>
            <button type="button" className="btn ml-auto" disabled={busy} onClick={() => start(account.url, true)}>
              <ArrowClockwiseIcon aria-hidden="true" /> {error ? 'Retry import' : 'Check for new videos'}</button>
          </div>
          {error && <p className="workspace-message" role="alert">{error}</p>}
          {!busy && !error && archive?.message && <p className="workspace-message" role="status">{archive.message}</p>}
        </section>
        {archive?.profile && <>
          {videos.length > 0 && <ArchiveSearch key={archive.profile.url} profileUrl={archive.profile.url}
            {...{query, setQuery, matches, setMatches, years, year, setYear, topics, topic, setTopic}}
            onMatch={match => pick(match.id, { start: match.start, serial: Date.now() })} />}
          {videos.length > 0
            ? <section aria-label="Video archive">
                {youtube ? <div className="flex flex-wrap gap-2 mb-5" aria-label="YouTube format">
                  <button className={`btn ${activeFormat !== 'short' ? 'btn-gold' : ''}`} type="button" aria-pressed={activeFormat !== 'short'}
                    onClick={() => chooseFormat('video')}>YouTube videos <small>{regular.length} / 100</small></button>
                  <button className={`btn ${activeFormat === 'short' ? 'btn-gold' : ''}`} type="button" aria-pressed={activeFormat === 'short'}
                    onClick={() => chooseFormat('short')}>YouTube Shorts <small>{shorts.length} / 100</small></button>
                </div> : <h2 className="label mb-3">{account.platform === 'Instagram' ? 'Instagram Reels' : 'TikTok videos'} · {videos.length} / 100</h2>}
                {listed.length ? <div className="space-y-3">{listed.map(video => {
                  const open = video.id === selected;
                  const found = accountClips.filter(clip => clip.video.id === video.id);
                  return <div key={video.id} className="bg-surface border border-line p-4">
                    <div className="flex flex-wrap sm:flex-nowrap gap-4 items-center">
                      <Thumb title={video.title} thumbnail={safeUrl(video.thumbnail)} className="w-24 sm:w-32 aspect-video shrink-0" />
                      <div className="flex-1 min-w-[120px]"><div className="font-medium">{video.title}</div>
                        {video.description && <p className="text-xs text-mute truncate max-w-[50ch]">{video.description}</p>}
                        <div className="text-xs text-mute">{[fdate(video.publishedAt), Number.isFinite(video.duration) ? fmt(video.duration) : '', `${found.length} matching clips`].filter(Boolean).join(' · ')}</div></div>
                      <button type="button" className="btn" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Details for'} ${video.title}`} onClick={() => pick(open ? '' : video.id)}>{open ? 'Hide' : 'Details'}</button>
                    </div>
                    {open && <div className="mt-4 border-t border-line pt-3 text-sm space-y-1" ref={detail}>
                      <VideoDetail key={archive.profile.url + ':' + video.id + ':' + (jump?.serial ?? '')}
                        profile={archive.profile} video={video} jump={jump} importing={busy || archive.importing} />
                      <div className="pt-2 flex gap-2 flex-wrap">{found.length ? found.map(clip => <button key={clip.id}
                        type="button" className="btn" onClick={() => pick(video.id, { start: clip.start, serial: performance.now() })}>Jump to {fmt(clip.start)}</button>)
                        : <span className="text-mute">No matches for this video yet.</span>}</div>
                    </div>}
                  </div>;
                })}</div> : <Empty text="No videos match." />}
              </section>
            : <p className="workspace-message" role="status">{busy || archive.importing
              ? 'Looking for the latest public videos…' : 'No public videos were saved.'}</p>}
        </>}
        {!archive && !error && <p className="workspace-message flex items-center gap-2" role="status">
          <CircleNotchIcon className="spin" aria-hidden="true" /> Videos appear here as they’re saved.</p>}
  </>;
}

const sections = [['discover', 'Discover'], ['archive', 'Archive'], ['demo', 'Demo reels']];

function Dashboard({ workspace, onEdit, view, setView }) {
  const { entries, start } = useCreatorArchives(workspace.accounts);
  const [results, setResults] = useState([]);
  const [sourceJump, setSourceJump] = useState(null);
  const allowed = new Set(workspace.accounts.map(account => account.url));
  const clips = results.filter(clip => allowed.has(clip.profile.url));

  function openInArchive(clip) {
    if (!allowed.has(clip.profile.url)) return;
    setSourceJump({ ...clip, serial: performance.now() });
    setView('archive');
  }
  return <>
    <div hidden={view !== 'discover'}><Discover accounts={workspace.accounts} entries={entries}
      findStories={findStories} findMatches={findMatches} loadTopics={loadTopics} onOpen={openInArchive} onResults={setResults} /></div>
    {view === 'demo' && <DemoReels />}
    <div hidden={view !== 'archive'}><CreatorArchive {...{workspace, onEdit, entries, start, sourceJump, clips}} /></div>
  </>;
}

export function App() {
  const [workspace, setWorkspace] = useState(() => {
    try { return readWorkspace(window.localStorage); } catch { return null; }
  });
  const demoLink = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo');
  useEffect(() => {
    // A shared ?demo link opens straight into the demo reels, with no setup.
    if (demoLink && !workspace) setWorkspace(normalizeWorkspace({ name: 'Jahbari Taylor', anchor: 'https://www.youtube.com/@jahbaritaylor', accounts: [{ url: 'https://www.youtube.com/@jahbaritaylor' }] }));
  }, []);
  const [editing, setEditing] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [view, setView] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo') ? 'demo' : 'archive');
  const dashboard = useRef(null);
  function show(page) {
    setView(page);
    window.scrollTo(0, 0);
  }
  function confirm(input) {
    const next = normalizeWorkspace(input);
    if (!next) return;
    try {
      window.localStorage.setItem(workspaceKey, JSON.stringify(next));
      setStorageFailed(false);
    } catch { setStorageFailed(true); }
    setWorkspace(next); setEditing(false);
    requestAnimationFrame(() => dashboard.current?.focus());
  }
  return <div className="min-h-screen md:flex">
    <aside className="zip-sidebar md:w-60 md:fixed md:inset-y-0 border-b md:border-b-0 md:border-r border-line p-6 flex md:flex-col gap-8 overflow-x-auto">
      <button type="button" className="inline-flex items-center self-start shrink-0 gap-2.5 p-0" onClick={() => { if (workspace && !editing) show('discover'); }}>
        <img src="/logo.png" alt="resurface" width="150" height="38" className="h-auto w-[150px]" />
      </button>
      {workspace && !editing && <nav aria-label="Main" className="flex md:flex-col gap-1">{sections.map(([key, label], i) =>
        <button key={key} type="button" aria-current={view === key ? 'page' : undefined} onClick={() => show(key)}
          className={`flex items-baseline gap-3 py-2 pl-3 border-l-2 whitespace-nowrap ${view === key ? 'border-emerald text-emerald' : 'border-transparent text-mute hover:text-ink'}`}>
          <span className="label !text-[10px]" aria-hidden="true">0{i + 1}</span><span className="text-base font-medium">{label}</span>
        </button>)}</nav>}
      {workspace && <div className="md:mt-auto !hidden md:!block border-t border-line pt-4">
        <div className="label mb-1">Creator</div><div className="font-medium break-words">{workspace.name}</div>
        <div className="label !text-emerald mt-4">Connected accounts</div>
      </div>}
    </aside>
    <main className="flex-1 min-w-0 md:ml-60 px-6 md:px-14 py-10 max-w-[1200px]">
      {(!workspace || editing) && <CreatorOnboarding initial={workspace ?? { anchor: startup.get('profile') ?? '' }}
        lookup={lookupAccounts} normalizeAccount={normalizeAccount} onConfirm={confirm}
        onCancel={workspace ? () => { setEditing(false); requestAnimationFrame(() => dashboard.current?.focus()); } : undefined} />}
      {workspace && <div className="zip-page" hidden={editing} ref={dashboard} tabIndex={-1}>
        {storageFailed && <p className="workspace-message" role="status">Your browser couldn’t save your changes. They’ll be lost when you close this page.</p>}
        <Dashboard workspace={workspace} onEdit={() => setEditing(true)} view={view} setView={show} />
      </div>}
    </main>
  </div>;
}
