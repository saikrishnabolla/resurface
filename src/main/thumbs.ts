import { app, net, protocol } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

/**
 * TikTok/Instagram image URLs are signed and expire within hours, so their
 * thumbnails and avatars are downloaded once and served from disk via
 * resurface-thumb://t/<name>.
 */
const SCHEME = 'resurface-thumb'
const dir = () => join(app.getPath('userData'), 'thumbs')
const SAFE = /^[A-Za-z0-9_-]{1,80}$/

export function registerThumbScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }])
}

export function handleThumbProtocol(): void {
  protocol.handle(SCHEME, (req) => {
    // resurface-thumb://t/<name>: the name lives in the path (hostnames get lowercased).
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    if (!SAFE.test(name)) return new Response('bad name', { status: 400 })
    const file = join(dir(), `${name}.jpg`)
    if (!existsSync(file)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
}

/** Download an image and return its local resurface-thumb URL, or null. */
export async function cacheThumb(name: string, url: string): Promise<string | null> {
  if (!SAFE.test(name) || !/^https:\/\//.test(url)) return null
  const file = join(dir(), `${name}.jpg`)
  if (existsSync(file)) return `${SCHEME}://t/${name}`
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20_000)
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }).finally(() => clearTimeout(t))
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 5_000_000) return null
    mkdirSync(dir(), { recursive: true })
    writeFileSync(file, buf)
    return `${SCHEME}://t/${name}`
  } catch {
    return null
  }
}

/** Cache many thumbnails with bounded concurrency. */
export async function cacheMany(items: { name: string; url: string }[], onDone: (name: string, local: string) => void): Promise<void> {
  let i = 0
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++]
      const local = await cacheThumb(it.name, it.url)
      if (local) onDone(it.name, local)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
}
