import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccount, normalizeWorkspace, readWorkspace, workspaceKey } from '../src/creator-workspace.mjs';

const youtube = 'https://www.youtube.com/@KameronMonet';
const instagram = 'https://www.instagram.com/kameronmonet/';

test('a creator workspace contains only confirmed, importable profiles', () => {
  const workspace = normalizeWorkspace({ name: ' Kameron ', anchor: youtube,
    accounts: [{ url: instagram }, { url: 'instagram.com/KameronMonet' }, { url: 'https://www.youtube.com/watch?v=abc' }] });
  assert.equal(workspace.name, 'Kameron');
  assert.equal(workspace.anchor, 'https://www.youtube.com/@kameronmonet');
  assert.deepEqual(workspace.accounts.map(account => account.url), [instagram]);
  assert.equal(normalizeWorkspace({ ...workspace, accounts: [] }), null);
});

test('profiles use archive-compatible URLs and do not accept post or legacy URLs', () => {
  assert.equal(normalizeAccount('youtube.com/@KameronMonet/shorts').url, 'https://www.youtube.com/@kameronmonet');
  assert.equal(normalizeAccount('https://m.tiktok.com/@KameronMonet').url, 'https://www.tiktok.com/@kameronmonet');
  assert.equal(normalizeAccount('https://www.youtube.com/c/KameronMonet'), null);
  assert.equal(normalizeAccount('https://www.instagram.com/reel/ABCDEF/'), null);
});

test('a returning browser restores its own selection and invalid storage starts onboarding', () => {
  const input = { name: 'Kameron', anchor: youtube, accounts: [{ url: instagram }] };
  const storage = { getItem(key) { assert.equal(key, workspaceKey); return JSON.stringify(input); } };
  assert.deepEqual(readWorkspace(storage), normalizeWorkspace(input));
  assert.equal(readWorkspace({ getItem: () => null }), null);
  assert.equal(readWorkspace({ getItem: () => '{' }), null);
});
