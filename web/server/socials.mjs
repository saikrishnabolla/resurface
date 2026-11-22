const SEARCH_URL = 'https://ydc-index.io/v1/search';
const PLATFORMS = new Map([
  ['instagram.com', 'Instagram'], ['www.instagram.com', 'Instagram'],
  ['youtube.com', 'YouTube'], ['www.youtube.com', 'YouTube'], ['m.youtube.com', 'YouTube'],
  ['tiktok.com', 'TikTok'], ['www.tiktok.com', 'TikTok'], ['m.tiktok.com', 'TikTok'],
]);
const PROFILE_HANDLE = /^[a-z0-9][a-z0-9_.-]{0,99}$/iu;
const IG_RESERVED = new Set(['about', 'accounts', 'api', 'developer', 'direct', 'explore', 'p', 'reel', 'reels', 'stories', 'terms', 'tv', 'web']);
const YT_TABS = new Set(['about', 'community', 'featured', 'live', 'playlists', 'shorts', 'streams', 'videos']);

export function parseSocialProfile(raw, { allowTab = true } = {}) {
  if (typeof raw !== 'string' || raw.length > 500 || !raw.trim()) return null;
  let parsed;
  try {
    const value = raw.trim();
    parsed = new URL(/^\w+:\/\//.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const platform = PLATFORMS.get(parsed.hostname);
  if (!platform || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null;

  const parts = parsed.pathname.replace(/\/$/, '').slice(1).split('/');
  let handle;
  if (platform === 'Instagram' && parts.length === 1 && PROFILE_HANDLE.test(parts[0]) && !IG_RESERVED.has(parts[0].toLowerCase())) {
    handle = parts[0].toLowerCase();
    return { platform, handle: `@${handle}`, url: `https://www.instagram.com/${handle}/` };
  }
  if (platform === 'TikTok' && parts.length === 1 && parts[0].startsWith('@') && PROFILE_HANDLE.test(parts[0].slice(1))) {
    handle = parts[0].slice(1).toLowerCase();
    return { platform, handle: `@${handle}`, url: `https://www.tiktok.com/@${handle}` };
  }
  if (platform !== 'YouTube') return null;
  if (allowTab && parts.length > 1 && YT_TABS.has(parts.at(-1))) parts.pop();
  if (parts.length === 1 && parts[0].startsWith('@') && PROFILE_HANDLE.test(parts[0].slice(1))) {
    return { platform, handle: parts[0], url: `https://www.youtube.com/${parts[0]}` };
  }
  if (parts.length !== 2) return null;
  const [prefix, id] = parts;
  if (prefix === 'channel' ? /^UC[\w-]{22}$/.test(id) : ['c', 'user'].includes(prefix) && PROFILE_HANDLE.test(id)) {
    return { platform, handle: prefix === 'channel' ? id : `@${id}`, url: `https://www.youtube.com/${prefix}/${id}` };
  }
  return null;
}

const KNOWN_CREATORS = [
  {
    name: 'Kameron Buckner',
    youtubeAliases: ['https://www.youtube.com/channel/UCSp52HvdllyUqLXsdwwOkTA'],
    accounts: [
      ['https://www.youtube.com/@KameronMonet', 'Kameron identifies herself and Social Docket on this channel.', 'https://www.youtube.com/watch?v=cUCiTNo-pTY'],
      ['https://www.instagram.com/kameronmonet/', 'Linked by Kameron in a video description.', 'https://www.youtube.com/watch?v=cUCiTNo-pTY'],
      ['https://www.tiktok.com/@kameronmonet', 'Linked by Kameron in a video description.', 'https://www.youtube.com/watch?v=cUCiTNo-pTY'],
    ],
  },
  {
    name: 'Jahbari Taylor',
    youtubeAliases: ['https://www.youtube.com/@jahbaritaylor'],
    accounts: [
      ['https://www.youtube.com/channel/UCgwp7OUqIJQpUE96kbSei3w', 'Linked from Jahbari’s public LinkedIn profile.', 'https://www.linkedin.com/in/jahbaritaylor'],
      ['https://www.tiktok.com/@jahbaritaylor', 'Linked from Jahbari’s public LinkedIn profile.', 'https://www.linkedin.com/in/jahbaritaylor'],
      ['https://www.instagram.com/jahbaritaylor/', 'Linked from Jahbari’s public creator profile.', 'https://www.matchmaker.fm/show-guest/jahbari-taylor-b84275'],
    ],
  },
];

const identity = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const profileKey = ({ url, platform, handle }) => platform === 'YouTube' && url.includes('/channel/') ? url : `${platform}/${handle.toLowerCase()}`;

function fallback(name, anchor, failure) {
  const supplied = { ...anchor, origin: 'provided', evidence: 'Link you added' };
  const known = KNOWN_CREATORS.find((entry) => identity(entry.name) === identity(name) && (
    [...entry.accounts.map(([url]) => url), ...entry.youtubeAliases].some((url) => profileKey(parseSocialProfile(url)) === profileKey(anchor))
  ));
  if (!known) {
    return {
      mode: 'manual',
      accounts: [supplied],
      message: failure ? 'You.com search is unavailable. You can add a YouTube link manually.' : 'Live search is not configured. You can add a YouTube link manually.',
    };
  }
  return {
    mode: 'known',
    accounts: [supplied, ...known.accounts.map(([url, evidence, sourceUrl]) => ({
      ...parseSocialProfile(url), evidence, sourceUrl, origin: 'found',
    })).filter((entry) => entry.platform !== anchor.platform)],
    message: failure ? 'You.com search is unavailable. Showing previously checked public profiles.' : 'Showing previously checked public profiles. Live You.com search is not configured.',
  };
}

function resultsToProfiles(results, name, anchor) {
  const nameKey = identity(name);
  const anchorKey = anchor.handle.startsWith('@') ? identity(anchor.handle) : '';
  const rows = new Map();
  for (const result of results) {
    const profile = parseSocialProfile(result?.url, { allowTab: false });
    if (!profile || profileKey(profile) === profileKey(anchor)) continue;
    const handleKey = identity(profile.handle);
    const evidenceText = [result.title, result.description, ...(Array.isArray(result.snippets) ? result.snippets : []), ...(Array.isArray(result.contents?.highlights) ? result.contents.highlights : [])].filter((v) => typeof v === 'string').join(' ');
    const sourceKey = identity(evidenceText);
    const sameHandle = Boolean(anchorKey && handleKey === anchorKey);
    const mentionsName = sourceKey.includes(nameKey);
    // A name or matching handle can suggest a candidate, but neither verifies ownership.
    if (!sameHandle && !mentionsName && handleKey !== nameKey) continue;
    const score = (sameHandle ? 4 : 0) + (mentionsName ? 2 : 0) + (handleKey === nameKey ? 1 : 0);
    const candidate = {
      ...profile,
      origin: 'suggested',
      evidence: sameHandle ? 'Matches the handle you provided' : mentionsName ? 'Search result mentions the creator’s name' : 'Profile handle matches the name',
      sourceUrl: profile.url,
    };
    const key = profileKey(profile);
    if (!rows.has(key) || rows.get(key).score < score) rows.set(key, { score, candidate });
  }
  return [...rows.values()].sort((a, b) => b.score - a.score).slice(0, 6).map(({ candidate }) => candidate);
}

export async function findAccounts({ name, profileUrl } = {}, { apiKey, fetchImpl = fetch } = {}) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100 || !identity(name)) {
    throw new TypeError('Enter a creator name between 2 and 100 characters.');
  }
  name = name.trim();
  const anchor = parseSocialProfile(profileUrl);
  if (!anchor) throw new TypeError('Enter a public Instagram, YouTube, or TikTok profile link, not a post or video.');
  if (!apiKey?.trim()) return fallback(name, anchor, false);

  try {
    const response = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `Find the public YouTube, Instagram, and TikTok profile pages for ${name.replace(/[\r\n\t"]/g, ' ')}. The supplied account is ${anchor.platform} ${anchor.handle}. Look for profile pages, not individual posts or videos.`,
        count: 18,
        include_domains: ['youtube.com', 'instagram.com', 'tiktok.com'],
        extraction: { extraction_mode: 'highlights' },
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) return fallback(name, anchor, true);
    const data = await response.json();
    if (!Array.isArray(data?.results?.web)) return fallback(name, anchor, true);
    const suggestions = resultsToProfiles(data.results.web, name, anchor);
    const haveYouTube = anchor.platform === 'YouTube' || suggestions.some((entry) => entry.platform === 'YouTube');
    const savedYouTube = haveYouTube ? undefined : fallback(name, anchor, false).accounts
      .find((entry) => entry.platform === 'YouTube' && entry.origin === 'found');
    return {
      mode: 'live',
      accounts: [{ ...anchor, origin: 'provided', evidence: 'Link you added' }, ...(savedYouTube ? [savedYouTube] : []), ...suggestions],
      ...(savedYouTube && { message: 'You.com did not return a YouTube channel. Showing a previously checked link.' }),
      ...(!suggestions.length && !savedYouTube && { message: 'You.com found no matching public profiles. You can add a YouTube link manually.' }),
    };
  } catch {
    return fallback(name, anchor, true);
  }
}
