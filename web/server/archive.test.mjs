import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createArchiveService, normalizeChannel } from './archive.mjs';

test('accepts public YouTube channel URLs only', () => {
  assert.equal(normalizeChannel('youtube.com/@KameronMonet/shorts?si=example'), 'https://www.youtube.com/@KameronMonet');
  for (const value of ['https://youtube.com.evil.test/@abc', 'https://user@youtube.com/@abc', 'https://youtube.com/watch?v=abcdefghijk', 'https://youtube.com:3001/@abc']) {
    assert.throws(() => normalizeChannel(value), { status: 400 });
  }
});

test('loads a saved archive, searches across caption boundaries, and keeps block counts accurate', async t => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'resurface-archive-'));
  t.after(() => rm(cacheDir, { recursive: true }));
  const dir = join(cacheDir, 'archive-fixture');
  await mkdir(dir);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    channel_id: 'UCSp52HvdllyUqLXsdwwOkTA',
    videos: [
      { id: 'abcdefghijk', title: 'Brand deals', status: 'ok', transcript: 'abcdefghijk.json' },
      { id: 'abcdefghijl', status: 'IpBlocked' },
      { id: 'abcdefghijm', status: 'skipped_after_block' },
    ],
  }));
  await writeFile(join(dir, 'abcdefghijk.json'), JSON.stringify({ segments: [
    { start: 166.6, text: 'Talk to them about usage' },
    { start: 168.1, text: 'rights before you sign.' },
  ] }));
  const service = createArchiveService({ cacheDir });
  const job = await service.start({ creator: 'Kameron Buckner', channelUrl: 'https://www.youtube.com/@KameronMonet' });
  assert.equal(job.state, 'partial');
  assert.equal(job.total, 3);
  assert.equal(job.checked, 2);
  assert.equal(job.ready, 1);
  assert.equal(job.skipped, 2);
  assert.deepEqual(service.status(job.id), job);
  assert.deepEqual(await service.search(job.id, 'usage rights'), [{
    title: 'Brand deals', text: 'Talk to them about usage rights before you sign.', start: 166.6,
    url: 'https://www.youtube.com/watch?v=abcdefghijk&t=166s',
  }]);
  assert.deepEqual(await service.search(job.id, 'unrelated keyword'), []);
  await assert.rejects(service.search('unknown', 'test'), { status: 404 });
});
