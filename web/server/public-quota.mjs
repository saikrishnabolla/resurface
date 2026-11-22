import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { neon } from '@neondatabase/serverless';

const DAY = 86400;
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS resurface_public_quota (
  bucket TEXT PRIMARY KEY, window_id BIGINT NOT NULL, used INTEGER NOT NULL)`;
const INCREMENT = `INSERT INTO resurface_public_quota (bucket, window_id, used)
  VALUES ($1, $2, 1) ON CONFLICT (bucket) DO UPDATE
  SET window_id=excluded.window_id,
      used=CASE WHEN resurface_public_quota.window_id < excluded.window_id THEN 1
                ELSE resurface_public_quota.used + 1 END
  WHERE resurface_public_quota.window_id < excluded.window_id
     OR (resurface_public_quota.window_id = excluded.window_id AND resurface_public_quota.used < $3)
  RETURNING used`;

let ready;

export async function consumeSearch(headers, { env = process.env, now = Date.now(), connect = neon } = {}) {
  if (env.VERCEL_ENV !== 'production') return null;
  if (!env.DATABASE_URL) throw new Error('Quota storage is not configured.');
  const sql = connect(env.DATABASE_URL);
  ready ??= sql.query(CREATE_TABLE).catch(error => { ready = undefined; throw error; });
  await ready;
  const seconds = Math.floor(now / 1000);
  const window = Math.floor(seconds / DAY);
  const forwarded = headers['x-vercel-forwarded-for'] ?? headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' && isIP(forwarded) ? forwarded : 'unknown';
  const key = createHash('sha256').update(ip).digest('hex');
  for (const [bucket, limit] of [[`search:client:${key}`, 30], ['search:global', 300]]) {
    if (!(await sql.query(INCREMENT, [bucket, window, limit])).length) return DAY - seconds % DAY;
  }
  return null;
}
