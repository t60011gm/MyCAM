import type { Chapter, RecordingSettings } from '@shared/types'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface RecordingResult {
  duration: number
  chapters: Chapter[]
  codec: string
  width?: number
  height?: number
}

const CODEC_CANDIDATES = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=avc1,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
]

export function pickMimeType(): string {
  for (const c of CODEC_CANDIDATES) if (MediaRecorder.isTypeSupported(c)) return c
  return ''
}

let seq = 0
export const newId = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * 錄影核心：螢幕 + 麥克風 + 系統聲音（Windows）+ 可選攝影機子母畫面，
 * 以 MediaRecorder 產生 WebM 片段串流寫入磁碟。
 */
export class Recorder {
  state: RecorderState = 'idle'
  chapters: Chapter[] = []
  codec = ''
  width = 0
  height = 0
  error = ''

  private rec: MediaRecorder | null = null
  private streams: MediaStream[] = []
  private audioCtx: AudioContext | null = null
  private drawTimer: number | null = null
  private startedAt = 0
  private pausedAccum = 0
  private pausedAt = 0
  private writeChain: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }
  private setState(s: RecorderState): void {
    this.state = s
    this.emit()
  }

  /** 已錄製秒數（不含暫停時間） */
  elapsed(): number {
    if (this.state === 'idle' || this.state === 'starting') return 0
    const now = this.state === 'paused' ? this.pausedAt : performance.now()
    return (now - this.startedAt - this.pausedAccum) / 1000
  }

  async start(s: RecordingSettings, onChunk: (buf: ArrayBuffer) => Promise<void>): Promise<void> {
    if (this.state !== 'idle') throw new Error('錄影已在進行中')
    this.setState('starting')
    this.chapters = []
    this.error = ''
    this.pausedAccum = 0
    try {
      // 1. 螢幕（來源已由主程序 setDisplayMediaRequestHandler 決定）
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: s.fps, max: s.fps } },
        audio: s.systemAudio
      })
      this.streams.push(screen)
      const vTrack = screen.getVideoTracks()[0]
      const vs = vTrack.getSettings()
      this.width = vs.width ?? 0
      this.height = vs.height ?? 0
      vTrack.addEventListener('ended', () => {
        if (this.state === 'recording' || this.state === 'paused') void this.stop()
      })

      // 2. 麥克風
      let mic: MediaStream | null = null
      if (s.mic) {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: s.micDeviceId ? { exact: s.micDeviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        })
        this.streams.push(mic)
      }

      // 3. 攝影機（子母畫面）
      let cam: MediaStream | null = null
      if (s.webcam) {
        cam = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: s.webcamDeviceId ? { exact: s.webcamDeviceId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } }
        })
        this.streams.push(cam)
      }

      // 4. 合成影像
      let videoTrack: MediaStreamTrack = vTrack
      if (cam) videoTrack = this.composite(screen, cam, s)

      // 5. 混音
      const audioTracks = this.mixAudio([...screen.getAudioTracks(), ...(mic ? mic.getAudioTracks() : [])])

      const out = new MediaStream([videoTrack, ...audioTracks])
      this.codec = pickMimeType()
      this.rec = new MediaRecorder(out, {
        mimeType: this.codec || undefined,
        videoBitsPerSecond: s.videoBitrate,
        audioBitsPerSecond: 160_000
      })
      this.rec.ondataavailable = (ev) => {
        if (ev.data.size === 0) return
        this.writeChain = this.writeChain.then(() => ev.data.arrayBuffer()).then(onChunk).catch((e) => {
          this.error = String(e)
          this.emit()
        })
      }
      this.rec.onerror = (ev) => {
        this.error = String((ev as ErrorEvent).error ?? ev)
        this.emit()
      }
      this.rec.start(1000)
      this.startedAt = performance.now()
      this.setState('recording')
    } catch (e) {
      this.cleanup()
      this.setState('idle')
      throw e
    }
  }

  private composite(screen: MediaStream, cam: MediaStream, s: RecordingSettings): MediaStreamTrack {
    const sv = document.createElement('video')
    sv.srcObject = screen
    sv.muted = true
    void sv.play()
    const cv = document.createElement('video')
    cv.srcObject = cam
    cv.muted = true
    void cv.play()
    const canvas = document.createElement('canvas')
    canvas.width = this.width || 1920
    canvas.height = this.height || 1080
    const ctx = canvas.getContext('2d', { alpha: false })!
    const draw = (): void => {
      if (sv.videoWidth && (canvas.width !== sv.videoWidth || canvas.height !== sv.videoHeight)) {
        canvas.width = sv.videoWidth
        canvas.height = sv.videoHeight
        this.width = canvas.width
        this.height = canvas.height
      }
      ctx.drawImage(sv, 0, 0, canvas.width, canvas.height)
      if (cv.videoWidth) {
        const w = Math.round(canvas.width * s.webcamScale)
        const h = Math.round((w * cv.videoHeight) / cv.videoWidth)
        const pad = Math.round(canvas.width * 0.012)
        const x = s.webcamPosition.endsWith('l') ? pad : canvas.width - w - pad
        const y = s.webcamPosition.startsWith('t') ? pad : canvas.height - h - pad
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,.6)'
        ctx.shadowBlur = 16
        ctx.fillStyle = '#000'
        ctx.fillRect(x, y, w, h)
        ctx.restore()
        ctx.drawImage(cv, x, y, w, h)
        ctx.strokeStyle = 'rgba(255,255,255,.7)'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
      }
    }
    this.drawTimer = window.setInterval(draw, 1000 / s.fps)
    const stream = canvas.captureStream(s.fps)
    this.streams.push(stream)
    return stream.getVideoTracks()[0]
  }

  private mixAudio(tracks: MediaStreamTrack[]): MediaStreamTrack[] {
    if (tracks.length <= 1) return tracks
    this.audioCtx = new AudioContext()
    const dest = this.audioCtx.createMediaStreamDestination()
    for (const t of tracks) {
      const src = this.audioCtx.createMediaStreamSource(new MediaStream([t]))
      src.connect(dest)
    }
    return dest.stream.getAudioTracks()
  }

  pause(): void {
    if (this.state !== 'recording' || !this.rec) return
    this.rec.pause()
    this.pausedAt = performance.now()
    this.setState('paused')
  }

  resume(): void {
    if (this.state !== 'paused' || !this.rec) return
    this.pausedAccum += performance.now() - this.pausedAt
    this.rec.resume()
    this.setState('recording')
  }

  togglePause(): void {
    if (this.state === 'recording') this.pause()
    else if (this.state === 'paused') this.resume()
  }

  addChapter(title?: string): Chapter | null {
    if (this.state !== 'recording' && this.state !== 'paused') return null
    const time = Math.round(this.elapsed() * 10) / 10
    const c: Chapter = { id: newId(), time, title: title?.trim() || `段落 ${this.chapters.length + 1}` }
    this.chapters.push(c)
    this.emit()
    return c
  }

  async stop(): Promise<RecordingResult> {
    if (this.state !== 'recording' && this.state !== 'paused') throw new Error('目前沒有錄影')
    if (this.state === 'paused') this.resume()
    const duration = this.elapsed()
    this.setState('stopping')
    const rec = this.rec!
    await new Promise<void>((res) => {
      rec.addEventListener('stop', () => res(), { once: true })
      rec.stop()
    })
    await this.writeChain
    this.cleanup()
    const result: RecordingResult = { duration, chapters: this.chapters, codec: this.codec, width: this.width, height: this.height }
    this.setState('idle')
    return result
  }

  private cleanup(): void {
    if (this.drawTimer) window.clearInterval(this.drawTimer)
    this.drawTimer = null
    for (const s of this.streams) for (const t of s.getTracks()) t.stop()
    this.streams = []
    void this.audioCtx?.close()
    this.audioCtx = null
    this.rec = null
  }
}

export const recorder = new Recorder()
