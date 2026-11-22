const videoId = /^[A-Za-z0-9_-]{11}$/;
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const emptyArchive = () => ({ state: 'loading', total: 0, checked: 0, ready: 0, skipped: 0 });

export function importProgress(job, captions, event) {
  if (event.kind === 'listed') {
    if (!Number.isInteger(event.total) || event.total < 0 || event.total > 100) throw new Error('Invalid upload count.');
    return { ...job, state: 'running', total: event.total };
  }
  if (event.kind === 'item' && videoId.test(event.video?.id ?? '')) {
    const { id, title, status } = event.video;
    const segments = Array.isArray(event.segments)
      ? event.segments.filter(row => typeof row?.text === 'string' && Number.isFinite(row.start) && row.start >= 0) : [];
    if (status === 'ok' && segments.length) captions.set(id, { id, title, segments });
    return {
      ...job, checked: job.checked + Number(!['not_checked', 'skipped_after_block'].includes(status)),
      ready: captions.size, skipped: job.skipped + Number(!captions.has(id)),
    };
  }
  if (event.kind === 'done') {
    const state = event.blocked ? job.ready ? 'partial' : 'blocked'
      : event.failed || event.timedOut ? job.ready ? 'partial' : 'error'
        : job.ready < job.total ? 'partial' : 'complete';
    const message = event.message ?? (event.blocked ? 'YouTube limited requests for captions.'
      : event.timedOut ? 'The import ran out of time.'
        : job.ready < job.total ? 'Some uploads did not return captions.' : '');
    return { ...job, state, message };
  }
  return job;
}

export async function streamArchive(input, captions, onProgress, signal) {
  const response = await fetch('/api/import_youtube', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? 'Could not connect to the live importer.');
  }
  if (!response.body || !response.headers.get('content-type')?.startsWith('application/x-ndjson')) {
    throw new Error('The live importer did not return upload data.');
  }
  let job = emptyArchive();
  let finished = false;
  let pending = '';
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        job = importProgress(job, captions, event);
        onProgress(job);
        if (event.kind === 'done') finished = true;
      }
    }
    if (!finished) throw new Error('The connection ended before the import finished.');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function searchCaptions(captions, query) {
  const words = normalize(query).split(' ').filter(Boolean).slice(0, 12);
  if (!words.length) return [];
  const exact = words.join(' ');
  const phrase = text => {
    if (` ${text} `.includes(` ${exact} `)) return true;
    if (words.length !== 1 || exact.length < 6) return false;
    const tokens = text.split(' ');
    return tokens.some((token, i) => token + tokens[i + 1] === exact);
  };
  const results = [];
  for (const { id, title, segments } of captions.values()) {
    let previous = -Infinity;
    for (let i = 0; i < segments.length; i++) {
      const { start, text } = segments[i];
      if (start - previous < 12) continue;
      const first = normalize(text);
      const next = segments[i + 1];
      const second = next && next.start - start <= 12 ? normalize(next.text) : '';
      const rank = phrase(first) ? 3 : second && phrase(`${first} ${second}`) && !phrase(second) ? 2
        : words.length > 1 && words.every(word => ` ${first} `.includes(` ${word} `)) ? 1 : 0;
      if (!rank) continue;
      results.push({ start, title, text: rank === 2 ? `${text} ${next.text}` : text, rank,
        url: `https://www.youtube.com/watch?v=${id}&t=${Math.floor(start)}s` });
      previous = start;
    }
  }
  return results.sort((a, b) => b.rank - a.rank || a.start - b.start).slice(0, 16);
}
