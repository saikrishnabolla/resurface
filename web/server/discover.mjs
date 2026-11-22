const SEARCH_URL = 'https://ydc-index.io/v1/search';
const MAX_STORIES = 8;
const TARGET_STORIES = 6;
const DAY = 86_400_000;
const DIRECTORY_TITLE = /^\d+ law schools? in .+rankings\b/i;
const GUIDE_TITLE = /^(how to|top \d+|best \d+)\b|\b(ultimate guide|\d{4} guide|step.by.step)\b/i;
const RELATED = [
  ['brand deal', 'creator sponsorships', 'influencer brand partnerships', 'paid partnerships', 'sponsored content', 'brand collaborations'],
  ['creator economy', 'creator monetization', 'influencer marketing', 'creator business'],
  ['usage right', 'licensing rights', 'content licensing', 'image rights'],
  ['short form', 'short form video', 'vertical video', 'short videos'],
  ['legal education', 'law school', 'legal training'],
  ['tech founder', 'startup founders', 'tech startups', 'startup funding'],
];
const cleanKey = words => words.join(' ');
// Reference, dictionary and homepage results are not events. Drop them.
const REFERENCE_HOSTS = /(^|\.)(wikipedia\.org|wikimedia\.org|grokipedia\.com|britannica\.com|dictionary\.com|cambridge\.org|merriam-webster\.com|wiktionary\.org|fandom\.com)$/;
const squash = value => (typeof value === 'string' ? value : '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
}

function sourceUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2200) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.replace(/\.$/, '');
    // Only link to publisher hostnames. The API result is never fetched by this server.
    if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || /\.(localhost|local|internal|test|invalid)$/.test(host)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function articleDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d(?:T|$)/.test(value)) return null;
  const utc = /T/.test(value) && !/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? `${value}Z` : value;
  const timestamp = Date.parse(utc);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

const stem = word => (word.length > 3 ? word.replace(/s$/, '') : word);
const wordsOf = value => squash(value).split(' ').filter(Boolean);

function fit(item, terms, related, context) {
  const title = wordsOf(item?.title).map(stem);
  const words = [...title, ...wordsOf(item?.description).map(stem)];
  const have = new Set(words);
  const hasPhrase = (tokens, term) => ` ${cleanKey(tokens)} `.includes(` ${term} `);
  if (terms.includes('brand deal') && !words.some(word => /^(creator|influencer|sponsor|sponsorship|ugc|tiktok|instagram|youtube)$/.test(word))) return 0;
  if (terms.some(term => hasPhrase(title, term))) return 5;
  if (related.some(term => hasPhrase(title, term))) return 4;
  if (terms.some(term => hasPhrase(words, term))) return 4;
  if (related.some(term => hasPhrase(words, term))) return 3;
  return [...terms, ...related].some(term => {
    const parts = term.split(' ');
    return parts.length > 1 && parts.every(word => have.has(word)) &&
      context.some(word => !parts.includes(word) && have.has(word));
  }) ? 2 : 0;
}

async function search(query, freshness, count, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, freshness, count }),
      signal: AbortSignal.timeout(freshness === 'month' ? 7_000 : 8_000),
      redirect: 'error',
    });
  } catch (error) {
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw problem(504, 'You.com took too long to respond. Try again.');
    throw problem(502, 'Could not reach You.com. Try again.');
  }
  if (response.status === 429) throw problem(503, 'You.com is limiting search requests. Try again shortly.');
  if (!response.ok) throw problem(502, 'You.com could not complete the search.');
  const data = await response.json().catch(() => null);
  const results = data?.results;
  if (!results || (results.news !== undefined && !Array.isArray(results.news))
      || (results.news === undefined && !Array.isArray(results.web))) {
    throw problem(502, 'You.com did not return a usable search response.');
  }
  return results;
}

