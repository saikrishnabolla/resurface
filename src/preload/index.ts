import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type { Api } from '../shared/types'

const listen =
  (channel: string) =>
  (cb: (payload: any) => void): (() => void) => {
    const fn = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  }

const api: Api = {
  listChannels: () => ipcRenderer.invoke('channels:list'),
  getVideos: (channelId) => ipcRenderer.invoke('videos:get', channelId),
  getTranscript: (videoId) => ipcRenderer.invoke('transcript:get', videoId),
  getProgress: (channelId) => ipcRenderer.invoke('progress:get', channelId),
  importChannel: (url) => ipcRenderer.invoke('channel:import', url),
  retryFailed: (channelId) => ipcRenderer.invoke('channel:retry', channelId),
  prioritize: (videoId) => ipcRenderer.invoke('video:prioritize', videoId),
  getMetrics: (channelId) => ipcRenderer.invoke('metrics:get', channelId),
  getTregUsage: (force) => ipcRenderer.invoke('treg:usage', !!force),
  deleteChannel: (channelId) => ipcRenderer.invoke('channel:delete', channelId),
  search: (channelId, query, type) => ipcRenderer.invoke('search', channelId, query, type),
  openYouTube: (videoId, seconds) => ipcRenderer.invoke('open-youtube', videoId, seconds),
  copyText: (text) => ipcRenderer.invoke('copy', text),
  exportTranscript: (videoId) => ipcRenderer.invoke('transcript:export', videoId),
  onVideoUpdate: listen('video-update'),
  onCatalog: listen('catalog'),
  onProgress: listen('progress'),
  onImportState: listen('import-state')
}

contextBridge.exposeInMainWorld('api', api)
