import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as archiver from 'archiver'
import { Project, formatTime } from '@shared/types'
import { exportSegments, makeThumbAt, SegmentFile } from './ffmpeg'

export interface ScormExportOptions {
  /** original：保留解析度；lms：720p 精簡版（學習平台常有單檔大小限制） */
  quality: 'original' | 'lms'
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

const num = (i: number): string => String(i).padStart(2, '0')

/** SCORM 1.2 執行環境 API 的最小包裝：找 API、初始化、回報進度與完成 */
const API_JS = `(function () {
  function find(win) { var n = 0; while (win && !win.API && win.parent && win.parent !== win && n < 30) { win = win.parent; n++ } return (win && win.API) || null }
  var API = null; try { API = find(window) || (window.opener ? find(window.opener) : null) } catch (e) {}
  var inited = false, finished = false
  window.MyCAMScorm = {
    available: function () { return !!API },
    init: function () {
      if (!API || inited) return inited
      try { API.LMSInitialize(''); inited = true
        var s = API.LMSGetValue('cmi.core.lesson_status')
        if (!s || s === 'not attempted') API.LMSSetValue('cmi.core.lesson_status', 'incomplete')
        API.LMSCommit('') } catch (e) {}
      return inited
    },
    location: function () { if (!inited) return ''; try { return API.LMSGetValue('cmi.core.lesson_location') } catch (e) { return '' } },
    save: function (pos, done) {
      if (!inited) return
      try { API.LMSSetValue('cmi.core.lesson_location', String(Math.floor(pos || 0)))
        if (done) API.LMSSetValue('cmi.core.lesson_status', 'completed')
        API.LMSCommit('') } catch (e) {}
    },
    finish: function () { if (!inited || finished) return; finished = true; try { API.LMSFinish('') } catch (e) {} }
  }
})();
`

const STYLE = `
:root{--bg:#0f1115;--panel:#181b22;--fg:#e8eaf0;--muted:#8a90a0;--accent:#4f8cff;--line:#262a34}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif}
header{padding:12px 18px;border-bottom:1px solid var(--line);display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
header h1{font-size:17px;margin:0}header span{color:var(--muted);font-size:13px}header a{color:var(--accent);text-decoration:none;font-size:13px;margin-left:auto}
video{width:100%;background:#000;display:block;max-height:calc(100vh - 120px)}
nav{display:flex;justify-content:space-between;padding:10px 18px;gap:10px}
nav a{color:var(--accent);text-decoration:none}nav a.off{visibility:hidden}
main{display:grid;grid-template-columns:1fr 320px;min-height:calc(100vh - 50px)}
aside{border-left:1px solid var(--line);background:var(--panel);overflow:auto}
aside h2{font-size:13px;letter-spacing:.08em;color:var(--muted);margin:0;padding:14px 16px 6px}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:10px;padding:10px 16px;cursor:pointer;border-left:3px solid transparent}
li:hover{background:#1f2330}li.active{border-left-color:var(--accent);background:#1d2436}
li img{width:88px;height:50px;border-radius:4px;object-fit:cover;background:#000;flex:none}
li b{display:block;font-weight:600}li small{color:var(--muted)}
.notes{padding:16px;border-top:1px solid var(--line)}.notes h3{margin:0 0 6px;font-size:14px}.notes pre{white-space:pre-wrap;font:inherit;color:var(--muted);margin:0}
@media(max-width:800px){main{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid var(--line)}}
`

/** 單一段落的播放頁（一個 SCO） */
function chapterPage(p: Project, segs: SegmentFile[], s: SegmentFile): string {
  const prev = segs.find((x) => x.index === s.index - 1)
  const next = segs.find((x) => x.index === s.index + 1)
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)} - ${esc(p.title)}</title><style>${STYLE}</style>
<script src="../scorm/api.js"></script></head><body>
<header><h1>${s.index}. ${esc(s.title)}</h1><span>${esc(p.title)} · ${formatTime(s.end - s.start)}</span><a href="../index.html">全部段落</a></header>
<video id="v" src="../segments/${s.name}" controls preload="metadata" playsinline></video>
<nav><a class="${prev ? '' : 'off'}" href="${prev ? `${num(prev.index)}.html` : '#'}">← ${prev ? esc(prev.title) : ''}</a><a class="${next ? '' : 'off'}" href="${next ? `${num(next.index)}.html` : '#'}">${next ? esc(next.title) : ''} →</a></nav>
<script>
(function(){var S=window.MyCAMScorm,v=document.getElementById('v'),done=false,last=0;S.init();
v.addEventListener('loadedmetadata',function(){var loc=parseFloat(S.location());if(loc>2&&loc<v.duration-3)v.currentTime=loc});
v.addEventListener('timeupdate',function(){if(!done&&v.duration&&v.currentTime/v.duration>0.9){done=true;S.save(v.currentTime,true)}else if(v.currentTime-last>10){last=v.currentTime;S.save(v.currentTime,false)}});
v.addEventListener('ended',function(){done=true;S.save(v.duration,true)});
window.addEventListener('pagehide',function(){S.save(v.currentTime,done);S.finish()});
window.addEventListener('beforeunload',function(){S.save(v.currentTime,done);S.finish()});
})();
</script></body></html>`
}

/** 總覽頁：段落清單 + 連續播放（也是一個 SCO） */
function indexPage(p: Project, segs: SegmentFile[]): string {
  const items = segs
    .map(
      (s) =>
        `<li data-i="${s.index}" data-src="segments/${s.name}"><img src="thumbs/${num(s.index)}.jpg" alt=""><div><b>${s.index}. ${esc(s.title)}</b><small>${formatTime(s.start, p.duration >= 3600)} · ${formatTime(s.end - s.start)}</small></div></li>`
    )
    .join('\n')
  const notes = p.notes ? `<section class="notes"><h3>補充說明</h3><pre>${esc(p.notes)}</pre></section>` : ''
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title><style>${STYLE}</style>
<script src="scorm/api.js"></script></head><body>
<header><h1>${esc(p.title)}</h1><span>${new Date(p.createdAt).toLocaleDateString('zh-TW')} · ${formatTime(p.duration, true)} · ${segs.length} 段</span></header>
<main><div><video id="v" controls preload="metadata" playsinline></video><nav><span id="now" style="color:var(--muted)"></span><span style="color:var(--muted)">播完自動接下一段</span></nav></div>
<aside><h2>段落索引</h2><ul id="ch">${items}</ul>${notes}</aside></main>
<script>
(function(){var S=window.MyCAMScorm,v=document.getElementById('v'),items=[].slice.call(document.querySelectorAll('#ch li')),cur=0;S.init();
function play(i,auto){cur=i;var li=items[i];items.forEach(function(x){x.classList.toggle('active',x===li)});v.src=li.getAttribute('data-src');document.getElementById('now').textContent=li.querySelector('b').textContent;if(auto)v.play();S.save(i+1,false)}
items.forEach(function(li,i){li.addEventListener('click',function(){play(i,true)})});
v.addEventListener('ended',function(){if(cur+1<items.length)play(cur+1,true);else S.save(items.length,true)});
var loc=parseInt(S.location()||'1',10);play(Math.min(Math.max(loc,1),items.length)-1,false);
window.addEventListener('pagehide',function(){S.finish()});
})();
</script></body></html>`
}

