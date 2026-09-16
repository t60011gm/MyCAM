import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, createWriteStream, WriteStream, statSync } from 'fs'
import { join, resolve, sep } from 'path'
import { Project } from '@shared/types'
import { getSettings } from './settings'

const PROJECT_FILE = 'project.json'
export const RAW_FILE = 'raw.webm'

function safeName(s: string): string {
  return s.replace(/[\/:*?"<>|\r\n]/g, '_').trim().slice(0, 60) || '未命名'
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function projectDir(id: string): string {
  const root = resolve(getSettings().libraryDir)
  const dir = resolve(root, id)
  if (!dir.startsWith(root + sep)) throw new Error('非法的專案路徑')
  return dir
}

export function createProject(title: string): Project {
  const id = `${stamp()}-${safeName(title)}`
  const dir = projectDir(id)
  mkdirSync(dir, { recursive: true })
  const p: Project = {
    id,
    title: title || '未命名錄影',
    createdAt: new Date().toISOString(),
    duration: 0,
    rawFile: RAW_FILE,
    chapters: [],
    notes: '',
    dir
  }
  saveProject(p)
  return p
}

export function saveProject(p: Project): Project {
  const dir = projectDir(p.id)
  const { dir: _d, ...data } = p
  writeFileSync(join(dir, PROJECT_FILE), JSON.stringify(data, null, 2), 'utf8')
  return { ...p, dir }
}

export function loadProject(id: string): Project {
  const dir = projectDir(id)
  const data = JSON.parse(readFileSync(join(dir, PROJECT_FILE), 'utf8'))
  return { chapters: [], notes: '', ...data, id, dir }
}

export function listProjects(): Project[] {
  const root = getSettings().libraryDir
  if (!existsSync(root)) return []
  const out: Project[] = []
  for (const name of readdirSync(root)) {
    const f = join(root, name, PROJECT_FILE)
    if (!existsSync(f)) continue
    try {
      out.push(loadProject(name))
    } catch {
      /* skip broken */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function deleteProject(id: string): void {
  rmSync(projectDir(id), { recursive: true, force: true })
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/* ---- 錄影資料串流寫入 ---- */
const streams = new Map<string, WriteStream>()

export function openRawStream(id: string): void {
  closeRawStream(id)
  const dir = projectDir(id)
  streams.set(id, createWriteStream(join(dir, RAW_FILE)))
}

export function writeRawChunk(id: string, chunk: Buffer): Promise<void> {
  const s = streams.get(id)
  if (!s) throw new Error('錄影串流尚未開啟')
  return new Promise((res, rej) => s.write(chunk, (e) => (e ? rej(e) : res())))
}

export function closeRawStream(id: string): Promise<void> {
  const s = streams.get(id)
  if (!s) return Promise.resolve()
  streams.delete(id)
  return new Promise((res) => s.end(() => res()))
}
