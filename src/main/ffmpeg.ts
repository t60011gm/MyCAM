import { spawn } from 'child_process'
import { app } from 'electron'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Chapter, Project } from '@shared/types'

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let p: string = require('ffmpeg-static')
  if (app.isPackaged) p = p.replace('app.asar', 'app.asar.unpacked')
  return p
}

export interface RunOptions {
  /** 總長度（秒），用於計算進度 */
  duration?: number
  onProgress?: (ratio: number) => void
}

export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-nostdin', '-y', ...args]
    if (opts.duration) full.unshift('-progress', 'pipe:1', '-loglevel', 'error')
    const child = spawn(ffmpegPath(), full, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.stdout.on('data', (d) => {
      if (!opts.duration || !opts.onProgress) return
      const m = /out_time_(?:us|ms)=(\d+)/g
      let last: RegExpExecArray | null = null
      let r: RegExpExecArray | null
      const text = d.toString()
      while ((r = m.exec(text))) last = r
      if (last) opts.onProgress(Math.min(1, Number(last[1]) / 1e6 / opts.duration))
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 失敗 (code ${code})\n${stderr.slice(-2000)}`))
    })
  })
}

/** ffmpeg-static 不含 ffprobe；改以 ffmpeg -i 印出的 Duration 行取得長度與解析度（不解碼，瞬間完成） */
export function probeDuration(file: string): Promise<{ duration: number; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('close', () => {
      let duration = 0
      const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err)
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      const wh = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(err)
      resolve({ duration, width: wh ? Number(wh[1]) : undefined, height: wh ? Number(wh[2]) : undefined })
    })
  })
}

/**
 * MediaRecorder 產生的 WebM 沒有長度與 Cue 資訊，無法拖曳進度列；
 * 以 -c copy 重新封裝一次即可修正。Chromium 的 H.264 錄影不符合 WebM 規範
 * （ffmpeg 的 webm muxer 拒收），因此一律改封裝成 Matroska（.mkv），Chromium 可直接播放。
 * @returns 修正後的檔名（raw.mkv）
 */
export async function fixRaw(dir: string, rawFile: string): Promise<string> {
  const src = join(dir, rawFile)
  const outName = 'raw.mkv'
  const tmp = join(dir, 'raw.fixing.mkv')
  try {
    await runFfmpeg(['-i', src, '-c', 'copy', '-f', 'matroska', tmp])
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp)
    throw e
  }
  unlinkSync(src)
  renameSync(tmp, join(dir, outName))
  return outName
}

function escapeMeta(s: string): string {
  return s.replace(/([=;#\\n])/g, '\$1')
}

/** 產生 ffmetadata 檔案內容（含章節） */
export function buildChapterMetadata(p: Project): string {
  const chapters = [...p.chapters].sort((a, b) => a.time - b.time)
  const total = Math.max(p.duration, chapters.length ? chapters[chapters.length - 1].time + 1 : 1)
  const lines = [';FFMETADATA1', `title=${escapeMeta(p.title)}`, '']
  const list: Chapter[] = chapters.length && chapters[0].time > 0 ? [{ id: '_', time: 0, title: '開始' }, ...chapters] : chapters
  for (let i = 0; i < list.length; i++) {
    const start = Math.round(list[i].time * 1000)
    const end = Math.round((i + 1 < list.length ? list[i + 1].time : total) * 1000)
    if (end <= start) continue
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${end}`, `title=${escapeMeta(list[i].title)}`, '')
  }
  return lines.join('\n')
}

export async function exportMp4(p: Project, opts: { crf?: number; onProgress?: (r: number) => void } = {}): Promise<string> {
  const raw = join(p.dir, p.rawFile)
  const out = join(p.dir, 'output.mp4')
  const meta = join(p.dir, 'chapters.ffmeta')
  writeFileSync(meta, buildChapterMetadata(p), 'utf8')
  const isH264 = (p.codec ?? '').toLowerCase().includes('h264') || (p.codec ?? '').toLowerCase().includes('avc')
  const video = isH264
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(opts.crf ?? 22), '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']
  await runFfmpeg(
    ['-i', raw, '-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', ...video, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out],
    { duration: p.duration, onProgress: opts.onProgress }
  )
  return out
}

