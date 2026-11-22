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

export async function findStories({ query, terms } = {}, { apiKey, fetchImpl = fetch } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.trim().length > 160) {
    throw problem(400, 'Enter a topic between 1 and 160 characters.');
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw problem(503, 'Live news search is not configured.');
  }
  let response;
  try {
    response = await fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text(query, 160), freshness: 'week', count: 12 }),
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
    if (Array.isArray(terms) && terms.length) {
      // Keep only stories that actually say the topic, as a phrase, in the headline or summary.
      const haystack = ` ${squash(`${item?.title} ${item?.description}`)} `;
      if (!terms.slice(0, 3).some(term => squash(term) && haystack.includes(` ${squash(term)} `))) continue;
    }
    const key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}${url.search}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stories.push({
      title,
      url: url.href,
      description: text(item.description, 380),
      publishedAt: articleDate(item.page_age),
    });
    if (stories.length === MAX_STORIES) break;
  }
  return { stories };
}
