import { app, safeStorage, shell } from 'electron'
import { createServer } from 'http'
import { createReadStream, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import { getSettings } from './settings'
import { YouTubeStatus, YouTubeUploadOptions } from '@shared/types'

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly']

const tokenFile = (): string => join(app.getPath('userData'), 'youtube-token.bin')

function readToken(): Record<string, unknown> | null {
  try {
    if (!existsSync(tokenFile())) return null
    const buf = readFileSync(tokenFile())
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
    return JSON.parse(text)
  } catch {
    return null
  }
}

function writeToken(tok: Record<string, unknown>): void {
  const text = JSON.stringify(tok)
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8')
  writeFileSync(tokenFile(), data)
}

function makeClient(redirectUri?: string): OAuth2Client {
  const { clientId, clientSecret } = getSettings().youtube
  if (!clientId || !clientSecret) {
    throw new Error('尚未設定 YouTube API 的 Client ID / Client Secret，請至「設定」填寫。')
  }
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  client.on('tokens', (t) => {
    const cur = readToken() ?? {}
    writeToken({ ...cur, ...t })
  })
  return client
}

function authedClient(): OAuth2Client {
  const tok = readToken()
  if (!tok) throw new Error('尚未登入 YouTube')
  const client = makeClient()
  client.setCredentials(tok)
  return client
}

export async function youtubeStatus(): Promise<YouTubeStatus> {
  const { clientId, clientSecret } = getSettings().youtube
  const configured = Boolean(clientId && clientSecret)
  const tok = readToken()
  if (!configured || !tok) return { configured, signedIn: false }
  try {
    const yt = google.youtube({ version: 'v3', auth: authedClient() })
    const res = await yt.channels.list({ part: ['snippet'], mine: true })
    return { configured, signedIn: true, channelTitle: res.data.items?.[0]?.snippet?.title ?? '(未知頻道)' }
  } catch {
    return { configured, signedIn: true, channelTitle: '(無法取得頻道資訊)' }
  }
}

export function youtubeSignOut(): void {
  if (existsSync(tokenFile())) unlinkSync(tokenFile())
}

/** 桌面應用程式 OAuth：在本機開一個 loopback 伺服器接收授權碼 */
export function youtubeSignIn(): Promise<YouTubeStatus> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('無法啟動本機授權伺服器'))
        return
      }
      const redirect = `http://127.0.0.1:${addr.port}/oauth2callback`
      let client: OAuth2Client
      try {
        client = makeClient(redirect)
      } catch (e) {
        server.close()
        reject(e)
        return
      }
      const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })
      const timer = setTimeout(() => {
        server.close()
        reject(new Error('授權逾時（5 分鐘）'))
      }, 5 * 60 * 1000)

      server.on('request', async (req, res) => {
        try {
          const u = new URL(req.url ?? '/', redirect)
          if (u.pathname !== '/oauth2callback') {
            res.writeHead(404).end()
            return
          }
          const err = u.searchParams.get('error')
          const code = u.searchParams.get('code')
          if (err || !code) throw new Error(`授權被拒絕：${err ?? '無授權碼'}`)
          const { tokens } = await client.getToken(code)
          writeToken(tokens as Record<string, unknown>)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(
            '<html><body style="font-family:sans-serif;text-align:center;padding:40px">' +
              '<h2>MyCAM 已完成 YouTube 授權</h2><p>您可以關閉此視窗，回到 MyCAM。</p></body></html>'
          )
          clearTimeout(timer)
          server.close()
          resolve(await youtubeStatus())
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(e))
          clearTimeout(timer)
          server.close()
          reject(e)
        }
      })
      void shell.openExternal(url)
    })
  })
}

export async function youtubeUpload(
  file: string,
  opts: YouTubeUploadOptions,
  onProgress?: (ratio: number) => void
): Promise<{ videoId: string; url: string }> {
  if (!existsSync(file)) throw new Error('找不到要上傳的檔案，請先匯出 MP4')
  const size = statSync(file).size
  const yt = google.youtube({ version: 'v3', auth: authedClient() })
  const res = await yt.videos.insert(
    {
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: opts.title.slice(0, 100),
          description: opts.description.slice(0, 5000),
          tags: opts.tags,
          categoryId: '27',
          defaultLanguage: 'zh-TW'
        },
        status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false }
      },
      media: { mimeType: 'video/mp4', body: createReadStream(file) }
    },
    { onUploadProgress: (ev: { bytesRead: number }) => onProgress?.(Math.min(1, ev.bytesRead / size)) }
  )
  const videoId = res.data.id
  if (!videoId) throw new Error('YouTube 未回傳影片 ID')
  return { videoId, url: `https://youtu.be/${videoId}` }
}
