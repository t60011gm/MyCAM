import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { formatTime } from '@shared/types'

interface Props {
  onOpen: (id: string) => void
  onNew: () => void
}

export default function Library({ onOpen, onNew }: Props): React.JSX.Element {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [q, setQ] = useState('')

  const reload = useCallback(() => {
    void window.api.listProjects().then(setProjects)
  }, [])

  useEffect(reload, [reload])

  const del = async (p: Project, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!confirm(`確定刪除「${p.title}」？\n整個資料夾（含原始錄影與匯出檔）都會被刪除。`)) return
    await window.api.deleteProject(p.id)
    reload()
  }

  const list = (projects ?? []).filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="page-head">
        <h1>錄影資料庫</h1>
        <div className="row">
          <input className="input" placeholder="搜尋標題…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <button className="btn" onClick={reload}>
            ↻
          </button>
          <button className="btn rec" onClick={onNew}>
            ⏺ 新增錄影
          </button>
        </div>
      </div>

      {projects === null && <div className="empty">載入中…</div>}
      {projects !== null && list.length === 0 && (
        <div className="empty">
          尚無錄影。
          <br />
          <br />
          <button className="btn primary" onClick={onNew}>
            開始第一次錄影
          </button>
        </div>
      )}

      <div className="proj-grid">
        {list.map((p) => (
          <div key={p.id} className="proj-card" onClick={() => onOpen(p.id)}>
            <div className="thumb" style={{ backgroundImage: `url("${window.api.mediaUrl(`${p.dir}/thumb.jpg`)}")` }}>
              {!p.duration && '（無內容）'}
            </div>
            <div className="body">
              <div className="title" title={p.title}>
                {p.title}
              </div>
              <div className="meta">
                <span>{new Date(p.createdAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}</span>
                <span>{formatTime(p.duration)}</span>
                <span>{p.chapters.length} 段</span>
              </div>
              <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 4 }}>
                  {p.outputFile && <span className="badge">MP4</span>}
                  {p.youtube && <span className="badge yt">YouTube</span>}
                </div>
                <button className="btn sm danger" onClick={(e) => void del(p, e)}>
                  刪除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
