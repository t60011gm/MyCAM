import { writeFileSync } from 'fs'
import { join } from 'path'
import { Project, formatTime } from '@shared/types'
import { makeChapterThumbnails } from './ffmpeg'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STYLE = `
:root{--bg:#0f1115;--panel:#181b22;--fg:#e8eaf0;--muted:#8a90a0;--accent:#4f8cff;--line:#262a34}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:14px}
header h1{font-size:18px;margin:0}header span{color:var(--muted);font-size:13px}
main{display:grid;grid-template-columns:1fr 320px;min-height:calc(100vh - 53px)}
video{width:100%;background:#000;max-height:calc(100vh - 53px)}
aside{border-left:1px solid var(--line);background:var(--panel);overflow:auto}
aside h2{font-size:13px;letter-spacing:.08em;color:var(--muted);margin:0;padding:14px 16px 6px}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:10px;padding:10px 16px;cursor:pointer;border-left:3px solid transparent}
li:hover{background:#1f2330}li.active{border-left-color:var(--accent);background:#1d2436}
li img,li .ph{width:88px;height:50px;border-radius:4px;object-fit:cover;background:#000;flex:none}
li b{display:block;font-weight:600}li small{color:var(--muted)}
.notes{padding:16px;border-top:1px solid var(--line)}.notes h3{margin:0 0 6px;font-size:14px}
.notes pre{white-space:pre-wrap;font:inherit;color:var(--muted);margin:0}
@media(max-width:800px){main{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line)}}
`

const SCRIPT = `
const v=document.getElementById('v'),items=[...document.querySelectorAll('#ch li')];
items.forEach(li=>li.addEventListener('click',()=>{v.currentTime=+li.dataset.t;v.play()}));
v.addEventListener('timeupdate',()=>{let a=null;for(const li of items){if(v.currentTime>=+li.dataset.t)a=li}
items.forEach(li=>li.classList.toggle('active',li===a))});
document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;
if(e.key===' '){e.preventDefault();v.paused?v.play():v.pause()}
if(e.key==='ArrowRight')v.currentTime+=5;if(e.key==='ArrowLeft')v.currentTime-=5});
`

/** 匯出可離線開啟的 HTML 教材播放頁（影片 + 段落索引側欄） */
export async function exportHtml(p: Project): Promise<string> {
  const thumbs = await makeChapterThumbnails(p)
  const chapters = [...p.chapters].sort((a, b) => a.time - b.time)
  const list = chapters.length && chapters[0].time > 0 ? [{ id: '_start', time: 0, title: '開始' }, ...chapters] : chapters
  const withHours = p.duration >= 3600
  const items = list
    .map((c, i) => {
      const img = thumbs[c.id] ? `<img src="${thumbs[c.id]}" alt="">` : '<span class="ph"></span>'
      return `<li data-t="${c.time}">${img}<div><b>${i + 1}. ${esc(c.title)}</b><small>${formatTime(c.time, withHours)}</small></div></li>`
    })
    .join('\n')
  const notes = p.notes ? `<section class="notes"><h3>補充說明</h3><pre>${esc(p.notes)}</pre></section>` : ''
  const date = new Date(p.createdAt).toLocaleDateString('zh-TW')
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<style>${STYLE}</style></head><body>
<header><h1>${esc(p.title)}</h1><span>${date} · ${formatTime(p.duration, true)}</span></header>
<main>
<div><video id="v" src="${esc(p.outputFile ?? 'output.mp4')}" controls preload="metadata"></video></div>
<aside><h2>段落索引</h2><ul id="ch">${items}</ul>${notes}</aside>
</main>
<script>${SCRIPT}</script></body></html>`
  const out = join(p.dir, 'index.html')
  writeFileSync(out, html, 'utf8')
  return out
}
