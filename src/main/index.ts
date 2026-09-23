import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { createReadStream, existsSync, statSync, writeFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import { Readable } from 'stream'
import type {
  AppSettings,
  CaptureSource,
  Chapter,
  ExportMp4Options,
  HotkeyAction,
  MediaCapabilities,
  ProgressEvent,
  ScormExportOptions,
  YouTubeUploadOptions
} from '@shared/types'
import { chaptersToYouTubeText } from '@shared/types'
import { getSettings, saveSettings } from './settings'
import {
  closeRawStream,
  createProject,
  deleteProject,
  listProjects,
  loadProject,
  openRawStream,
  projectDir,
  saveProject,
  writeRawChunk
} from './projects'
import { exportMp4, exportSegments, fixRaw, makeThumbnail, probeDuration } from './ffmpeg'
import { exportHtml } from './html-export'
import { exportScorm } from './scorm-export'
import { youtubeSignIn, youtubeSignOut, youtubeStatus, youtubeUpload } from './youtube'

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

let win: BrowserWindow | null = null
let normalBounds: Electron.Rectangle | null = null
let selectedSource: Electron.DesktopCapturerSource | null = null
let lastSources: Electron.DesktopCapturerSource[] = []

/**
 * 能否直接擷取系統聲音：Windows 用 WASAPI loopback；
 * macOS 14.2 以上由 Chromium 走 CoreAudio Tap（需 Info.plist 的 NSAudioCaptureUsageDescription）。
 */
function systemAudioSupported(): boolean {
  if (process.platform === 'win32') return true
  if (process.platform !== 'darwin') return false
  const [major, minor] = process.getSystemVersion().split('.').map(Number)
  return major > 14 || (major === 14 && (minor ?? 0) >= 2)
}

/* ---------------- 視窗 ---------------- */
function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 420,
    minHeight: 64,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    title: 'MyCAM',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  win.on('closed', () => (win = null))
}

function send(channel: string, payload: unknown): void {
  win?.webContents.send(channel, payload)
}

function progress(ev: ProgressEvent): void {
  send('progress', ev)
}

/* ---------------- 錄影模式：縮成浮動控制列、不被錄進畫面、註冊全域快捷鍵 ---------------- */
function enterRecordingMode(): void {
  if (!win) return
  normalBounds = win.getBounds()
  const { workArea } = screen.getPrimaryDisplay()
  const w = 520
  const h = 64
  win.setMinimumSize(0, 0)
  win.setResizable(false)
  // 以「內容區」尺寸為準（視窗框與標題列另外加上），否則控制列會被標題列吃掉
  win.setContentSize(w, h)
  const [ww, wh] = win.getSize()
  win.setPosition(workArea.x + workArea.width - ww - 16, workArea.y + workArea.height - wh - 16)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setContentProtection(true)
  win.setSkipTaskbar(false)
  registerHotkeys()
}

function exitRecordingMode(): void {
  if (!win) return
  globalShortcut.unregisterAll()
  win.setContentProtection(false)
  win.setAlwaysOnTop(false)
  win.setResizable(true)
  win.setMinimumSize(420, 64)
  if (normalBounds) win.setBounds(normalBounds)
  win.focus()
}

function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const hk = getSettings().hotkeys
  const actions: HotkeyAction[] = ['marker', 'pause', 'stop']
  for (const a of actions) {
    const acc = hk[a]
    if (!acc) continue
    try {
      globalShortcut.register(acc, () => send('hotkey', a))
    } catch {
      /* 無效的快捷鍵字串 */
    }
  }
}

