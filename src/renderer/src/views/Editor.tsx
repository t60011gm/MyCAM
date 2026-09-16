import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Chapter, ProgressEvent, Project, YouTubeStatus, YouTubeUploadOptions } from '@shared/types'
import { chaptersToYouTubeText, formatTime } from '@shared/types'
import { newId } from '../recorder'

interface Props {
  id: string
  onBack: () => void
}

type Task = 'mp4' | 'segments' | 'html' | 'youtube' | 'finalize'

export default function Editor({ id, onBack }: Props): React.JSX.Element {
  const [p, setP] = useState<Project | null>(null)
  const [cur, setCur] = useState(0)
  const [progress, setProgress] = useState<Partial<Record<Task, ProgressEvent>>>({})
  const [running, setRunning] = useState<Task | null>(null)
  const [msg, setMsg] = useState('')
  const [yt, setYt] = useState<YouTubeStatus | null>(null)
  const [ytForm, setYtForm] = useState<YouTubeUploadOptions>({ title: '', description: '', privacy: 'unlisted' })
  const videoRef = useRef<HTMLVideoElement>(null)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    void window.api.loadProject(id).then((proj) => {
      setP(proj)
      setYtForm((f) => ({ ...f, title: proj.title, description: buildDescription(proj) }))
    })
    void window.api.ytStatus().then(setYt)
  }, [id])

  useEffect(() => {
    return window.api.onProgress((ev) => {
      if (ev.projectId !== id) return
      setProgress((m) => ({ ...m, [ev.task]: ev }))
    })
  }, [id])

  const persist = useCallback((next: Project) => {
    setP(next)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void window.api.saveProject(next), 400)
  }, [])

  const chapters = useMemo(() => (p ? [...p.chapters].sort((a, b) => a.time - b.time) : []), [p])
  const activeId = useMemo(() => {
    let a: Chapter | null = null
    for (const c of chapters) if (cur >= c.time) a = c
    return a?.id
  }, [chapters, cur])

  if (!p) return <div className="empty">載入中…</div>

  const src = window.api.mediaUrl(`${p.dir}/${p.rawFile}`)
  const seek = (t: number): void => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    void v.play()
  }
  const updateChapter = (cid: string, patch: Partial<Chapter>): void =>
    persist({ ...p, chapters: p.chapters.map((c) => (c.id === cid ? { ...c, ...patch } : c)) })
  const removeChapter = (cid: string): void => persist({ ...p, chapters: p.chapters.filter((c) => c.id !== cid) })
  const addChapterHere = (): void => {
    const time = Math.round((videoRef.current?.currentTime ?? 0) * 10) / 10
    persist({ ...p, chapters: [...p.chapters, { id: newId(), time, title: `段落 ${p.chapters.length + 1}` }] })
  }

  const run = async (task: Task, fn: () => Promise<string | void>): Promise<void> => {
    if (running) return
    setRunning(task)
    setMsg('')
    setProgress((m) => ({ ...m, [task]: { task, projectId: id, ratio: 0 } }))
    try {
      const r = await fn()
      const fresh = await window.api.loadProject(id)
      setP(fresh)
      if (typeof r === 'string') setMsg(r)
    } catch (e) {
      setMsg(`❌ ${(e as Error).message ?? e}`)
    } finally {
      setRunning(null)
    }
  }

  const ensureMp4 = async (): Promise<void> => {
    if (!p.outputFile) await window.api.exportMp4(id)
  }

  const doUpload = (): Promise<void> =>
    run('youtube', async () => {
      await ensureMp4()
      const r = await window.api.ytUpload(id, ytForm)
      return `✅ 已上傳：${r.url}`
    })

  const copy = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setMsg('已複製到剪貼簿')
  }

  const bar = (task: Task): React.JSX.Element | null => {
    const ev = progress[task]
    if (!ev || (ev.ratio >= 1 && running !== task)) return null
    return (
      <div style={{ marginTop: 6 }}>
        <div className="progress">
          <div style={{ width: `${Math.round(ev.ratio * 100)}%` }} />
        </div>
        <div className="small muted">
          {Math.round(ev.ratio * 100)}% {ev.message ?? ''}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div className="row">
          <button className="btn" onClick={onBack}>
            ← 返回
          </button>
          <input className="input" value={p.title} onChange={(e) => persist({ ...p, title: e.target.value })} style={{ width: 380, fontWeight: 600 }} />
        </div>
        <div className="row">
          <span className="muted small">
            {formatTime(p.duration, true)} · {p.width}×{p.height} · {p.codec?.split(';')[1] ?? ''}
          </span>
          <button className="btn" onClick={() => void window.api.showInFolder(`${p.dir}/${p.rawFile}`)}>
            📁 開啟資料夾
          </button>
        </div>
      </div>

      <div className="editor">
        <div className="left">
          <video ref={videoRef} src={src} controls onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)} />
          <div className="row">
            <button className="btn primary" onClick={addChapterHere}>
              ＋ 在 {formatTime(cur)} 新增段落
            </button>
            <span className="muted small">點擊右側段落時間可跳轉；「⌖」可把該段落改為目前播放位置。</span>
          </div>
          <div className="card">
            <h3>補充說明（會附在 HTML 教材頁與 YouTube 說明欄）</h3>
            <textarea className="textarea" value={p.notes} onChange={(e) => persist({ ...p, notes: e.target.value })} placeholder="課程重點、參考資料、作業說明…" />
          </div>
        </div>

        <div className="right">
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>段落索引</h2>
              <span className="muted small">{chapters.length} 段</span>
            </div>
            <div className="chapter-list" style={{ marginTop: 10 }}>
              {chapters.length === 0 && <div className="muted small">尚無段落。播放影片並按「新增段落」。</div>}
              {chapters.map((c, i) => (
                <div key={c.id} className={`chapter-row ${c.id === activeId ? 'active' : ''}`}>
                  <span className="idx">{i + 1}</span>
                  <button className="t" onClick={() => seek(c.time)} title="跳到此段落">
                    {formatTime(c.time, p.duration >= 3600)}
                  </button>
                  <input className="input" value={c.title} onChange={(e) => updateChapter(c.id, { title: e.target.value })} />
                  <button className="btn sm icon" title="改為目前播放位置" onClick={() => updateChapter(c.id, { time: Math.round(cur * 10) / 10 })}>
                    ⌖
                  </button>
                  <button className="btn sm icon danger" title="刪除" onClick={() => removeChapter(c.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>匯出</h2>
            <div className="export-list">
              <div className="export-item">
                <div className="desc">
                  MP4（內嵌章節）{p.outputFile && <span className="ok small"> ✔ 已匯出</span>}
                  <small>H.264 + AAC，播放器可直接顯示章節</small>
                  {bar('mp4')}
                </div>
                <button className="btn" disabled={!!running} onClick={() => void run('mp4', () => window.api.exportMp4(id).then(() => '✅ MP4 匯出完成'))}>
                  匯出
                </button>
              </div>
              <div className="export-item">
                <div className="desc">
                  依段落切成多個 MP4
                  <small>存於 segments/ 資料夾（需先匯出 MP4）</small>
                  {bar('segments')}
                </div>
                <button
                  className="btn"
                  disabled={!!running}
                  onClick={() =>
                    void run('segments', async () => {
                      await ensureMp4()
                      const files = await window.api.exportSegments(id)
                      return `✅ 已切成 ${files.length} 段`
                    })
                  }
                >
                  切割
                </button>
              </div>
              <div className="export-item">
                <div className="desc">
                  HTML 教材播放頁
                  <small>index.html：影片 + 段落索引側欄，可放到網站或隨身碟</small>
                  {bar('html')}
                </div>
                <button
                  className="btn"
                  disabled={!!running}
                  onClick={() =>
                    void run('html', async () => {
                      await ensureMp4()
                      const f = await window.api.exportHtml(id)
                      await window.api.openPath(f)
                      return '✅ HTML 已產生並開啟'
                    })
                  }
                >
                  產生
                </button>
              </div>
              <div className="export-item">
                <div className="desc">
                  章節時間軸文字
                  <small>貼到 YouTube 說明欄即自動變成章節</small>
                </div>
                <button className="btn" onClick={() => void copy(chaptersToYouTubeText(p.chapters))}>
                  複製
                </button>
                <button className="btn" onClick={() => void window.api.exportChaptersText(id).then((f) => window.api.showInFolder(f))}>
                  存檔
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>上傳 YouTube</h2>
            {yt && !yt.configured && <div className="hint warn">請先到「設定」填入 Google API 的 Client ID / Secret。</div>}
            {yt && yt.configured && !yt.signedIn && (
              <button className="btn" onClick={() => void window.api.ytSignIn().then(setYt).catch((e) => setMsg(`❌ ${e.message ?? e}`))}>
                使用 Google 帳號登入
              </button>
            )}
            {yt?.signedIn && (
              <>
                <div className="small muted" style={{ marginBottom: 8 }}>
                  頻道：{yt.channelTitle}
                </div>
                <div className="field">
                  <label>影片標題</label>
                  <input className="input" value={ytForm.title} onChange={(e) => setYtForm({ ...ytForm, title: e.target.value })} />
                </div>
                <div className="field">
                  <label>說明（含章節時間軸）</label>
                  <textarea className="textarea" rows={6} value={ytForm.description} onChange={(e) => setYtForm({ ...ytForm, description: e.target.value })} />
                  <button className="btn sm" onClick={() => setYtForm({ ...ytForm, description: buildDescription(p) })}>
                    重新產生說明
                  </button>
                </div>
                <div className="field">
                  <label>隱私</label>
                  <select className="select" value={ytForm.privacy} onChange={(e) => setYtForm({ ...ytForm, privacy: e.target.value as YouTubeUploadOptions['privacy'] })}>
                    <option value="unlisted">不公開（有連結者可看）</option>
                    <option value="private">私人</option>
                    <option value="public">公開</option>
                  </select>
                </div>
                {bar('youtube')}
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn primary" disabled={!!running} onClick={() => void doUpload()}>
                    {running === 'youtube' ? '上傳中…' : '⬆ 上傳'}
                  </button>
                  {p.youtube && (
                    <a href="#" onClick={(e) => (e.preventDefault(), void window.api.openExternal(p.youtube!.url))}>
                      {p.youtube.url}
                    </a>
                  )}
                </div>
              </>
            )}
          </div>

          {msg && <div className="hint">{msg}</div>}
        </div>
      </div>
    </div>
  )
}

function buildDescription(p: Project): string {
  const parts = [chaptersToYouTubeText(p.chapters)]
  if (p.notes.trim()) parts.push('', p.notes.trim())
  return parts.join('\n')
}
