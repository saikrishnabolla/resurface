import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon, ArrowSquareOutIcon, BookmarkSimpleIcon, CircleNotchIcon, LinkIcon,
  MagnifyingGlassIcon, PlayIcon,
} from '@phosphor-icons/react';
import './workspace.css';
import { prepareTranscript, transcriptRows } from './transcript.mjs';

const ARCHIVE = '/api/import_youtube';
const startup = new URLSearchParams(window.location.search);

function time(value) {
  const seconds = Math.floor(value);
  const tail = String(seconds % 60).padStart(2, '0');
  return Math.floor(seconds / 60) + ':' + tail;
}

function date(value) {
  const parsed = value && new Date(value);
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';
}

function safeUrl(raw) {
  try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
}

async function request(path, { body, signal } = {}) {
  const r = await fetch(path, {
    signal,
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new Error(data?.error || 'The request didn’t finish. Try again.');
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

function VideoRow({ video, selected, onClick }) {
  const src = safeUrl(video.thumbnail);
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const badge = video.format === 'short' ? 'Short' :
    typeof video.duration === 'number' && video.duration > 0 ? time(video.duration) : video.duration || 'Video';
  const description = typeof video.description === 'string' ? video.description.trim() : '';
  return <button type="button" className={'video-row' + (selected ? ' selected' : '')}
    aria-pressed={selected} onClick={onClick}>
    <span className="video-preview">{src && failedThumbnail !== src
      ? <img src={src} loading="lazy" alt="" onError={() => setFailedThumbnail(src)} /> : <PlayIcon size={31} />}
      <span className="video-badge">{badge}</span></span>
    <span className="video-copy">
      <strong>{video.title}</strong>
      {description && <span className="video-description">{description}</span>}
      <span className="video-date">{date(video.publishedAt)}</span>
    </span>
  </button>;
}

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

function PageHeading({ section, title, children }) {
  return <header className="page-heading">
    <p className="section-label">{section}</p>
    <h1>{title}</h1>
    {children && <p className="page-intro">{children}</p>}
  </header>;
}

function Discover({ archive, onAccount }) {
  const [name, setName] = useState('');
  const [profile, setProfile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profileUrl = profile ?? archive?.profile?.url ?? '';
  async function search(event) {
    event.preventDefault();
    setBusy(true); setError(''); setResult(null);
    setProfile(profileUrl);
    try {
      setResult(await request('/api/accounts', { body: { name, profileUrl } }).then(r => r.json()));
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="discover-page">
    <PageHeading section="01 / Discover" title="Find a creator’s social accounts">
      Start with their name and one public profile. You.com looks for their other accounts.
    </PageHeading>
    <form className="discover-form" onSubmit={search}>
      <label>Creator name<input value={name} required minLength={2} maxLength={100}
        disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Known profile URL<input value={profileUrl} required maxLength={500}
        autoCapitalize="none" spellCheck={false} placeholder="YouTube, Instagram, or TikTok"
        disabled={busy} onChange={event => setProfile(event.target.value)} /></label>
      <button className="primary" disabled={busy || name.trim().length < 2 || !profileUrl.trim()}>
        {busy ? 'Searching…' : 'Find accounts'}</button>
    </form>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {result && <section className="account-results">
      <h2>Social profiles</h2>
      {(result.message || result.accounts.some(item => item.origin === 'suggested')) &&
        <p className="workspace-message" role="status">{result.message || 'Check suggested profiles before importing.'}</p>}
      <ul>{result.accounts.map(item => <li key={item.url}>
        <div>
          <a className="workspace-link" href={item.url} rel="noreferrer" target="_blank">
            {item.platform} · {item.handle} <ArrowSquareOutIcon aria-hidden="true" /></a>
          <p>{item.evidence}{item.sourceUrl && item.sourceUrl !== item.url &&
            <> · <a href={item.sourceUrl} rel="noreferrer" target="_blank">Source</a></>}</p>
        </div>
        <button className="primary" type="button" aria-label={'Open ' + item.platform + ' archive'} onClick={() => onAccount(item.url)}>
          Open archive</button>
      </li>)}</ul>
    </section>}
  </section>;
}

function ArchiveSearch({ profileUrl, onMatch }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function search(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMatches(null);
    try {
      const data = await request(archivePath(profileUrl, { q: query.trim() })).then(r => r.json());
      setMatches(data.matches);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <section className="archive-search">
    <form className="discover-form" onSubmit={search}>
      <label>Search all transcripts<input value={query} required maxLength={120}
        onChange={event => setQuery(event.target.value)} /></label>
      <button className="primary" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search archive'}</button>
    </form>
    {error && <p className="workspace-message" role="alert">{error}</p>}
    {matches && (matches.length ? <ul aria-label="Archive mentions">{matches.map(match => <li key={match.id + ':' + match.start}>
      <button type="button" className="time-link" onClick={() => onMatch(match)}>{time(match.start)}</button>{' '}
      <strong>{match.title}</strong><p>{match.text}</p>
    </li>)}</ul> : <p className="workspace-message">No transcript lines match.</p>)}
  </section>;
}

export function App() {
  const [tab, setTab] = useState(startup.has('profile') ? 'archive' : 'discover');
  const [profileInput, setProfileInput] = useState(startup.get('profile') ?? '');
  const [archive, setArchive] = useState(null);
  const [selected, setSelected] = useState(startup.get('video') ?? '');
  const [format, setFormat] = useState(startup.get('format') === 'short' ? 'short' : 'video');
  const [jump, setJump] = useState(null);
  const [sort, setSort] = useState('newest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(null);
  const initial = useRef(false);
  const mobileDetail = useRef(null);

  async function open(url, refresh = false) {
    const trimmed = url.trim();
    if (!trimmed) return;
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    const { signal } = controller;
    setBusy(true); setError('');
    if (!refresh) { setArchive(null); setJump(null); }
    let latestProfile = trimmed;
    try {
      const response = await request(ARCHIVE, { body: { profileUrl: trimmed, refresh }, signal });
      if (response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
        await readEvents(response, event => {
          if (signal.aborted) return;
          if (event.kind === 'start' && event.profile) {
            latestProfile = event.profile.url;
            setArchive(current => ({ ...current, profile: event.profile, videos: current?.videos ?? [] }));
          }
          if (event.kind === 'videos') {
            setArchive(current => ({ ...current, videos: event.videos }));
          }
          if (event.kind === 'item') {
            setArchive(current => ({ ...current, videos: current?.videos?.map(v => v.id === event.video.id ? { ...v, ...event.video } : v) }));
          }
        });
      } else {
        const saved = await response.json();
        if (signal.aborted) return;
        setArchive(saved);
        latestProfile = saved.profile.url;
      }
      const saved = await request(archivePath(latestProfile), { signal }).then(r => r.json());
      if (signal.aborted) return;
      setArchive(saved);
      setProfileInput(saved.profile.url.replace(/^https:\/\/(www\.)?/, ''));
      const params = new URLSearchParams({ profile: saved.profile.url });
      window.history.replaceState(null, '', '?' + params);
    } catch (error) { if (!signal.aborted) setError(error.message); }
    finally { if (!signal.aborted) setBusy(false); }
  }

  useEffect(() => {
    if (!initial.current) {
      initial.current = true;
      const url = startup.get('profile');
      if (url) request(archivePath(url)).then(r => r.json()).then(setArchive).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!archive?.importing || busy) return;
    const controller = new AbortController();
    let running = false;
    const id = setInterval(async () => {
      if (running) return;
      running = true;
      try { const next = await request(archivePath(archive.profile.url), { signal: controller.signal }).then(r => r.json());
        if (!controller.signal.aborted) setArchive(next);
      } catch { /* preserve the latest saved snapshot */ } finally { running = false; }
    }, 2500);
    return () => { controller.abort(); clearInterval(id); };
  }, [archive?.importing, archive?.profile?.url, busy]);

  const videos = archive?.videos ?? [];
  const youtube = archive?.profile?.platform === 'YouTube';
  const shorts = youtube ? videos.filter(video => video.format === 'short') : [];
  const regular = youtube ? videos.filter(video => video.format !== 'short') : videos;
  const selectedVideo = videos.find(video => video.id === selected);
  const activeFormat = selectedVideo && youtube ? selectedVideo.format : format;
  const shown = youtube && activeFormat === 'short' ? shorts : regular;
  const active = selectedVideo ?? shown[0];
  const ordered = sort === 'oldest' ? [...shown].reverse() : shown;
  const canRefresh = archive?.profile && !busy && !archive.importing;
  const pick = (id, match = null) => {
    setSelected(id); setJump(match);
    if (archive?.profile) window.history.replaceState(null, '', '?' + new URLSearchParams({ profile: archive.profile.url, video: id }));
    if (window.matchMedia('(max-width: 980px)').matches) setTimeout(() => mobileDetail.current?.scrollIntoView(), 40);
  };
  function chooseFormat(kind) {
    setSelected(''); setFormat(kind); setJump(null);
    if (archive?.profile) window.history.replaceState(null, '', '?' + new URLSearchParams({
      profile: archive.profile.url, format: kind,
    }));
  }

  return <div className="workspace">
    <aside className="workspace-header">
      <button type="button" className="wordmark" onClick={() => setTab('discover')}>
        <svg aria-hidden="true" width="32" height="32" viewBox="0 0 48 48">
          <rect x="3" y="10" width="42" height="22" rx="11" fill="#7BDDB0" />
          <circle cx="15" cy="21" r="5.5" fill="#080A09" />
          <path d="M27 14.5v13l10-6.5z" fill="#080A09" />
          <path d="M8 38h32M14 44h20" stroke="#7BDDB0" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span>resurface</span>
      </button>
      <nav aria-label="Main">{['Discover', 'Archive'].map((label, i) => {
        const name = label.toLowerCase();
        return <button key={name} type="button" aria-current={tab === name ? 'page' : undefined}
          onClick={() => setTab(name)}><span className="section-label" aria-hidden="true">0{i + 1}</span>{label}</button>;
      })}</nav>
      {archive?.profile && <div className="sidebar-creator">
        <p className="section-label">Creator</p>
        <strong>{archive.profile.name || archive.profile.handle}</strong>
        <p className="video-date">{archive.profile.platform}</p>
      </div>}
    </aside>
    <main className="workspace-main">
      <div hidden={tab !== 'discover'}><Discover archive={archive} onAccount={url => {
        setProfileInput(url); setSelected(''); setFormat('video'); setTab('archive'); open(url);
      }} /></div>
      {tab === 'archive' && <>
        <PageHeading section="02 / Archive" title="My Archive">
          Browse your videos and search their timestamped transcripts.
        </PageHeading>
        <form className="profile-bar" onSubmit={event => { event.preventDefault(); setSelected(''); setFormat('video'); open(profileInput); }}>
          <label htmlFor="profile-url"><LinkIcon aria-hidden="true" /> Creator profile URL</label>
          <div className="profile-input"><input id="profile-url" value={profileInput} required maxLength={500}
            autoCapitalize="none" spellCheck={false} placeholder="Paste a public profile link"
            onChange={event => setProfileInput(event.target.value)} />
            <p>YouTube, TikTok, or Instagram</p>
          </div>
          <button className="primary" disabled={busy || !profileInput.trim()}>{busy ? 'Opening…' : 'Open archive'}</button>
        </form>
        {error && <p className="workspace-message" role="alert">{error}</p>}
        {archive?.profile && <>
          <div className="creator-strip">
            <h2>{archive.profile.name || archive.profile.handle}</h2>
            <span className="archive-mark">
              {busy || archive.importing ? <><CircleNotchIcon className="spin" aria-hidden="true" /> Importing…</>
                : archive.savedAt ? <><BookmarkSimpleIcon aria-hidden="true" /> Saved archive</> : archive.profile.platform}
            </span>
            <button type="button" className="refresh" disabled={!canRefresh} onClick={() => open(archive.profile.url, true)}>
              <ArrowClockwiseIcon aria-hidden="true" /> Check for new videos
            </button>
          </div>
          {!busy && !archive.importing && archive.message && <p className="workspace-message" role="status">{archive.message}</p>}
          {videos.length > 0 && <ArchiveSearch key={archive.profile.url} profileUrl={archive.profile.url}
            onMatch={match => pick(match.id, { start: match.start, serial: Date.now() })} />}
          {videos.length > 0
            ? <div className="library">
              <section className="video-library" aria-label="Video library">
                <div className="library-heading">
                  <h2>{youtube ? 'Videos and Shorts' : archive.profile.platform === 'Instagram'
                    ? 'Instagram Reels' : 'TikTok videos'}</h2>
                  <select aria-label="Sort videos" value={sort} onChange={event => setSort(event.target.value)}>
                    <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
                  </select>
                </div>
                {youtube ? <div className="library-formats" aria-label="YouTube format">
                  <button type="button" aria-pressed={activeFormat !== 'short'}
                    onClick={() => chooseFormat('video')}>YouTube videos <small>{regular.length} / 100</small></button>
                  <button type="button" aria-pressed={activeFormat === 'short'}
                    onClick={() => chooseFormat('short')}>YouTube Shorts <small>{shorts.length} / 100</small></button>
                </div> : <p className="video-date feed-count">{videos.length} / 100</p>}
                <div className="video-list">{ordered.map(video => <VideoRow key={video.id} video={video}
                  selected={active?.id === video.id} onClick={() => pick(video.id)} />)}</div>
                {!ordered.length && <p className="workspace-message">No public uploads in this list.</p>}
              </section>
              <div className="video-column" ref={mobileDetail}>{active &&
                <VideoDetail key={archive.profile.url + ':' + active.id + ':' + (jump?.serial ?? '')}
                  profile={archive.profile} video={active} jump={jump} importing={busy || archive.importing} />}</div>
            </div>
            : <p className="workspace-message" role="status">{busy || archive.importing
              ? 'Looking for the latest public videos…' : 'No public videos were saved.'}</p>}
        </>}
        {!archive && !error && <p className="workspace-message" role="status">
          {busy ? 'Looking for the latest public videos…' : 'Open a public profile to browse its videos and timed transcripts.'}
        </p>}
      </>}
    </main>
  </div>;
}
