import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, CaptureSource, Project, RecordingSettings, WebcamPosition } from '@shared/types'
import { recorder, pickMimeType } from '../recorder'

interface Props {
  onStart: (project: Project, settings: RecordingSettings) => void
}

interface Device {
  deviceId: string
  label: string
}

export default function Setup({ onStart }: Props): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [title, setTitle] = useState('')
  const [mics, setMics] = useState<Device[]>([])
  const [cams, setCams] = useState<Device[]>([])
  const [platform, setPlatform] = useState<string>('win32')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rec = settings?.recording

  const loadSources = useCallback(async () => {
    const list = await window.api.listSources()
    setSources(list)
    setSourceId((cur) => (list.some((s) => s.id === cur) ? cur : (list.find((s) => s.kind === 'screen') ?? list[0])?.id ?? ''))
  }, [])

  useEffect(() => {
    void window.api.getSettings().then(setSettings)
    void window.api.platform().then(setPlatform)
    void loadSources()
    void (async () => {
      try {
        await window.api.requestMediaPermissions()
        // 先要求一次權限，enumerateDevices 才會回傳裝置名稱
        const tmp = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
        tmp?.getTracks().forEach((t) => t.stop())
        const devs = await navigator.mediaDevices.enumerateDevices()
        setMics(devs.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label || '麥克風' })))
        setCams(devs.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label || '攝影機' })))
      } catch {
        /* ignore */
      }
    })()
    const d = new Date()
    setTitle(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} 課程錄影`)
  }, [loadSources])

  const update = (patch: Partial<AppSettings['recording']>): void => {
    if (!settings) return
    const next = { ...settings, recording: { ...settings.recording, ...patch } }
    setSettings(next)
    void window.api.saveSettings({ recording: next.recording })
  }

  const start = async (): Promise<void> => {
    if (!settings || !rec || !sourceId) return
    setBusy(true)
    setError('')
    const src = sources.find((s) => s.id === sourceId)
    const rs: RecordingSettings = { ...rec, sourceId, sourceName: src?.name ?? '' }
    let project: Project | null = null
    try {
      await window.api.selectSource(sourceId)
      project = await window.api.createProject(title.trim() || '未命名錄影')
      await window.api.recStart(project.id)
      const id = project.id
      await recorder.start(rs, (buf) => window.api.recChunk(id, buf))
      onStart(project, rs)
    } catch (e) {
      if (project) await window.api.recCancel(project.id).catch(() => undefined)
      else await window.api.recCleanupWindow()
      setError(`無法開始錄影：${(e as Error).message ?? e}`)
      setBusy(false)
    }
  }

  if (!settings || !rec) return <div className="empty">載入中…</div>
  const hk = settings.hotkeys
  const mime = pickMimeType()

  return (
    <div>
      <div className="page-head">
        <h1>新增錄影</h1>
        <button className="btn rec" disabled={busy || !sourceId} onClick={() => void start()}>
          {busy ? '啟動中…' : '⏺ 開始錄影'}
        </button>
      </div>
      {error && (
        <div className="hint warn" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="setup">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>錄製範圍</h2>
            <button className="btn sm" onClick={() => void loadSources()}>
              ↻ 重新整理
            </button>
          </div>
          <div className="source-grid">
            {sources.map((s) => (
              <div key={s.id} className={`source-tile ${s.id === sourceId ? 'selected' : ''}`} onClick={() => setSourceId(s.id)} title={s.name}>
                <img src={s.thumbnail} alt="" />
                <div className="name">
                  {s.kind === 'screen' ? '🖥 ' : '🪟 '}
                  {s.name}
                </div>
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 12 }}>
            錄影時 MyCAM 會縮成螢幕右下角的浮動控制列（不會被錄進影片）。快捷鍵：<kbd>{hk.marker}</kbd> 新增段落、
            <kbd>{hk.pause}</kbd> 暫停／繼續、<kbd>{hk.stop}</kbd> 停止。
          </div>
        </div>

        <div className="card">
          <div className="field">
            <label>錄影標題</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <h3>聲音</h3>
          <div className="field">
            <label className="toggle">
              <input type="checkbox" checked={rec.mic} onChange={(e) => update({ mic: e.target.checked })} /> 錄製麥克風
            </label>
            {rec.mic && (
              <select className="select" value={rec.micDeviceId} onChange={(e) => update({ micDeviceId: e.target.value })}>
                <option value="">預設麥克風</option>
                {mics.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="field">
            <label className="toggle">
              <input type="checkbox" checked={rec.systemAudio} onChange={(e) => update({ systemAudio: e.target.checked })} /> 錄製系統聲音
            </label>
            {platform === 'darwin' && <span className="small muted">macOS 不支援直接擷取系統聲音，需安裝 BlackHole 等虛擬音源並選為麥克風。</span>}
          </div>

          <h3>教師攝影機（子母畫面）</h3>
          <div className="field">
            <label className="toggle">
              <input type="checkbox" checked={rec.webcam} onChange={(e) => update({ webcam: e.target.checked })} /> 疊加攝影機畫面
            </label>
            {rec.webcam && (
              <>
                <select className="select" value={rec.webcamDeviceId} onChange={(e) => update({ webcamDeviceId: e.target.value })}>
                  <option value="">預設攝影機</option>
                  {cams.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="row">
                  <select className="select" value={rec.webcamPosition} onChange={(e) => update({ webcamPosition: e.target.value as WebcamPosition })}>
                    <option value="br">右下角</option>
                    <option value="bl">左下角</option>
                    <option value="tr">右上角</option>
                    <option value="tl">左上角</option>
                  </select>
                  <select className="select" value={rec.webcamScale} onChange={(e) => update({ webcamScale: Number(e.target.value) })}>
                    <option value={0.15}>小 (15%)</option>
                    <option value={0.2}>中 (20%)</option>
                    <option value={0.28}>大 (28%)</option>
                  </select>
                </div>
              </>
            )}
          </div>

          <h3>品質</h3>
          <div className="row">
            <div className="field grow">
              <label>影格率</label>
              <select className="select" value={rec.fps} onChange={(e) => update({ fps: Number(e.target.value) })}>
                <option value={15}>15 fps（投影片）</option>
                <option value={30}>30 fps（一般）</option>
                <option value={60}>60 fps（流暢）</option>
              </select>
            </div>
            <div className="field grow">
              <label>位元率</label>
              <select className="select" value={rec.videoBitrate} onChange={(e) => update({ videoBitrate: Number(e.target.value) })}>
                <option value={2_500_000}>2.5 Mbps（小檔）</option>
                <option value={6_000_000}>6 Mbps（建議）</option>
                <option value={12_000_000}>12 Mbps（高品質）</option>
              </select>
            </div>
          </div>
          <div className="small muted">錄製編碼：{mime || '（不支援）'}</div>
        </div>
      </div>
    </div>
  )
}
