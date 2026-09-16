/** 一個段落（章節）節點，time 為秒 */
export interface Chapter {
  id: string
  time: number
  title: string
}

/** 一次錄影專案，儲存於資料庫目錄下的 project.json */
export interface Project {
  id: string
  title: string
  createdAt: string
  /** 秒 */
  duration: number
  rawFile: string
  outputFile?: string
  codec?: string
  width?: number
  height?: number
  chapters: Chapter[]
  notes: string
  youtube?: { videoId: string; url: string; uploadedAt: string }
  /** 執行期填入：專案資料夾絕對路徑 */
  dir: string
}

export interface CaptureSource {
  id: string
  name: string
  thumbnail: string
  kind: 'screen' | 'window'
}

export type WebcamPosition = 'br' | 'bl' | 'tr' | 'tl'

export interface RecordingSettings {
  sourceId: string
  sourceName: string
  mic: boolean
  micDeviceId: string
  systemAudio: boolean
  webcam: boolean
  webcamDeviceId: string
  webcamPosition: WebcamPosition
  /** 攝影機寬度佔畫面寬度比例 0.1~0.4 */
  webcamScale: number
  fps: number
  /** 影像位元率 (bps) */
  videoBitrate: number
}

export interface Hotkeys {
  marker: string
  pause: string
  stop: string
}

export interface AppSettings {
  libraryDir: string
  youtube: { clientId: string; clientSecret: string }
  hotkeys: Hotkeys
  recording: Omit<RecordingSettings, 'sourceId' | 'sourceName'>
}

export type HotkeyAction = keyof Hotkeys

export interface ProgressEvent {
  task: string
  projectId: string
  /** 0~1 */
  ratio: number
  message?: string
}

export interface ExportMp4Options {
  /** 重新編碼品質 CRF，數字越小品質越高，18~28 */
  crf?: number
}

export interface ScormExportOptions {
  /** original：保留解析度；lms：720p 精簡版 */
  quality: 'original' | 'lms'
}

export interface YouTubeUploadOptions {
  title: string
  description: string
  privacy: 'private' | 'unlisted' | 'public'
  tags?: string[]
}

export interface YouTubeStatus {
  configured: boolean
  signedIn: boolean
  channelTitle?: string
}

export const DEFAULT_SETTINGS: Omit<AppSettings, 'libraryDir'> = {
  youtube: { clientId: '', clientSecret: '' },
  hotkeys: { marker: 'F8', pause: 'F9', stop: 'F10' },
  recording: {
    mic: true,
    micDeviceId: '',
    systemAudio: true,
    webcam: false,
    webcamDeviceId: '',
    webcamPosition: 'br',
    webcamScale: 0.2,
    fps: 30,
    videoBitrate: 6_000_000
  }
}

export function formatTime(sec: number, withHours = false): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  if (h > 0 || withHours) return `${String(h).padStart(2, '0')}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** 產生 YouTube 說明欄可自動辨識為章節的時間軸文字 */
export function chaptersToYouTubeText(chapters: Chapter[]): string {
  const sorted = [...chapters].sort((a, b) => a.time - b.time)
  const lines: string[] = []
  if (sorted.length === 0 || sorted[0].time > 0) lines.push(`00:00 開始`)
  for (const c of sorted) {
    if (c.time === 0 && lines.length === 1 && lines[0].startsWith('00:00')) lines[0] = `00:00 ${c.title}`
    else lines.push(`${formatTime(c.time)} ${c.title}`)
  }
  return lines.join('\n')
}
