import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyArchive, importProgress, searchCaptions, streamArchive } from '../src/live-archive.mjs';

test('search returns caption text and exact source offset before import finishes', async t => {
  const captions = new Map();
  const encoder = new TextEncoder();
  const progress = [];
  t.mock.method(global, 'fetch', async () => new Response(new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode('{"kind":"listed","total":2}\n{"kind":"it'));
      c.enqueue(encoder.encode('em","video":{"id":"abcdefghijk","title":"Example","status":"ok"},"segments":[{"start":168.239,"text":"Licensing and usage rights"}]}\n'));
      c.enqueue(encoder.encode('{"kind":"done","failed":true,"message":"The provider stopped."}\n'));
      c.close();
    },
  }), { headers: { 'Content-Type': 'application/x-ndjson' } }));
  await streamArchive({}, captions, job => {
    progress.push(job);
    if (job.ready) {
      assert.equal(searchCaptions(captions, 'Usage rights')[0].url, 'https://www.youtube.com/watch?v=abcdefghijk&t=168s');
      assert.deepEqual(searchCaptions(captions, 'absent'), []);
    }
  });
  assert.deepEqual(progress.map(job => job.state), ['running', 'running', 'partial']);
  assert.equal(progress.at(-1).ready, 1);
});

test('a provider failure cannot enable search or claim any imported clips', () => {
  const state = importProgress(emptyArchive(), new Map(), { kind: 'done', failed: true, message: 'Provider unavailable.' });
  assert.equal(state.state, 'error');
  assert.equal(state.ready, 0);
  assert.equal(state.message, 'Provider unavailable.');
});
