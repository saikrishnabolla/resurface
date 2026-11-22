import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findStories } from './discover.mjs';

const ok = (results) => new Response(JSON.stringify({ results }));

test('Discover requests fresh You.com results and keeps safe news citations in provider order', async () => {
  const result = await findStories({ query: '  creator rights\n updates ' }, {
    apiKey: ' test-secret ',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://ydc-index.io/v1/search');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-API-Key'], 'test-secret');
      assert.equal(init.redirect, 'error');
      assert.deepEqual(JSON.parse(init.body), { query: 'creator rights updates', freshness: 'week', count: 12 });
      return ok({
        web: [{ url: 'https://publisher.example/topic', title: 'Web result' }],
        news: [
          { url: 'https://www.publisher.example/news#section', title: ' First  source ', description: ' Real summary ', page_age: '2026-11-20T00:23:19' },
          { url: 'https://publisher.example/news', title: 'Duplicate' },
          { url: 'javascript:alert(1)', title: 'Unsafe' },
          { url: 'https://admin@publisher.example/story', title: 'Unsafe' },
          { url: 'http://127.0.0.1/secret', title: 'Local' },
          { url: 'https://another.example/story', title: 'Second source', page_age: 'yesterday' },
        ],
      });
    },
  });
  assert.deepEqual(result.stories, [
    { url: 'https://www.publisher.example/news', title: 'First source', description: 'Real summary', publishedAt: '2026-11-20T00:23:19.000Z' },
    { url: 'https://another.example/story', title: 'Second source', description: '', publishedAt: null },
  ]);
});

test('Discover bounds results and shows no stories when the provider has no news', async () => {
  const options = (results) => ({ apiKey: 'test', fetchImpl: async () => ok(results) });
  const limited = await findStories({ query: 'creator news' }, options({
    news: Array.from({ length: 20 }, (_, index) => ({ title: `Story ${index}`, url: `https://publisher.example/${index}` })),
  }));
  assert.equal(limited.stories.length, 8);
  assert.deepEqual(await findStories({ query: 'creator news' }, options({ web: [] })), { stories: [] });
});

test('Discover reports input, configuration, provider and timeout errors without fabricated results', async () => {
  await assert.rejects(findStories({ query: ' ' }), { status: 400 });
  await assert.rejects(findStories({ query: 'x'.repeat(161) }), { status: 400 });
  await assert.rejects(findStories({ query: 'creator news' }), { status: 503 });
  const run = (fetchImpl) => findStories({ query: 'creator news' }, { apiKey: 'test', fetchImpl });
  await assert.rejects(run(async () => new Response('quota', { status: 429 })), { status: 503 });
  await assert.rejects(run(async () => new Response('unavailable', { status: 500 })), { status: 502 });
  await assert.rejects(run(async () => new Response('not json')), { status: 502 });
  await assert.rejects(run(async () => ok({ news: 'invalid' })), { status: 502 });
  await assert.rejects(run(async () => { throw new DOMException('Slow', 'TimeoutError'); }), { status: 504 });
});

test('Discover uses dated web stories when You.com omits its news bucket', async () => {
  const now = Date.now();
  const result = await findStories({ query: 'creators' }, { apiKey: 'test', fetchImpl: async () => ok({
    web: [
      { url: 'https://publisher.example/recent', title: 'Recent', page_age: new Date(now - 86400000).toISOString() },
      { url: 'https://publisher.example/old', title: 'Old', page_age: new Date(now - 15 * 86400000).toISOString() },
      { url: 'https://publisher.example/home', title: 'Undated' },
    ],
  }) });
  assert.deepEqual(result.stories.map(story => story.title), ['Recent']);
});

test('Discover keeps only stories that name the topic and drops reference pages and homepages', async () => {
  const result = await findStories({ query: 'social docket', terms: ['social docket'] }, {
    apiKey: 'test',
    fetchImpl: async () => ok({
      news: [
        { url: 'https://valdez.example/p/story', title: 'How a lawyer built Social Docket', description: 'A founder story' },
        { url: 'https://en.wikipedia.org/wiki/Docket', title: 'Social docket - Wikipedia', description: 'social docket' },
        { url: 'https://school.example/', title: 'Social Docket home', description: 'social docket' },
        { url: 'https://movies.example/review', title: 'The Social Reckoning', description: 'A film about a docket' },
      ],
    }),
  });
  assert.deepEqual(result.stories.map(story => story.url), ['https://valdez.example/p/story']);
});
