import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./import_archive.py', import.meta.url));
const MAX_UPLOADS = 100;
const ACTIVE = new Set(['loading', 'running']);
const BLOCKED = new Set(['IpBlocked', 'RequestBlocked', 'skipped_after_block']);
const UNCHECKED = new Set(['skipped_after_block', 'not_checked']);
const videoId = /^[A-Za-z0-9_-]{11}$/;
const cachedIds = new Map([
  ['@kameronmonet', 'UCSp52HvdllyUqLXsdwwOkTA'],
  ['@jahbaritaylor', 'UCgwp7OUqIJQpUE96kbSei3w'],
]);

function problem(status, message) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

export function normalizeChannel(value) {
  if (typeof value !== 'string' || value.length > 240) throw problem(400, 'Enter a public YouTube channel link.');
  let url;
  try { url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`); } catch {
    throw problem(400, 'Enter a public YouTube channel link.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.username || url.password || url.port) {
    throw problem(400, 'Enter a public YouTube channel link.');
  }
  const path = url.pathname.replace(/\/$/, '').replace(/\/(videos|shorts|featured|about)$/, '');
  if (!/^\/(?:@[A-Za-z0-9._-]{3,35}|channel\/UC[A-Za-z0-9_-]{22}|(?:c|user)\/[A-Za-z0-9._-]{1,60})$/.test(path)) {
    throw problem(400, 'Use a YouTube channel link, not a link to a single video.');
  }
  return `https://www.youtube.com${path}`;
}

const publicJob = ({ id, state, total, checked, ready, skipped, message }) => ({ id, state, total, checked, ready, skipped, ...(message && { message }) });

function normalize(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function cacheMatches(manifest, channelUrl) {
  if (manifest.channel_url === channelUrl) return true;
  const path = new URL(channelUrl).pathname;
  const id = path.startsWith('/channel/') ? path.slice('/channel/'.length) : cachedIds.get(path.slice(1).toLowerCase());
  return Boolean(id && manifest.channel_id === id);
}

function recount(job) {
  const rows = [...job.rows.values()];
  job.checked = rows.filter(row => !UNCHECKED.has(row.status)).length;
  job.ready = rows.filter(row => row.status === 'ok').length;
  job.skipped = rows.length - job.ready;
}

function finish(job, { cached = false, blocked = false, timedOut = false, failed = false } = {}) {
  recount(job);
  blocked ||= [...job.rows.values()].some(row => BLOCKED.has(row.status));
  timedOut ||= [...job.rows.values()].some(row => row.status === 'not_checked');
  if (blocked) {
    job.state = job.ready ? 'partial' : 'blocked';
    job.message = 'YouTube stopped allowing caption requests. You can search any captions already saved.';
    if (!job.ready) job.message = 'YouTube stopped allowing caption requests. No transcripts were saved.';
  } else if (timedOut || failed) {
    job.state = job.ready ? 'partial' : 'error';
    job.message = timedOut ? 'The import timed out. Any captions already saved are searchable.' : 'The import stopped before it could finish.';
  } else if (job.ready < job.total) {
    job.state = 'partial';
    job.message = cached ? 'Opened a saved archive. Some uploads had no available English captions.' : 'Some uploads had no available English captions.';
  } else {
    job.state = 'complete';
    job.message = cached ? 'Opened a saved archive.' : job.ready ? 'Archive ready.' : 'This channel has no public uploads to import.';
  }
}

export function createArchiveService({ cacheDir }) {
  const root = resolve(cacheDir);
  const jobs = new Map();

  function requireJob(id) {
    const job = jobs.get(id);
    if (!job) throw problem(404, 'This import was not found. Start a new import.');
    return job;
  }

  async function findCache(channelUrl) {
    const entries = await readdir(root, { withFileTypes: true });
    const candidates = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^(?:jahbari-transcripts|kameron-transcripts|archive)-/.test(entry.name)) continue;
      const dir = resolve(root, entry.name);
      try {
        const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'));
        if (Array.isArray(manifest.videos) && cacheMatches(manifest, channelUrl)) candidates.push({ dir, manifest });
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError)) throw error;
      }
    }
    return candidates.sort((a, b) => String(b.manifest.generated_at).localeCompare(String(a.manifest.generated_at)))[0];
  }

  function run(job, channelUrl) {
    const child = spawn('uv', ['run', '--no-project', '--with', 'yt-dlp', '--with', 'youtube-transcript-api',
      'python', SCRIPT, channelUrl, job.dir, String(MAX_UPLOADS)], { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
    let terminal;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === 'win32') child.kill();
        else if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch { /* the process already exited */ }
    }, 160_000);
    timer.unref();
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.kind === 'listed') {
        job.total = event.total;
        job.state = 'running';
      } else if (event.kind === 'item' && videoId.test(event.video?.id ?? '')) {
        job.rows.set(event.video.id, event.video);
        recount(job);
      } else if (event.kind === 'done') terminal = event;
    });
    child.on('error', error => {
      clearTimeout(timer);
      finish(job, { failed: true });
      if (error.code === 'ENOENT') job.message = 'Caption imports need uv installed on the server.';
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (!ACTIVE.has(job.state)) return;
      finish(job, { ...(terminal ?? {}), timedOut: timedOut || terminal?.timedOut, failed: code !== 0 || !terminal });
      if (terminal?.message && job.ready === 0) job.message = terminal.message;
    });
  }

  return {
    async start({ creator, channelUrl } = {}) {
      if (typeof creator !== 'string' || !creator.trim() || creator.length > 120) throw problem(400, 'Enter a creator name.');
      const url = normalizeChannel(channelUrl);
      // Reopening the current import must not restart its network requests.
      const current = [...jobs.values()].find(job => job.channelUrl === url && ACTIVE.has(job.state));
      if (current) return publicJob(current);
      if ([...jobs.values()].some(job => ACTIVE.has(job.state))) throw problem(409, 'Another archive is still importing. Try again after it finishes.');
      const id = randomUUID();
      const job = { id, channelUrl: url, dir: resolve(root, `archive-${id}`), rows: new Map(), transcripts: new Map(), total: 0, checked: 0, ready: 0, skipped: 0, state: 'loading' };
      jobs.set(id, job);
      if (jobs.size > 24) jobs.delete(jobs.keys().next().value);
      try {
        await mkdir(root, { recursive: true });
        const cached = await findCache(url);
        if (cached) {
          job.dir = cached.dir;
          for (const row of cached.manifest.videos.slice(0, MAX_UPLOADS)) {
            if (videoId.test(row?.id ?? '')) job.rows.set(row.id, row);
          }
          job.total = job.rows.size;
          finish(job, { cached: true });
        } else {
          await mkdir(job.dir);
          run(job, url);
        }
      } catch {
        finish(job, { failed: true });
      }
      return publicJob(job);
    },

    status(id) { return publicJob(requireJob(id)); },

    async search(id, query) {
      const job = requireJob(id);
      if (typeof query !== 'string' || query.length > 160) throw problem(400, 'Enter a search of 160 characters or fewer.');
      const words = normalize(query).split(' ').filter(Boolean).slice(0, 12);
      if (!words.length) return [];
      const exact = words.join(' ');
      const phrase = haystack => {
        if (` ${haystack} `.includes(` ${exact} `)) return true;
        // Auto-captions sometimes split a single name (DoorDash → Door Dash).
        if (words.length !== 1 || exact.length < 6) return false;
        const tokens = haystack.split(' ');
        return tokens.some((token, index) => index + 1 < tokens.length && token + tokens[index + 1] === exact);
      };
      const results = [];
      for (const row of job.rows.values()) {
        if (row.status !== 'ok' || row.transcript !== `${row.id}.json`) continue;
        let captions = job.transcripts.get(row.id);
        if (!captions) {
          try {
            const data = JSON.parse(await readFile(resolve(job.dir, row.transcript), 'utf8'));
            captions = data.segments.filter(x => typeof x.text === 'string' && Number.isFinite(x.start) && x.start >= 0);
            job.transcripts.set(row.id, captions);
          } catch { continue; }
        }
        let previous = -Infinity;
        for (const [index, segment] of captions.entries()) {
          if (segment.start - previous < 12) continue;
          const first = normalize(segment.text);
          const following = captions[index + 1];
          const near = following && following.start - segment.start <= 12;
          const second = near ? normalize(following.text) : '';
          const rank = phrase(first) ? 3 : phrase(`${first} ${second}`) && !phrase(second) ? 2 :
            words.length > 1 && words.every(word => ` ${first} `.includes(` ${word} `)) ? 1 : 0;
          if (!rank) continue;
          const text = rank === 2 ? `${segment.text} ${following.text}` : segment.text;
          results.push({ title: row.title, text, start: segment.start,
            url: `https://www.youtube.com/watch?v=${row.id}&t=${Math.floor(segment.start)}s`, rank });
          previous = segment.start;
        }
      }
      return results.sort((a, b) => b.rank - a.rank || a.start - b.start).slice(0, 16)
        .map(({ rank: _rank, ...result }) => result);
    },
  };
}
