import assert from 'node:assert/strict';
import test from 'node:test';
import { clipsFor, searchDiscover, sourcesFor } from '../src/zip/discover-model.mjs';

const youtube = { platform: 'YouTube', url: 'https://www.youtube.com/@creator', handle: '@creator' };
const instagram = { platform: 'Instagram', url: 'https://www.instagram.com/creator/', handle: '@creator' };
const tiktok = { platform: 'TikTok', url: 'https://www.tiktok.com/@creator', handle: '@creator' };
const topic = { name: 'creator contracts', sources: [] };
const match = { id: 'VDAC1BC43BE', title: 'Saved video', start: 2.18, text: 'Creator contracts need review.' };

test('results join only the matching account metadata and leave scores uncalculated', () => {
  const clips = clipsFor({ account: youtube, matches: [match, match, { ...match, start: 20 }], topic,
    videos: [{ id: match.id, title: 'Imported video', duration: 15, publishedAt: '2026-01-01' }] });
  assert.equal(clips.length, 1);
  assert.equal(clips[0].start, 2.18);
  assert.equal(clips[0].end, 15);
  assert.equal(clips[0].video.title, 'Imported video');
  assert.equal(clips[0].video.url, 'https://www.youtube.com/watch?v=VDAC1BC43BE');
  assert.equal(clips[0].profile.url, youtube.url);
  assert.equal(Object.hasOwn(clips[0], 'scores'), false);
  assert.notEqual(clips[0].id, clipsFor({ account: instagram, matches: [match], topic })[0].id);
});

test('a failed archive does not prevent exact matches or citations from other requests', async () => {
  const requests = [];
  const result = await searchDiscover({
    query: topic.name, accounts: [youtube, instagram], entries: {},
    findStories: async query => {
      assert.equal(query, topic.name);
      return { stories: [{ title: 'News', url: 'https://www.publisher.example/a', publishedAt: '2026-11-22' }] };
    },
    findMatches: async (url, query) => {
      requests.push(url);
      assert.equal(query, topic.name);
      if (url === instagram.url) throw new Error('down');
      return { matches: [match] };
    },
  });
  assert.deepEqual(requests, [youtube.url, instagram.url]);
  assert.ok(!requests.includes(tiktok.url));
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].topic.sources[0].publisher, 'publisher.example');
  assert.deepEqual(result.failedArchives, [instagram]);
  assert.equal(result.newsError, false);
});

test('a failed You.com request leaves transcript matches available with no citations', async () => {
  const result = await searchDiscover({ query: topic.name, accounts: [youtube], entries: {},
    findStories: async () => { throw new Error('down'); }, findMatches: async () => ({ matches: [match] }) });
  assert.equal(result.newsError, true);
  assert.equal(result.clips.length, 1);
  assert.deepEqual(result.clips[0].topic.sources, []);
  assert.deepEqual(sourcesFor([{ title: 'Invalid source', url: 'javascript:alert(1)' }]), []);
});
