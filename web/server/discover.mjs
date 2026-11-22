const SEARCH_URL = 'https://ydc-index.io/v1/search';
const MAX_STORIES = 8;
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

// How well a story fits a topic. 3: it says the phrase. 2: it uses every word of the topic and at least one word
// from the creator's niche. 1: some topic word plus two niche words. 0: no fit. This keeps "brand deals" stories
// about creators and drops Black Friday lists and unrelated pages that share one word.
function fit(item, terms, context) {
  const haystack = ` ${squash(`${item?.title} ${item?.description}`)} `;
  if (terms.slice(0, 3).some(term => squash(term) && haystack.includes(` ${squash(term)} `))) return 3;
  if (!context.length) return 0;
  const have = new Set(wordsOf(haystack).map(stem));
  const topicWords = [...new Set(terms.slice(0, 3).flatMap(wordsOf).map(stem))];
  const niche = new Set(context.map(stem).filter(word => !topicWords.includes(word) && have.has(word))).size;
  if (topicWords.length && topicWords.every(word => have.has(word)) && niche >= 1) return 2;
  return topicWords.some(word => have.has(word)) && niche >= 2 ? 1 : 0;
}

export async function findStories({ query, terms, context } = {}, { apiKey, fetchImpl = fetch } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 160) {
    throw problem(400, 'Enter a topic between 1 and 160 characters.');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw problem(503, 'Live news search is not configured.');
  }
  const niche = (Array.isArray(context) ? context : []).filter(word => typeof word === 'string' && word.length <= 30).slice(0, 24).flatMap(wordsOf);
  const topicWords = new Set((Array.isArray(terms) ? terms : []).flatMap(wordsOf).map(stem));
  // Steer the search toward the creator's world by adding the two niche words that are not part of the topic.
  const extra = [...new Set(niche.filter(word => word.length > 3 && !topicWords.has(stem(word))))].slice(0, 2);
  const searchQuery = text([text(query, 160), ...extra].join(' '), 200);
  let response;
  try {
    response = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchQuery, freshness: 'week', count: 12 }),
      signal: AbortSignal.timeout(10_000),
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

  const stories = [];
  const seen = new Set();
  const news = results.news ?? [];
  const datedWeb = (Array.isArray(results.web) ? results.web : []).filter(item => {
    const date = articleDate(item?.page_age);
    const age = date ? Date.now() - Date.parse(date) : Infinity;
    return age >= -86_400_000 && age <= 8 * 86_400_000;
  });
  for (const item of [...news, ...datedWeb]) {
    const url = sourceUrl(item?.url);
    const title = text(item?.title, 200);
    if (!url || !title) continue;
    if (REFERENCE_HOSTS.test(url.hostname) || url.pathname.replace(/\//g, '') === '') continue;
    const score = Array.isArray(terms) && terms.length ? fit(item, terms, niche) : 3;
    if (!score) continue;
    const key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`;
    const sameStory = squash(title).slice(0, 70);
    if (seen.has(key) || seen.has(sameStory)) continue;
    seen.add(key);
    seen.add(sameStory);
    stories.push({
      score,
      title,
      url: url.href,
      description: text(item.description, 380),
      publishedAt: articleDate(item.page_age),
    });
    if (stories.length >= 24) break;
  }
  // Best fit first; provider order breaks ties. Drop weak one-word matches when stronger stories exist.
  const best = Math.max(0, ...stories.map(story => story.score));
  const kept = stories.map((story, index) => ({ story, index })).filter(({ story }) => story.score >= Math.min(2, best))
    .sort((a, b) => b.story.score - a.story.score || a.index - b.index).slice(0, MAX_STORIES)
    .map(({ story: { score: _score, ...story } }) => story);
  return { stories: kept };
}
