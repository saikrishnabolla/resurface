import { findAccounts } from '../server/socials.mjs';
import { findStories } from '../server/discover.mjs';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function routeFor(req) {
  const url = new URL(req.url ?? '/', 'https://resurface.invalid');
  if (url.pathname === '/api/accounts') return { action: 'accounts' };
  if (url.pathname === '/api/discover') return { action: 'discover' };
  const query = name => req.query?.[name] ?? url.searchParams.get(name);
  if (url.pathname === '/api/resurface') {
    return { action: query('action') };
  }
  return {};
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw httpError(415, 'Send a JSON request.');
  }
  if (Number(req.headers['content-length']) > 8192) throw httpError(413, 'Request is too large.');
  let body = req.body;
  if (body === undefined) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 8192) throw httpError(413, 'Request is too large.');
      chunks.push(buffer);
    }
    body = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 8192) throw httpError(413, 'Request is too large.');
    try { body = JSON.parse(body); } catch { throw httpError(400, 'Invalid request.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Invalid request.');
  return body;
}

function assertSameOrigin(req) {
  const { origin, host } = req.headers;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'This request must come from Resurface.');
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw httpError(403, 'This request must come from Resurface.'); }
  if (parsed.host !== host) throw httpError(403, 'This request must come from Resurface.');
}

export function createHandler({ lookup = findAccounts, discover = findStories, getApiKey = () => process.env.YOU_COM_API_KEY } = {}) {
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    try {
      const { action } = routeFor(req);
      if (req.method === 'POST') {
        assertSameOrigin(req);
        if (action === 'accounts') return send(200, await lookup(await readJson(req), { apiKey: getApiKey() }));
        if (action === 'discover') return send(200, await discover(await readJson(req), { apiKey: getApiKey() }));
      }
      return send(404, { error: 'Route not found.' });
    } catch (error) {
      const status = error.status ?? (error instanceof TypeError ? 400 : 500);
      return send(status, { error: status < 500 || error.status ? error.message : 'Resurface could not finish that request.' });
    }
  };
}

export default createHandler();
