import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import readline from 'readline'

export type ErrorKind = 'invalid_url' | 'not_found' | 'unavailable' | 'rate_limited' | 'temporary'

export class WorkerError extends Error {
  constructor(
    public kind: ErrorKind,
    message: string
  ) {
    super(message)
  }
}

interface Pending {
  resolve: (v: any) => void
  reject: (e: WorkerError) => void
  timer: NodeJS.Timeout
}

/** Manages the bundled Python extraction process (JSON lines over stdio). */
class ExtractorWorker {
  private proc: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()

  private command(): { cmd: string; args: string[] } {
    if (app.isPackaged) {
      return { cmd: join(process.resourcesPath, 'extractor', 'extractor'), args: [] }
    }
    const root = app.getAppPath()
    const py = join(root, 'python', '.venv', 'bin', 'python')
    return { cmd: existsSync(py) ? py : 'python3', args: [join(root, 'python', 'extractor.py')] }
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.proc) return this.proc
    const { cmd, args } = this.command()
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      // GUI apps get a minimal PATH; let yt-dlp find an optional JS runtime.
      PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin`
    }
    const proc = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new WorkerError(msg.error?.kind ?? 'temporary', msg.error?.message ?? 'Unknown error'))
    })
    proc.stderr.on('data', (d) => process.stderr.write('[extractor] ' + d))
    const fail = (why: string) => {
      if (this.proc !== proc) return
      this.proc = null
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new WorkerError('temporary', why))
      }
      this.pending.clear()
    }
    proc.on('exit', (code) => fail(`Extractor exited (code ${code})`))
    proc.on('error', (e) => fail(`Could not start extractor: ${e.message}`))
    return proc
  }

  request<T>(cmd: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const proc = this.start()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new WorkerError('temporary', 'Request timed out'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      proc.stdin.write(JSON.stringify({ id, cmd, ...params }) + '\n')
    })
  }

  /** Start the process early so library imports are done before first use. */
  warm(): void {
    this.start()
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
  }
}

export const worker = new ExtractorWorker()