/** SCORM 1.2 imsmanifest.xml：總覽 + 每段落各一個 item / resource */
function manifest(p: Project, segs: SegmentFile[]): string {
  const id = `MYCAM_${p.id.replace(/[^A-Za-z0-9]/g, '_')}`
  const items = [
    `      <item identifier="ITEM_INDEX" identifierref="RES_INDEX" isvisible="true"><title>課程總覽（連續播放）</title></item>`,
    ...segs.map((s) => `      <item identifier="ITEM_${num(s.index)}" identifierref="RES_${num(s.index)}" isvisible="true"><title>${s.index}. ${esc(s.title)}</title></item>`)
  ].join('\n')
  const common = `      <file href="scorm/api.js"/>`
  const resources = [
    `    <resource identifier="RES_INDEX" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
${common}
${segs.map((s) => `      <file href="segments/${s.name}"/>\n      <file href="thumbs/${num(s.index)}.jpg"/>`).join('\n')}
    </resource>`,
    ...segs.map(
      (s) => `    <resource identifier="RES_${num(s.index)}" type="webcontent" adlcp:scormtype="sco" href="chapters/${num(s.index)}.html">
      <file href="chapters/${num(s.index)}.html"/>
      <file href="segments/${s.name}"/>
${common}
    </resource>`
    )
  ].join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG_1">
    <organization identifier="ORG_1">
      <title>${esc(p.title)}</title>
${items}
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>
`
}

function zipDir(dir: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(out)
    const archive = archiver.create('zip', { zlib: { level: 6 } })
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(dir, false)
    void archive.finalize()
  })
}

/**
 * 匯出旭聯智慧大師（WMPro）等 LMS 可用「教材匯入」直接安裝的 SCORM 1.2 教材包。
 * 每個段落是一個學習節點（SCO），播放時回報閱讀進度與完成狀態。
 * @returns zip 檔完整路徑（同時保留解壓後的 scorm/ 資料夾，可用 FTP 上傳）
 */
export async function exportScorm(p: Project, opts: ScormExportOptions, onProgress?: (r: number, msg: string) => void): Promise<string> {
  const pkg = join(p.dir, 'scorm')
  rmSync(pkg, { recursive: true, force: true })
  mkdirSync(join(pkg, 'chapters'), { recursive: true })
  mkdirSync(join(pkg, 'thumbs'), { recursive: true })
  mkdirSync(join(pkg, 'scorm'), { recursive: true })

  onProgress?.(0.01, '產生段落影片…')
  const segs = await exportSegments(p, {
    outDir: join(pkg, 'segments'),
    quality: opts.quality,
    naming: 'plain',
    onProgress: (r, m) => onProgress?.(0.01 + r * 0.8, m)
  })
  if (segs.length === 0) throw new Error('沒有可匯出的段落')

  onProgress?.(0.82, '產生縮圖與播放頁…')
  const src = join(p.dir, p.rawFile)
  for (const s of segs) {
    try {
      await makeThumbAt(src, Math.min(s.start + 0.5, p.duration - 0.2), join(pkg, 'thumbs', `${num(s.index)}.jpg`))
    } catch {
      /* 縮圖失敗不影響教材包 */
    }
    writeFileSync(join(pkg, 'chapters', `${num(s.index)}.html`), chapterPage(p, segs, s), 'utf8')
  }
  writeFileSync(join(pkg, 'index.html'), indexPage(p, segs), 'utf8')
  writeFileSync(join(pkg, 'scorm', 'api.js'), API_JS, 'utf8')
  writeFileSync(join(pkg, 'imsmanifest.xml'), manifest(p, segs), 'utf8')

  onProgress?.(0.9, '壓縮成 zip…')
  const safe = p.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'course'
  const zip = join(p.dir, `${safe}-SCORM.zip`)
  await zipDir(pkg, zip)
  onProgress?.(1, '完成')
  return zip
}
