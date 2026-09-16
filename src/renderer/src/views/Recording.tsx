import { useEffect, useRef, useState } from 'react'
import type { Project, RecordingSettings } from '@shared/types'
import { formatTime } from '@shared/types'
import { recorder } from '../recorder'

interface Props {
  project: Project
  settings: RecordingSettings
  onDone: (p: Project) => void
  onCancel: () => void
}

/** 錄影中的浮動控制列（視窗此時為 520×64） */
export default function Recording({ project, onDone, onCancel }: Props): React.JSX.Element {
  const [, tick] = useState(0)
  const [chapterTitle, setChapterTitle] = useState('')
  const [finishing, setFinishing] = useState<string | null>(null)
  const [flash, setFlash] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const stoppingRef = useRef(false)

  // 每 250ms 重繪計時器；訂閱錄影狀態
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 250)
    const unsub = recorder.subscribe(() => tick((n) => n + 1))
    return () => {
      window.clearInterval(t)
      unsub()
    }
  }, [])

  const addChapter = (): void => {
    const c = recorder.addChapter(chapterTitle)
    if (!c) return
    setChapterTitle('')
    setFlash(`✔ ${formatTime(c.time)} ${c.title}`)
    window.setTimeout(() => setFlash(''), 2000)
  }

  const stop = async (): Promise<void> => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    try {
      setFinishing('停止錄影，寫入檔案…')
      const info = await recorder.stop()
      setFinishing('整理錄影檔（修正長度、產生縮圖）…')
      const p = await window.api.recFinish(project.id, info)
      onDone(p)
    } catch (e) {
      alert(`結束錄影時發生錯誤：${(e as Error).message ?? e}`)
      await window.api.recCleanupWindow()
      onCancel()
    }
  }

  const cancel = async (): Promise<void> => {
    if (!confirm('確定要放棄這段錄影？檔案將被刪除。')) return
    stoppingRef.current = true
    try {
      await recorder.stop()
    } catch {
      /* ignore */
    }
    await window.api.recCancel(project.id)
    onCancel()
  }

  // 全域快捷鍵
  useEffect(() => {
    return window.api.onHotkey((action) => {
      if (action === 'marker') addChapter()
      else if (action === 'pause') recorder.togglePause()
      else if (action === 'stop') void stop()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterTitle])

  // 若錄影來源被關閉（例如錄某視窗而該視窗被關掉），MediaRecorder 會結束
  useEffect(() => {
    if (recorder.state === 'idle' && !stoppingRef.current && !finishing) void stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state])

  const paused = recorder.state === 'paused'

  if (finishing) {
    return (
      <div className="recbar">
        <span className="muted small">{finishing}</span>
        {recorder.error && <span className="err small">{recorder.error}</span>}
      </div>
    )
  }

  return (
    <div className="recbar">
      <span className={`dot ${paused ? 'paused' : ''}`} />
      <span className="time">{formatTime(recorder.elapsed())}</span>
      <span className="count" title={recorder.warnings.join('\n')}>
        {recorder.chapters.length} 段{recorder.warnings.length > 0 && <span className="err"> ⚠</span>}
      </span>
      <input
        ref={titleRef}
        className="input"
        placeholder={flash || '段落標題（可留白）'}
        value={chapterTitle}
        onChange={(e) => setChapterTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') addChapter()
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      <button className="btn sm primary" onClick={addChapter} title="新增段落節點">
        ＋段落
      </button>
      <button className="btn sm" onClick={() => recorder.togglePause()} title={paused ? '繼續' : '暫停'}>
        {paused ? '▶' : '⏸'}
      </button>
      <button className="btn sm rec" onClick={() => void stop()} title="停止並儲存">
        ■
      </button>
      <button className="btn sm icon danger" onClick={() => void cancel()} title="放棄錄影">
        ✕
      </button>
    </div>
  )
}
