import assert from 'node:assert/strict';
import test from 'node:test';
import { findAccounts, parseSocialProfile } from './socials.mjs';

const kameron = { name: 'Kameron Buckner', profileUrl: 'instagram.com/kameronmonet' };

test('canonicalizes actual profile URLs, but rejects content and untrusted domains', () => {
  assert.deepEqual(parseSocialProfile('https://m.youtube.com/@KameronMonet/shorts?feature=share'), {
    platform: 'YouTube', handle: '@KameronMonet', url: 'https://www.youtube.com/@KameronMonet',
  });
  assert.equal(parseSocialProfile('tiktok.com/@kameronmonet?tracking=1').url, 'https://www.tiktok.com/@kameronmonet');
  for (const url of ['https://www.youtube.com/watch?v=W3q-4RJ3c8k', 'https://www.youtube.com/shorts/abc', 'instagram.com/reel/abc', 'https://instagram.com:8080/creator', 'https://instagram.com.evil.test/kameronmonet', 'https://evil.test@instagram.com/kameronmonet', 'https://www.tiktok.com/@creator/video/123', 'javascript:alert(1)']) {
    assert.equal(parseSocialProfile(url), null, url);
  }
});

test('returns labeled known profiles only when the name and anchor agree', async () => {
  const result = await findAccounts(kameron);
  assert.equal(result.mode, 'known');
  assert.deepEqual(result.accounts.map(({ platform, origin }) => [platform, origin]), [['Instagram', 'provided'], ['YouTube', 'found'], ['TikTok', 'found']]);
  assert.equal(result.accounts[1].url, 'https://www.youtube.com/@KameronMonet');
  assert.match(result.message, /not configured/);
  const mismatched = await findAccounts({ ...kameron, profileUrl: 'instagram.com/unrelated' });
  assert.equal(mismatched.mode, 'manual');
  assert.equal(mismatched.accounts.length, 1);
});

test('invalid names or unsupported inputs produce a friendly validation error', async () => {
  await assert.rejects(findAccounts({ ...kameron, name: ' ' }), /Enter a creator name/);
  await assert.rejects(findAccounts({ ...kameron, profileUrl: 'https://youtube.com/watch?v=x' }), /public Instagram, YouTube, or TikTok profile link/);
});

test('searches You.com privately and keeps only relevant, distinct direct social profiles', async () => {
  const fakeFetch = async (url, init) => {
    assert.equal(url, 'https://ydc-index.io/v1/search');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['X-API-Key'], 'fake-key');
    assert.equal(init.redirect, 'error');
    assert.match(JSON.parse(init.body).query, /Kameron Buckner.*@kameronmonet/);
    return Response.json({ results: { web: [
      { url: 'https://www.youtube.com/@KameronMonet', title: 'Kameron Monet' },
      { url: 'https://youtube.com/@kameronmonet?tracking=1', title: 'Kameron Buckner' },
      { url: 'https://instagram.com/kameronmonet/', title: 'Kameron Buckner' },
      { url: 'https://tiktok.com/@legaleducation', title: 'Kameron Buckner – profile' },
      { url: 'https://tiktok.com/@irrelevant', title: 'Different person' },
      { url: 'https://youtube.com/@kameronmonet/videos', title: 'Kameron Buckner' },
      { url: 'https://youtube.com/watch?v=x', title: 'Kameron Buckner' },
      { url: 'https://instagram.com.evil.test/kameronmonet', title: 'Kameron Buckner' },
    ] } });
  };
  const result = await findAccounts(kameron, { apiKey: 'fake-key', fetchImpl: fakeFetch });
  assert.equal(result.mode, 'live');
  assert.deepEqual(result.accounts.map(({ platform, origin }) => [platform, origin]), [['Instagram', 'provided'], ['YouTube', 'suggested'], ['TikTok', 'suggested']]);
  assert.match(result.accounts[1].evidence, /Matches the handle/);
  assert.ok(!JSON.stringify(result).includes('fake-key'));
});

test('explains missing results, and labels service errors as fallback', async () => {
  const empty = await findAccounts({ ...kameron, profileUrl: 'instagram.com/unrelated' }, {
    apiKey: 'fake', fetchImpl: async () => Response.json({ results: { web: [] } }),
  });
  assert.equal(empty.mode, 'live');
  assert.match(empty.message, /no matching public profiles/);
  const denied = await findAccounts(kameron, { apiKey: 'fake', fetchImpl: async () => new Response(null, { status: 401 }) });
  assert.equal(denied.mode, 'known');
  assert.match(denied.message, /You.com search is unavailable/);
  const offline = await findAccounts({ name: 'Someone Else', profileUrl: 'tiktok.com/@else' }, { apiKey: 'fake', fetchImpl: async () => { throw new Error('secret'); } });
  assert.equal(offline.mode, 'manual');
  assert.ok(!JSON.stringify(offline).includes('secret'));
});

test('labels a previously checked YouTube account when live search misses it', async () => {
  const result = await findAccounts(kameron, {
    apiKey: 'fake', fetchImpl: async () => Response.json({ results: { web: [] } }),
  });
  assert.equal(result.mode, 'live');
  assert.equal(result.accounts[1].origin, 'found');
  assert.match(result.message, /previously checked/);
});