function candidates(results, windowDays, terms, related, context, fallback) {
  const inWindow = item => {
    const date = articleDate(item?.page_age);
    const age = date ? Date.now() - Date.parse(date) : Infinity;
    return age >= -DAY && age <= windowDays * DAY;
  };
  const news = (results.news ?? []).filter(item => !fallback || inWindow(item));
  const datedWeb = (Array.isArray(results.web) ? results.web : []).filter(inWindow);
  return [...news.map(item => [item, true]), ...datedWeb.map(item => [item, false])].flatMap(([item, isNews]) => {
    const url = sourceUrl(item?.url);
    const title = text(item?.title, 200);
    if (!url || !title || REFERENCE_HOSTS.test(url.hostname) || url.pathname.replace(/\//g, '') === '' ||
        (terms.length && DIRECTORY_TITLE.test(title))) return [];
    const score = terms.length ? fit(item, terms, related, context) : 3;
    if (!score) return [];
    const publishedAt = articleDate(item.page_age);
    return [{
      score, recent: !fallback || Date.now() - Date.parse(publishedAt) <= 8 * DAY,
      editorial: terms.length ? Number(isNews) + (GUIDE_TITLE.test(title) ? -2 : 0) : 0,
      publisher: url.hostname.replace(/^www\./, ''),
      key: `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`,
      title,
      url: url.href,
      description: text(item.description, 380),
      publishedAt,
    }];
  });
}

function rank(rows, diverse = false) {
  const seen = new Set(), titles = new Set();
  const publishers = new Map();
  return [...rows].sort((a, b) => Number(b.recent) - Number(a.recent) ||
    b.score + b.editorial - a.score - a.editorial).filter(row => {
    const title = squash(row.title).slice(0, 90);
    if (seen.has(row.key) || titles.has(title) || (diverse && (publishers.get(row.publisher) ?? 0) >= 3)) return false;
    seen.add(row.key);
    titles.add(title);
    publishers.set(row.publisher, (publishers.get(row.publisher) ?? 0) + 1);
    return true;
  }).slice(0, MAX_STORIES);
}

export async function findStories({ query, terms, context } = {}, { apiKey, fetchImpl = fetch } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 160) {
    throw problem(400, 'Enter a topic between 1 and 160 characters.');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw problem(503, 'Live news search is not configured.');
  }
  const cleanQuery = text(query, 160);
  const topics = (Array.isArray(terms) ? terms : []).slice(0, 3)
    .map(term => cleanKey(wordsOf(text(term, 120)).map(stem))).filter(Boolean);
  const niche = (Array.isArray(context) ? context : []).slice(0, 24).flatMap(wordsOf).map(stem);
  const keyFor = term => cleanKey(wordsOf(term).map(stem));
  const aliases = (RELATED.find(group => group.some(term => topics.includes(keyFor(term)))) ?? [])
    .filter(term => !topics.includes(keyFor(term)));
  const related = aliases.map(term => cleanKey(wordsOf(term).map(stem)));
  const exactQuery = topics.includes('brand deal') ? `${cleanQuery} creators influencers` : cleanQuery;
  const expanded = aliases.length ? aliases.slice(0, 2).join(' ') : `${cleanQuery} news coverage`;
  const primary = await search(exactQuery, 'week', topics.length ? 20 : 12, apiKey, fetchImpl);
  let rows = candidates(primary, 8, topics, related, niche, false);
  if (topics.length && rank(rows, true).filter(row => row.score >= 3 && row.editorial >= 0).length < TARGET_STORIES) {
    const second = await search(expanded, 'week', 20, apiKey, fetchImpl).catch(() => null);
    if (second) rows = rows.concat(candidates(second, 8, topics, related, niche, false));
  }
  if (topics.length && rank(rows, true).filter(row => row.score >= 3 && row.editorial >= 0).length < TARGET_STORIES) {
    const fallback = await search(expanded, 'month', 20, apiKey, fetchImpl).catch(() => null);
    if (fallback) rows = rows.concat(candidates(fallback, 31, topics, related, niche, true));
  }
  return { stories: rank(rows, topics.length > 0).map(({ score, recent, key, publisher, editorial, ...story }) => story) };
}