/* ---------------- media:// 協定：以 Range 支援串流本機影片 ---------------- */
function mediaHandler(req: Request): Response {
  const u = new URL(req.url)
  const file = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
  const abs = resolve(file)
  const root = resolve(getSettings().libraryDir)
  if (!abs.startsWith(root + sep) || !existsSync(abs)) return new Response('not found', { status: 404 })
  const size = statSync(abs).size
  const ext = abs.split('.').pop()?.toLowerCase()
  const types: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', jpg: 'image/jpeg' }
  const type = types[ext ?? ''] ?? 'application/octet-stream'
  const range = req.headers.get('range')
  let start = 0
  let end = size - 1
  let status = 200
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      if (m[1]) start = Number(m[1])
      if (m[2]) end = Number(m[2])
      else end = Math.min(size - 1, start + 8 * 1024 * 1024)
      status = 206
    }
  }
  const stream = createReadStream(abs, { start, end })
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1)
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status, headers })
}

/* ---------------- IPC ---------------- */
function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:openManual', () => {
    const file = app.isPackaged ? join(process.resourcesPath, 'manual.html') : join(app.getAppPath(), 'docs', 'manual.html')
    return shell.openPath(file)
  })
  ipcMain.handle('app:platform', () => process.platform)

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => saveSettings(patch))
  ipcMain.handle('settings:chooseLibraryDir', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], title: '選擇錄影儲存資料夾' })
    if (r.canceled || !r.filePaths[0]) return null
    return saveSettings({ libraryDir: r.filePaths[0] }).libraryDir
  })

  ipcMain.handle('media:requestPermissions', async () => {
    if (process.platform !== 'darwin') return { mic: true, camera: true, screen: true }
    const mic = await systemPreferences.askForMediaAccess('microphone')
    const camera = await systemPreferences.askForMediaAccess('camera')
    const screenStatus = systemPreferences.getMediaAccessStatus('screen')
    return { mic, camera, screen: screenStatus === 'granted' }
  })

  ipcMain.handle(
    'media:capabilities',
    (): MediaCapabilities => ({
      platform: process.platform,
      systemAudio: systemAudioSupported(),
      screenAccess: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted'
    })
  )
  ipcMain.handle('media:openScreenSettings', () => {
    if (process.platform !== 'darwin') return Promise.resolve()
    return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  })

  ipcMain.handle('sources:list', async (): Promise<CaptureSource[]> => {
    lastSources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false })
    return lastSources
      .filter((s) => !s.name.startsWith('MyCAM'))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL(), kind: s.id.startsWith('screen') ? 'screen' : 'window' }))
  })
  ipcMain.handle('capture:select', (_e, id: string) => {
    selectedSource = lastSources.find((s) => s.id === id) ?? null
    return Boolean(selectedSource)
  })

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:load', (_e, id: string) => loadProject(id))
  ipcMain.handle('projects:create', (_e, title: string) => createProject(title))
  ipcMain.handle('projects:save', (_e, p) => saveProject(p))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))

  ipcMain.handle('rec:start', (_e, id: string) => {
    openRawStream(id)
    enterRecordingMode()
  })
  ipcMain.handle('rec:chunk', (_e, id: string, buf: ArrayBuffer) => writeRawChunk(id, Buffer.from(buf)))
  ipcMain.handle('rec:cancel', async (_e, id: string) => {
    await closeRawStream(id)
    exitRecordingMode()
    deleteProject(id)
  })
  ipcMain.handle(
    'rec:finish',
    async (_e, id: string, info: { duration: number; chapters: Chapter[]; codec: string; width?: number; height?: number }) => {
      await closeRawStream(id)
      exitRecordingMode()
      const p = loadProject(id)
      p.chapters = info.chapters
      p.codec = info.codec
      p.width = info.width
      p.height = info.height
      p.duration = info.duration
      progress({ task: 'finalize', projectId: id, ratio: 0.2, message: '整理錄影檔…' })
      try {
        p.rawFile = await fixRaw(p.dir, p.rawFile)
      } catch (e) {
        console.error('fixRaw failed', e)
      }
      try {
        const probe = await probeDuration(join(p.dir, p.rawFile))
        if (probe.duration > 0) p.duration = probe.duration
        if (probe.width) p.width = probe.width
        if (probe.height) p.height = probe.height
      } catch (e) {
        console.error('probe failed', e)
      }
      progress({ task: 'finalize', projectId: id, ratio: 0.8, message: '產生縮圖…' })
      try {
        await makeThumbnail(p, Math.min(2, p.duration / 2))
      } catch (e) {
        console.error('thumbnail failed', e)
      }
      progress({ task: 'finalize', projectId: id, ratio: 1, message: '完成' })
      return saveProject(p)
    }
  )
  ipcMain.handle('rec:cleanupWindow', () => exitRecordingMode())

  ipcMain.handle('export:mp4', async (_e, id: string, opts: ExportMp4Options) => {
    const p = loadProject(id)
    const out = await exportMp4(p, { crf: opts?.crf, onProgress: (r) => progress({ task: 'mp4', projectId: id, ratio: r }) })
    p.outputFile = 'output.mp4'
    saveProject(p)
    progress({ task: 'mp4', projectId: id, ratio: 1, message: '完成' })
    return out
  })
  ipcMain.handle('export:segments', async (_e, id: string) => {
    const p = loadProject(id)
    const files = await exportSegments(p, {
      outDir: join(p.dir, 'segments'),
      naming: 'titled',
      onProgress: (r, m) => progress({ task: 'segments', projectId: id, ratio: r, message: m })
    })
    return files.map((f) => f.file)
  })
  ipcMain.handle('export:scorm', async (_e, id: string, opts: ScormExportOptions) => {
    const p = loadProject(id)
    return exportScorm(p, opts, (r, m) => progress({ task: 'scorm', projectId: id, ratio: r, message: m }))
  })
  ipcMain.handle('export:html', async (_e, id: string) => {
    const p = loadProject(id)
    progress({ task: 'html', projectId: id, ratio: 0.1, message: '產生段落縮圖…' })
    const out = await exportHtml(p)
    progress({ task: 'html', projectId: id, ratio: 1, message: '完成' })
    return out
  })
  ipcMain.handle('export:chaptersText', (_e, id: string) => {
    const p = loadProject(id)
    const out = join(p.dir, 'chapters.txt')
    writeFileSync(out, `${p.title}\n\n${chaptersToYouTubeText(p.chapters)}\n${p.notes ? `\n${p.notes}\n` : ''}`, 'utf8')
    return out
  })

  ipcMain.handle('yt:status', () => youtubeStatus())
  ipcMain.handle('yt:signIn', () => youtubeSignIn())
  ipcMain.handle('yt:signOut', () => youtubeSignOut())
  ipcMain.handle('yt:upload', async (_e, id: string, opts: YouTubeUploadOptions) => {
    const p = loadProject(id)
    const file = join(p.dir, p.outputFile ?? 'output.mp4')
    const r = await youtubeUpload(file, opts, (ratio) => progress({ task: 'youtube', projectId: id, ratio }))
    p.youtube = { ...r, uploadedAt: new Date().toISOString() }
    saveProject(p)
    progress({ task: 'youtube', projectId: id, ratio: 1, message: '完成' })
    return r
  })

  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('shell:openExternal', (_e, u: string) => {
    if (/^https?:\/\//.test(u)) return shell.openExternal(u)
    return Promise.resolve()
  })
  ipcMain.handle('projects:dir', (_e, id: string) => projectDir(id))
}

/* ---------------- App 生命週期 ---------------- */
app.whenReady().then(() => {
  protocol.handle('media', (req) => mediaHandler(req))

  // 讓 renderer 呼叫 getDisplayMedia 時，直接使用使用者在 UI 中挑選的來源
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!selectedSource) {
        callback({})
        return
      }
      // renderer 只在平台支援時才會要求 audio；這裡再確認一次
      if (request.audioRequested && systemAudioSupported()) callback({ video: selectedSource, audio: 'loopback' })
      else callback({ video: selectedSource })
    },
    { useSystemPicker: false }
  )

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'display-capture', 'mediaKeySystem'].includes(permission))
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
