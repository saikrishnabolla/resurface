import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import * as db from './db'
import type { Importer } from './importer'
import type { TregUsage } from '@shared/types'

/**
 * treg usage: requests and spend from this app's own fetch log, plus the team
 * balance from the installed treg CLI (`treg --json balance`), which uses the
 * same sign-in. The balance is cached briefly so the UI can poll cheaply.
 */
const BALANCE_TTL_MS = 15_000
let cached: { at: number; micro: number | null; error: string | null } | null = null
let inflight: Promise<void> | null = null

function tregBinary(): string | null {
  const candidates = [join(homedir(), '.local', 'bin', 'treg'), '/opt/homebrew/bin/treg', '/usr/local/bin/treg']
  return candidates.find((p) => existsSync(p)) ?? null
}

function refreshBalance(): Promise<void> {
  if (inflight) return inflight
  inflight = new Promise<void>((resolve) => {
    const bin = tregBinary()
    if (!bin) {
      cached = { at: Date.now(), micro: null, error: 'treg CLI not found' }
      return resolve()
    }
    execFile(bin, ['--json', 'balance'], { timeout: 15_000, env: { ...process.env, TREG_TELEMETRY: '0' } }, (err, stdout) => {
      try {
        const j = JSON.parse(stdout)
        if (typeof j.balance_micro !== 'number') throw new Error('no balance in response')
        cached = { at: Date.now(), micro: j.balance_micro, error: null }
      } catch (e: any) {
        cached = { at: Date.now(), micro: cached?.micro ?? null, error: err?.message ?? e?.message ?? 'unreadable' }
      }
      resolve()
    })
  }).finally(() => {
    inflight = null
  })
  return inflight
}

export async function tregUsage(importer: Importer, force: boolean): Promise<TregUsage> {
  if (force || !cached || Date.now() - cached.at > BALANCE_TTL_MS) await refreshBalance()
  const all = db.tregSpend(0)
  const session = db.tregSpend(importer.sessionStart)
  return {
    calls: all.calls,
    billedCalls: all.billedCalls,
    spentMicro: all.spentMicro,
    sessionCalls: session.calls,
    sessionSpentMicro: session.spentMicro,
    balanceMicro: cached?.micro ?? null,
    balanceError: cached?.error ?? null,
    disabled: importer.providerPause('treg')
  }
}
