# MyCAM — 課堂螢幕錄影與教材製作工具

類似 EverCam 的跨平台（Windows / macOS）螢幕錄影軟體，專為上課錄影、製作教材設計。

## 功能

- **螢幕錄影**：整個螢幕或單一視窗，麥克風 + 系統聲音（Windows），可疊加教師攝影機子母畫面。
- **分段落節點索引**：錄影中按快捷鍵（預設 `F8`）即時加入段落節點；錄完在編輯器調整標題與時間點。
- **錄影浮動控制列**：錄影時程式縮成右下角小工具列，且不會被錄進畫面。
- **匯出**
  - MP4（H.264/AAC，**內嵌章節**，VLC / QuickTime / PotPlayer 可直接顯示章節）
  - 依段落切割成多個 MP4
  - 離線 HTML 教材播放頁（影片 + 段落索引側欄 + 段落縮圖）
  - YouTube 章節時間軸文字
- **旭聯智慧大師（WMPro）/ SCORM 1.2 教材包**：每個段落一個學習節點（SCO），各自一支短影片與播放頁，播放時回報閱讀進度與完成狀態；另含「課程總覽（連續播放）」節點。在智慧大師用「課程管理 → 教材匯入」選 SCORM 1.2 即可自動建立學習路徑。
- **上傳 YouTube**：Google 帳號 OAuth 登入、續傳式上傳、說明欄自動帶入章節時間軸（YouTube 會自動顯示章節）。

## 開發

```bash
npm install
npm run dev
```

## 打包

```bash
npm run dist:win   # Windows：NSIS 安裝檔 + 免安裝版（dist/）
npm run dist:mac   # macOS：DMG + ZIP（需在 macOS 上執行）
```

自訂圖示：放入 `build/icon.ico`（Windows）與 `build/icon.icns`（macOS），並在 `electron-builder.yml` 的 `win` / `mac` 區段加上 `icon:`。

## YouTube 上傳設定

YouTube Data API 需要使用者自備 OAuth 用戶端：

1. 到 [Google Cloud Console](https://console.cloud.google.com/) 建立專案，啟用 **YouTube Data API v3**。
2. 「OAuth 同意畫面」選「外部」，把自己的 Google 帳號加入「測試使用者」。
3. 「憑證」→ 建立「OAuth 用戶端 ID」→ 類型選「電腦版應用程式」。
4. 在 MyCAM「設定」貼上 Client ID / Client Secret，儲存後按「登入 Google 帳號」。

> 注意：未經 Google 審核的 App，透過 API 上傳的影片會被 YouTube 鎖定為「私人」，可到 YouTube Studio 手動改為不公開／公開，或送審 App 解除限制。

## 匯入旭聯智慧大師（WMPro）

1. 在編輯器「匯出」區選「智慧大師（WMPro）/ SCORM 1.2 教材包」，畫質建議選「720p 精簡」（平台通常有單檔大小限制，教師手冊寫網頁上傳上限 64 MB，實際依各校設定）。
2. 產生的 `<標題>-SCORM.zip` 到智慧大師「課程管理 → 教材匯入」上傳，教材種類選 **SCORM 1.2**，學習路徑選「取代」或「附加在後面」。
3. 匯入後到「學習路徑管理」即可看到每個段落成為一個節點；學員讀完會記錄完成狀態。
4. 若 zip 太大無法用網頁上傳，同一資料夾下的 `scorm/` 目錄內容可用 FTP / Web 資料夾上傳到課程教材區，再在「學習路徑管理」手動把節點連到 `chapters/01.html`、`chapters/02.html`…（或 `index.html` 連續播放）。

## macOS 注意事項

- 第一次錄影時系統會要求「螢幕錄製」「麥克風」「攝影機」權限（系統設定 → 隱私權與安全性）。
- macOS 無法直接擷取系統聲音；若需錄電腦播放的聲音，請安裝 [BlackHole](https://existential.audio/blackhole/) 之類的虛擬音源，並在錄影設定中選為麥克風。

## 檔案結構

每次錄影在資料庫目錄（預設 `影片/MyCAM/`）建立一個資料夾：

```
20260916-140000-課程錄影/
├─ raw.mkv           原始錄影（錄影中為 raw.webm，結束後重新封裝以修正長度資訊）
├─ project.json      標題、段落索引、備註
├─ thumb.jpg         縮圖
├─ output.mp4        匯出的 MP4（含章節）
├─ index.html        HTML 教材播放頁
├─ thumbs/           段落縮圖
├─ segments/         依段落切割的 MP4
└─ chapters.txt      章節時間軸文字
```

## 技術架構

- Electron + Vite + React + TypeScript（electron-vite）
- 錄影：`desktopCapturer` + `getDisplayMedia` + `MediaRecorder`（WebM 串流寫入磁碟，長時間錄影不佔記憶體）
- 後製：`ffmpeg-static`（重新封裝修正長度、轉 MP4 內嵌章節、依段落精準切割、縮圖）
- YouTube：`googleapis` OAuth2（loopback）+ 續傳上傳
