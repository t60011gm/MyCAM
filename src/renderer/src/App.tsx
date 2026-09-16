import { useEffect, useState } from 'react'
import type { Project, RecordingSettings } from '@shared/types'
import Library from './views/Library'
import Setup from './views/Setup'
import Recording from './views/Recording'
import Editor from './views/Editor'
import Settings from './views/Settings'

export type View =
  | { name: 'library' }
  | { name: 'setup' }
  | { name: 'recording'; project: Project; settings: RecordingSettings }
  | { name: 'editor'; id: string }
  | { name: 'settings' }

export default function App(): React.JSX.Element {
  const [view, setView] = useState<View>({ name: 'library' })
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.version().then(setVersion)
  }, [])

  if (view.name === 'recording') {
    return (
      <Recording
        project={view.project}
        settings={view.settings}
        onDone={(p) => setView({ name: 'editor', id: p.id })}
        onCancel={() => setView({ name: 'library' })}
      />
    )
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          My<span>CAM</span>
        </div>
        <button className={`nav-btn ${view.name === 'library' ? 'active' : ''}`} onClick={() => setView({ name: 'library' })}>
          📚 錄影資料庫
        </button>
        <button className={`nav-btn ${view.name === 'setup' ? 'active' : ''}`} onClick={() => setView({ name: 'setup' })}>
          ⏺ 新增錄影
        </button>
        <button className={`nav-btn ${view.name === 'settings' ? 'active' : ''}`} onClick={() => setView({ name: 'settings' })}>
          ⚙ 設定
        </button>
        <div className="spacer" />
        <div className="version">v{version}</div>
      </aside>
      <main className="main">
        {view.name === 'library' && <Library onOpen={(id) => setView({ name: 'editor', id })} onNew={() => setView({ name: 'setup' })} />}
        {view.name === 'setup' && <Setup onStart={(project, settings) => setView({ name: 'recording', project, settings })} />}
        {view.name === 'editor' && <Editor id={view.id} onBack={() => setView({ name: 'library' })} />}
        {view.name === 'settings' && <Settings />}
      </main>
    </div>
  )
}
