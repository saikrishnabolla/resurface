import { parseSocialProfile } from '../server/socials.mjs';

export const workspaceKey = 'resurface.creator-workspace.v1';

export function normalizeAccount(url) {
  const profile = parseSocialProfile(url);
  if (!profile) return null;
  const { platform, handle } = profile;
  if (platform === 'YouTube' && !/^https:\/\/www\.youtube\.com\/(?:@[\w.-]{3,35}|channel\/UC[\w-]{22})$/.test(profile.url)) return null;
  if (platform === 'Instagram' && !/^@[a-z0-9._]{1,30}$/.test(handle)) return null;
  if (platform === 'TikTok' && !/^@[a-z0-9._]{2,30}$/.test(handle)) return null;
  if (platform === 'YouTube' && handle.startsWith('@')) profile.url = profile.url.toLowerCase();
  return profile;
}

export function normalizeWorkspace(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const anchor = normalizeAccount(input?.anchor);
  if (name.length < 2 || name.length > 100 || !anchor || !Array.isArray(input.accounts)) return null;
  const accounts = [...new Map(input.accounts.map(account => normalizeAccount(account?.url))
    .filter(Boolean).map(account => [account.url, account])).values()];
  return accounts.length ? { name, anchor: anchor.url, accounts } : null;
}

export function readWorkspace(storage) {
  try { return normalizeWorkspace(JSON.parse(storage.getItem(workspaceKey))); }
  catch { return null; }
}
