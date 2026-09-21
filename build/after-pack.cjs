// electron-builder afterPack hook
// macOS：沒有 Developer ID 憑證時，對 .app 做 ad-hoc 簽章。
// Apple Silicon 上完全沒簽章（或簽章因改動而失效）的 App 會被系統直接判定為「已損毀」而無法啟動。
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') return
  // 有正式憑證時交給 electron-builder 自己簽
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  const entitlements = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')

  console.log(`  • ad-hoc signing  app=${appPath}`)
  // 內嵌的 ffmpeg 是獨立執行檔，--deep 不會涵蓋 Resources 下的一般檔案，先個別簽
  const ffmpeg = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg')
  try {
    execFileSync('codesign', ['--force', '--sign', '-', ffmpeg], { stdio: 'inherit' })
  } catch (e) {
    console.warn('  • ffmpeg ad-hoc sign skipped:', e.message)
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--entitlements', entitlements, appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--verbose=2', appPath], { stdio: 'inherit' })
}
