import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  AppSettings,
  CaptureSource,
  Chapter,
  ExportMp4Options,
  HotkeyAction,
  MediaCapabilities,
  ProgressEvent,
  Project,
  ScormExportOptions,
  YouTubeStatus,
  YouTubeUploadOptions
} from '@shared/types'

const inv = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const h = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

export const api = {
  version: () => inv<string>('app:version'),
  openManual: () => inv<string>('app:openManual'),
  platform: () => inv<NodeJS.Platform>('app:platform'),

  getSettings: () => inv<AppSettings>('settings:get'),
  saveSettings: (patch: Partial<AppSettings>) => inv<AppSettings>('settings:save', patch),
  chooseLibraryDir: () => inv<string | null>('settings:chooseLibraryDir'),
  requestMediaPermissions: () => inv<{ mic: boolean; camera: boolean; screen: boolean }>('media:requestPermissions'),

  mediaCapabilities: () => inv<MediaCapabilities>('media:capabilities'),
  openScreenSettings: () => inv<void>('media:openScreenSettings'),

  listSources: () => inv<CaptureSource[]>('sources:list'),
  selectSource: (id: string) => inv<boolean>('capture:select', id),

  listProjects: () => inv<Project[]>('projects:list'),
  loadProject: (id: string) => inv<Project>('projects:load', id),
  createProject: (title: string) => inv<Project>('projects:create', title),
  saveProject: (p: Project) => inv<Project>('projects:save', p),
  deleteProject: (id: string) => inv<void>('projects:delete', id),

  recStart: (id: string) => inv<void>('rec:start', id),
  recChunk: (id: string, buf: ArrayBuffer) => inv<void>('rec:chunk', id, buf),
  recCancel: (id: string) => inv<void>('rec:cancel', id),
  recFinish: (id: string, info: { duration: number; chapters: Chapter[]; codec: string; width?: number; height?: number }) =>
    inv<Project>('rec:finish', id, info),
  recCleanupWindow: () => inv<void>('rec:cleanupWindow'),

  exportMp4: (id: string, opts: ExportMp4Options = {}) => inv<string>('export:mp4', id, opts),
  exportSegments: (id: string) => inv<string[]>('export:segments', id),
  exportHtml: (id: string) => inv<string>('export:html', id),
  exportChaptersText: (id: string) => inv<string>('export:chaptersText', id),
  exportScorm: (id: string, opts: ScormExportOptions) => inv<string>('export:scorm', id, opts),

  ytStatus: () => inv<YouTubeStatus>('yt:status'),
  ytSignIn: () => inv<YouTubeStatus>('yt:signIn'),
  ytSignOut: () => inv<void>('yt:signOut'),
  ytUpload: (id: string, opts: YouTubeUploadOptions) => inv<{ videoId: string; url: string }>('yt:upload', id, opts),

  openPath: (p: string) => inv<string>('shell:openPath', p),
  showInFolder: (p: string) => inv<void>('shell:showInFolder', p),
  openExternal: (u: string) => inv<void>('shell:openExternal', u),

  onHotkey: (cb: (action: HotkeyAction) => void) => on<HotkeyAction>('hotkey', cb),
  onProgress: (cb: (ev: ProgressEvent) => void) => on<ProgressEvent>('progress', cb),

  /** 將本機檔案路徑轉為可在 renderer 播放的 media:// 網址 */
  mediaUrl: (absPath: string) => `media://local/${encodeURIComponent(absPath.replace(/\\/g, '/'))}`
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