export interface SegmentInfo {
  /** 1-based 序號 */
  index: number
  title: string
  start: number
  end: number
}

/** 依章節計算各段落的起訖時間；第一個章節不在 0 秒時自動補「開始」段 */
export function segmentList(p: Project): SegmentInfo[] {
  const chapters = [...p.chapters].sort((a, b) => a.time - b.time)
  const list = chapters.length && chapters[0].time > 0 ? [{ id: '_', time: 0, title: '開始' }, ...chapters] : chapters
  if (list.length === 0) list.push({ id: '_', time: 0, title: p.title })
  const out: SegmentInfo[] = []
  for (let i = 0; i < list.length; i++) {
    const start = list[i].time
    const end = i + 1 < list.length ? list[i + 1].time : p.duration
    if (end - start <= 0.5) continue
    out.push({ index: out.length + 1, title: list[i].title, start, end })
  }
  return out
}

export interface SegmentOptions {
  outDir: string
  /** original：保留解析度；lms：縮到 720p、降低位元率以符合學習平台上傳限制 */
  quality?: 'original' | 'lms'
  /** titled：01-標題.mp4；plain：01.mp4（避免平台不支援中文檔名） */
  naming?: 'titled' | 'plain'
  onProgress?: (r: number, msg: string) => void
}

export interface SegmentFile extends SegmentInfo {
  file: string
  /** 相對於 outDir 的檔名 */
  name: string
}

/** 依章節切成多個 MP4 檔案（重新編碼，切點精準；-c copy 只能切在關鍵影格） */
export async function exportSegments(p: Project, opts: SegmentOptions): Promise<SegmentFile[]> {
  const src = join(p.dir, p.rawFile)
  if (!existsSync(src)) throw new Error('找不到原始錄影檔')
  mkdirSync(opts.outDir, { recursive: true })
  const segs = segmentList(p)
  const lms = opts.quality === 'lms'
  const video = lms
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-maxrate', '1500k', '-bufsize', '3000k', '-vf', 'scale=-2:min(720\\,ih)', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p']
  const audio = ['-c:a', 'aac', '-b:a', lms ? '96k' : '160k']
  const files: SegmentFile[] = []
  const total = segs.reduce((s, x) => s + (x.end - x.start), 0) || 1
  let done = 0
  for (const s of segs) {
    const n = String(s.index).padStart(2, '0')
    const name = opts.naming === 'plain' ? `${n}.mp4` : `${n}-${s.title.replace(/[\\/:*?"<>|]/g, '_')}.mp4`
    const out = join(opts.outDir, name)
    const len = s.end - s.start
    const base = done
    opts.onProgress?.(base / total, `切割：${n} ${s.title}`)
    await runFfmpeg(
      ['-ss', String(s.start), '-i', src, '-t', String(len), ...video, ...audio, '-map_chapters', '-1', '-movflags', '+faststart', out],
      { duration: len, onProgress: (r) => opts.onProgress?.((base + r * len) / total, `切割：${n} ${s.title}`) }
    )
    done += len
    files.push({ ...s, file: out, name })
  }
  opts.onProgress?.(1, '完成')
  return files
}

/** 擷取單張縮圖 */
export async function makeThumbAt(src: string, time: number, out: string, width = 320): Promise<void> {
  await runFfmpeg(['-ss', String(Math.max(0, time)), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', out])
}

export async function makeThumbnail(p: Project, time = 1): Promise<string> {
  const src = join(p.dir, p.rawFile)
  const out = join(p.dir, 'thumb.jpg')
  const t = Math.min(Math.max(0, time), Math.max(0, p.duration - 0.5))
  await runFfmpeg(['-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out])
  return out
}

export async function makeChapterThumbnails(p: Project): Promise<Record<string, string>> {
  const src = join(p.dir, p.rawFile)
  const dir = join(p.dir, 'thumbs')
  mkdirSync(dir, { recursive: true })
  const result: Record<string, string> = {}
  for (const c of p.chapters) {
    const out = join(dir, `${c.id}.jpg`)
    const t = Math.min(c.time + 0.5, Math.max(0, p.duration - 0.2))
    try {
      await runFfmpeg(['-ss', String(t), '-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out])
      result[c.id] = `thumbs/${c.id}.jpg`
    } catch {
      /* ignore */
    }
  }
  return result
}
