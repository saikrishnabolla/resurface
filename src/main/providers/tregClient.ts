import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Minimal treg.to client shared by every treg-backed tool. Reuses the treg
 * CLI's sign-in (~/.treg/config.json, or TREG_TOKEN); main process only.
 */
export interface TregConfig {
  token: string | null
  baseUrl: string
  org: string | null
  identity: boolean
}

export function readConfig(): TregConfig {
  const envToken = process.env.TREG_TOKEN
  let file: any = {}
  try {
    const p = process.env.TREG_CONFIG
      ? process.env.TREG_CONFIG.replace(/^~(?=\/)/, homedir())
      : join(homedir(), '.treg', 'config.json')
    file = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    file = {}
  }
  return {
    token: envToken || file.token || null,
    baseUrl: (file.base_url || 'https://treg.to').replace(/\/$/, ''),
    org: file.active_org || null,
    identity: !envToken && !!file.identity
  }
}

export function retryAfterMs(res: Response, body: any): number | null {
  const s = Number(body?.retry_after_s)
  if (Number.isFinite(s) && s >= 0) return s * 1000
  const h = res.headers.get('retry-after')
  if (!h) return null
  const n = Number(h)
  if (Number.isFinite(n)) return n * 1000
  const at = Date.parse(h)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null
}

export type TregFailureKind = 'rate_limited' | 'disabled' | 'unavailable' | 'temporary'

export interface TregResult {
  ok: boolean
  status: number
  body: any
  costMicro: number
  callId: string | null
  /** Set when !ok: how the caller should treat the failure. */
  failure: { kind: TregFailureKind; message: string; retryAfterMs: number | null } | null
}

const RATE_CODES = ['share_busy', 'provider_rate_limited', 'org_concurrency_limit', 'org_rate_limit', 'upstream_busy', 'provider_capacity_unavailable']
const DISABLE_CODES = ['insufficient_balance', 'funds_required', 'own_key_required', 'member_spend_cap_reached', 'trial_allowance_reached', 'not_authenticated', 'capability_pinned']

/** GET a treg catalog tool. Never throws. */
export async function tregCall(
  tool: string,
  query: Record<string, string | undefined>,
  opts: { idempotencyKey?: string; timeoutMs?: number } = {}
): Promise<TregResult> {
  const cfg = readConfig()
  if (!cfg.token)
    return { ok: false, status: 0, body: null, costMicro: 0, callId: null, failure: { kind: 'disabled', message: 'treg is not signed in (run `treg login`).', retryAfterMs: null } }
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&')
  const headers: Record<string, string> = { 'X-Treg-Token': cfg.token }
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey
  if (cfg.identity && cfg.org) headers['X-Treg-Org'] = cfg.org

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45_000)
  let res: Response
  let body: any = null
  try {
    res = await fetch(`${cfg.baseUrl}/call/${tool}${qs ? `?${qs}` : ''}`, { headers, signal: ctrl.signal })
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
  } catch (e: any) {
    return {
      ok: false, status: 0, body: null, costMicro: 0, callId: null,
      failure: { kind: 'temporary', message: e?.name === 'AbortError' ? 'treg request timed out' : `Network problem: ${e?.message ?? e}`, retryAfterMs: null }
    }
  } finally {
    clearTimeout(timer)
  }
  const costMicro = Number(res.headers.get('x-treg-cost-micro') ?? 0) || 0
  const callId = res.headers.get('x-treg-call-id')
  if (res.ok) return { ok: true, status: res.status, body, costMicro, callId, failure: null }

  const fromTreg = res.headers.get('x-treg-error') === '1'
  const code: string = body?.error ?? body?.code ?? body?.detail?.error ?? ''
  const msg: string =
    body?.message ?? (typeof body?.detail === 'string' ? body.detail : body?.detail?.message) ?? `HTTP ${res.status}`
  let failure: TregResult['failure']
  if (res.status === 409) failure = { kind: 'rate_limited', message: 'Previous request still running', retryAfterMs: retryAfterMs(res, body) ?? 3000 }
  else if ((fromTreg || code) && RATE_CODES.includes(code)) failure = { kind: 'rate_limited', message: `treg: ${code}`, retryAfterMs: retryAfterMs(res, body) }
  else if (((fromTreg || code) && DISABLE_CODES.includes(code)) || res.status === 401) failure = { kind: 'disabled', message: `treg: ${code || msg}`, retryAfterMs: null }
  else if (res.status === 429) failure = { kind: 'rate_limited', message: 'ScrapeCreators rate limit', retryAfterMs: retryAfterMs(res, body) }
  else if (res.status === 404) failure = { kind: 'unavailable', message: 'Not found (private or removed).', retryAfterMs: null }
  else failure = { kind: 'temporary', message: `treg/ScrapeCreators HTTP ${res.status}: ${String(msg).slice(0, 200)}`, retryAfterMs: null }
  return { ok: false, status: res.status, body, costMicro, callId, failure }
}
