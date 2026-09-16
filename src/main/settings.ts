import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppSettings, DEFAULT_SETTINGS } from '@shared/types'

const file = () => join(app.getPath('userData'), 'settings.json')

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  const defaults: AppSettings = {
    libraryDir: join(app.getPath('videos'), 'MyCAM'),
    ...structuredClone(DEFAULT_SETTINGS)
  }
  try {
    if (existsSync(file())) {
      const saved = JSON.parse(readFileSync(file(), 'utf8'))
      cache = {
        ...defaults,
        ...saved,
        youtube: { ...defaults.youtube, ...(saved.youtube ?? {}) },
        hotkeys: { ...defaults.hotkeys, ...(saved.hotkeys ?? {}) },
        recording: { ...defaults.recording, ...(saved.recording ?? {}) }
      }
    } else cache = defaults
  } catch {
    cache = defaults
  }
  if (!existsSync(cache!.libraryDir)) mkdirSync(cache!.libraryDir, { recursive: true })
  return cache!
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = getSettings()
  cache = {
    ...cur,
    ...patch,
    youtube: { ...cur.youtube, ...(patch.youtube ?? {}) },
    hotkeys: { ...cur.hotkeys, ...(patch.hotkeys ?? {}) },
    recording: { ...cur.recording, ...(patch.recording ?? {}) }
  }
  if (!existsSync(cache.libraryDir)) mkdirSync(cache.libraryDir, { recursive: true })
  writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8')
  return cache
}
