import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import * as db from './db'
import { Importer } from './importer'
import { worker } from './worker'
import { tregUsage } from './usage'
import { handleThumbProtocol, registerThumbScheme } from './thumbs'

registerThumbScheme() // must run before the app is ready
import type { VideoType } from '@shared/types'

let win: BrowserWindow | null = null
const send = (ch: string, payload: unknown) => win?.webContents.send(ch, payload)

const importer = new Importer({
  video: (v) => send('video-update', v),
  catalog: (id) => send('catalog', id),
  progress: (p) => send('progress', p),
  importState: (s) => send('import-state', s)
})

// YouTube ids (11 chars), tt_<TikTok id>, ig_<Instagram shortcode>
const VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/
const vid = (v: unknown) => str(v, 64)
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')

function fmtTime(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function registerIpc(): void {
  ipcMain.handle('channels:list', () => db.listChannels())
  ipcMain.handle('videos:get', (_e, channelId) => db.getVideos(str(channelId, 64)))
  ipcMain.handle('transcript:get', (_e, videoId) => db.getSegments(vid(videoId)))
  ipcMain.handle('progress:get', (_e, channelId) => importer.progress(str(channelId, 64)))
  ipcMain.handle('channel:import', (_e, url) => importer.importChannel(str(url, 500)))
  ipcMain.handle('treg:usage', (_e, force) => tregUsage(importer, !!force))
  ipcMain.handle('channel:retry', (_e, channelId) => importer.enqueueChannel(str(channelId, 64), true))
  ipcMain.handle('video:prioritize', (_e, videoId) => importer.prioritize(vid(videoId)))
  ipcMain.handle('metrics:get', (_e, channelId) => importer.metrics(str(channelId, 64)))
  ipcMain.handle('channel:delete', (_e, channelId) => db.deleteChannel(str(channelId, 64)))
  ipcMain.handle('search', (_e, channelId, query, type) => {
    const t: 'all' | VideoType = type === 'short' || type === 'long' ? type : 'all'
    return db.search(str(channelId, 64), str(query, 500), t)
  })
  ipcMain.handle('open-youtube', (_e, videoId, seconds) => {
    const id = vid(videoId)
    if (!VIDEO_ID.test(id)) return
    const v = db.getVideo(id)
    if (v && v.platform !== 'youtube') {
      // TikTok / Instagram links can't jump to a timestamp: open the post itself.
      if (/^https:\/\/(www\.)?(tiktok|instagram)\.com\//.test(v.url)) return shell.openExternal(v.url)
      return
    }
    const t = Math.max(0, Math.floor(Number(seconds) || 0))
    return shell.openExternal(`https://www.youtube.com/watch?v=${id}${t ? `&t=${t}s` : ''}`)
  })
  ipcMain.handle('copy', (_e, text) => clipboard.writeText(str(text, 5_000_000)))
  ipcMain.handle('transcript:export', async (_e, videoId) => {
    const v = db.getVideo(vid(videoId))
    if (!v || !win) return false
    const segs = db.getSegments(v.id)
    const safe = v.title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${safe}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return false
    const link = v.platform === 'youtube' ? `https://www.youtube.com/watch?v=${v.id}` : v.url
    const header = `${v.title}\n${link}\n${v.uploadDate ?? ''}\n\n`
    const body = segs.map((s) => `[${fmtTime(s.start)}] ${s.text.replace(/\s+/g, ' ').trim()}`).join('\n')
    writeFileSync(filePath, header + body + '\n', 'utf8')
    return true
  })
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0c0e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  // Never navigate the app window or open new windows; external links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?youtube\.com\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Optional override (used for testing with a throwaway database).
if (process.env.RESURFACE_USER_DATA) app.setPath('userData', process.env.RESURFACE_USER_DATA)

// Headless benchmark: electron . --bench <channel url>  (prints metrics JSON, then quits)
const benchIdx = process.argv.indexOf('--bench')
if (benchIdx > 0) {
  app.whenReady().then(async () => {
    db.openDb()
    worker.warm()
    const url = process.argv[benchIdx + 1]
    const r = await importer.importChannel(url)
    if (!r.ok || !r.channelId) {
      console.log(JSON.stringify({ error: r.error }))
      app.exit(1)
      return
    }
    while (importer.isActive(r.channelId)) await new Promise((res) => setTimeout(res, 250))
    console.log('BENCH ' + JSON.stringify({ progress: importer.progress(r.channelId), ...importer.metrics(r.channelId) }))
    worker.stop()
    app.exit(0)
  })
} else app.whenReady().then(() => {
  db.openDb()
  handleThumbProtocol()
  worker.warm() // pay Python/yt-dlp import cost before the first import
  registerIpc()
  createWindow()
  importer.resumeAll() // continue any interrupted import
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => worker.stop())
