import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHandler } from '../api/resurface.mjs';

async function request(handler, { method = 'GET', url, query, body, headers = {} }) {
  const result = {};
  await handler(
    { method, url, query, body, headers: { host: 'resurface.example', 'content-type': 'application/json', ...headers } },
    {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
      },
      end(data) { result.body = JSON.parse(data); },
    },
  );
  return result;
}

test('Vercel serves the built Vite client, account lookup, and a Python importer', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'dist/client');
  assert.deepEqual(config.rewrites, [
    { source: '/api/accounts', destination: '/api/resurface?action=accounts' },
    { source: '/api/discover', destination: '/api/resurface?action=discover' },
  ]);
  assert.equal(config.functions['api/import_youtube.py'].includeFiles, 'server/*.py');
});

test('hosted social discovery passes the server-only key to the existing lookup', async () => {
  let invoked = 0;
  const handler = createHandler({
    lookup: async (input, options) => {
      invoked++;
      assert.deepEqual(input, { name: 'Kameron Buckner', profileUrl: 'instagram.com/kameronmonet' });
      assert.equal(options.apiKey, 'test-key');
      return { mode: 'live', accounts: [] };
    },
    getApiKey: () => 'test-key',
  });
  const body = { name: 'Kameron Buckner', profileUrl: 'instagram.com/kameronmonet' };
  const response = await request(handler, {
    method: 'POST', url: '/api/resurface?action=accounts', body,
    headers: { origin: 'https://resurface.example' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { mode: 'live', accounts: [] });
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal((await request(handler, {
    method: 'POST', url: '/api/accounts', body, headers: { origin: 'https://unrelated.example' },
  })).status, 403);
  assert.equal(invoked, 1);
});

test('the former hosted sample routes have been removed', async () => {
  const handler = createHandler();
  assert.equal((await request(handler, {
    method: 'POST', url: '/api/archive', body: { creator: 'Kameron Buckner', channelUrl: 'youtube.com/@KameronMonet' },
  })).status, 404);
  assert.equal((await request(handler, { url: '/api/archive/kameron-sample/search?q=rights' })).status, 404);
});
