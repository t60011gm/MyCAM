// 將 docs/manual.md 轉成可離線開啟、可列印的 docs/manual.html（npm run docs）
const { marked } = require('marked')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const md = fs.readFileSync(path.join(root, 'docs', 'manual.md'), 'utf8')
const body = marked.parse(md, { gfm: true })
const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MyCAM 使用手冊</title>
<style>
body{max-width:860px;margin:0 auto;padding:32px 24px 80px;font:15px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif;color:#222;background:#fff}
h1{font-size:28px;border-bottom:2px solid #4f8cff;padding-bottom:8px}
h2{font-size:21px;margin-top:40px;border-left:4px solid #4f8cff;padding-left:10px}
h3{font-size:16px;margin-top:24px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid #d8dce4;padding:8px 10px;vertical-align:top;text-align:left}
th{background:#f2f5fa}
code{background:#f2f4f8;padding:1px 5px;border-radius:4px;font-size:13px}
pre{background:#f2f4f8;padding:12px;border-radius:6px;overflow:auto;font-size:13px}
pre code{background:none;padding:0}
hr{border:0;border-top:1px solid #e3e6ec;margin:32px 0}
a{color:#2f6fe0}
strong{color:#000}
@media print{body{padding:0;font-size:12.5px}h2{page-break-after:avoid}table,pre{page-break-inside:avoid}}
</style></head><body>
${body}
</body></html>`
fs.writeFileSync(path.join(root, 'docs', 'manual.html'), html, 'utf8')
console.log('docs/manual.html written', html.length, 'chars')
