import { useEffect, useState } from 'react'
import type { AppSettings, YouTubeStatus } from '@shared/types'

export default function Settings(): React.JSX.Element {
  const [s, setS] = useState<AppSettings | null>(null)
  const [yt, setYt] = useState<YouTubeStatus | null>(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void window.api.getSettings().then(setS)
    void window.api.ytStatus().then(setYt)
  }, [])

  if (!s) return <div className="empty">載入中…</div>

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = await window.api.saveSettings(patch)
    setS(next)
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>設定</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>儲存位置</h2>
        <div className="row">
          <input className="input" value={s.libraryDir} readOnly />
          <button className="btn" onClick={() => void window.api.chooseLibraryDir().then((d) => d && setS({ ...s, libraryDir: d }))}>
            變更…
          </button>
          <button className="btn" onClick={() => void window.api.openPath(s.libraryDir)}>
            開啟
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          每次錄影會在此建立一個資料夾，內含原始錄影 raw.webm、project.json（段落索引）、匯出的 MP4 / HTML。
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>錄影快捷鍵</h2>
        <div className="row">
          {(['marker', 'pause', 'stop'] as const).map((k) => (
            <div className="field grow" key={k}>
              <label>{k === 'marker' ? '新增段落' : k === 'pause' ? '暫停／繼續' : '停止'}</label>
              <input className="input" value={s.hotkeys[k]} onChange={(e) => setS({ ...s, hotkeys: { ...s.hotkeys, [k]: e.target.value } })} onBlur={() => void save({ hotkeys: s.hotkeys })} />
            </div>
          ))}
        </div>
        <div className="small muted">
          使用 Electron 快捷鍵格式，例如 <kbd>F8</kbd>、<kbd>CommandOrControl+Shift+M</kbd>、<kbd>Alt+1</kbd>。錄影期間全域有效。
        </div>
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label className="toggle">
            <input type="checkbox" checked={s.chapterOnResume} onChange={(e) => void save({ chapterOnResume: e.target.checked })} />
            繼續錄影時自動新增段落
          </label>
          <span className="small muted">按「暫停」再按「繼續」時，在繼續的位置自動加一個段落節點（可先在控制列輸入框打好標題）。</span>
        </div>
      </div>

      <div className="card">
        <h2>YouTube 上傳</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="field grow">
            <label>OAuth Client ID</label>
            <input className="input" value={s.youtube.clientId} onChange={(e) => setS({ ...s, youtube: { ...s.youtube, clientId: e.target.value } })} />
          </div>
          <div className="field grow">
            <label>OAuth Client Secret</label>
            <input className="input" type="password" value={s.youtube.clientSecret} onChange={(e) => setS({ ...s, youtube: { ...s.youtube, clientSecret: e.target.value } })} />
          </div>
        </div>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn primary"
            onClick={() =>
              void save({ youtube: s.youtube })
                .then(() => window.api.ytStatus())
                .then((st) => {
                  setYt(st)
                  setMsg('已儲存')
                })
            }
          >
            儲存
          </button>
          {yt?.configured && !yt.signedIn && (
            <button className="btn" onClick={() => void window.api.ytSignIn().then(setYt).catch((e) => setMsg(`❌ ${e.message ?? e}`))}>
              登入 Google 帳號
            </button>
          )}
          {yt?.signedIn && (
            <>
              <span className="ok">✔ 已登入：{yt.channelTitle}</span>
              <button className="btn sm" onClick={() => void window.api.ytSignOut().then(() => window.api.ytStatus()).then(setYt)}>
                登出
              </button>
            </>
          )}
          {msg && <span className="muted small">{msg}</span>}
        </div>
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>
            如何取得 Client ID / Secret？
          </summary>
          <ol className="steps" style={{ marginTop: 8 }}>
            <li>
              前往{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), void window.api.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com'))}>
                Google Cloud Console
              </a>
              ，建立專案並啟用「YouTube Data API v3」。
            </li>
            <li>「OAuth 同意畫面」：選擇「外部」，填寫應用程式名稱，並在「測試使用者」加入您自己的 Google 帳號。</li>
            <li>「憑證」→「建立憑證」→「OAuth 用戶端 ID」，應用程式類型選「電腦版應用程式」。</li>
            <li>把產生的 Client ID 與 Client Secret 貼到上方欄位，儲存後按「登入 Google 帳號」。</li>
            <li className="muted">注意：未經 Google 審核的應用程式，透過 API 上傳的影片會被鎖定為「私人」；可在 YouTube Studio 手動改為公開或不公開，或送審 App。</li>
          </ol>
        </details>
      </div>
    </div>
  )
}
