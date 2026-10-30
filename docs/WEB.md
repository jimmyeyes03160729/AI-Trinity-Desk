# AI Trinity Desk 網頁版（Mac mini 駐點）

把 AI Trinity Desk 跑在一台常開的主機上（例如 Mac mini），其他電腦用瀏覽器連線操作。三個 CLI、AI 互相對話、Skills 市場、模型與額度等功能都和桌面版一樣，全部在**主機上**執行：專案檔案、CLI 登入狀態和對話紀錄都留在主機，瀏覽器只負責顯示畫面和輸入。

```
其他電腦的瀏覽器 ──HTTPS──▶ Tailscale／Cloudflare Tunnel ──▶ Mac mini：AI Trinity Desk Web（127.0.0.1:8765）
                                                                ├─ claude / codex / agy（PTY 終端）
                                                                └─ 專案資料夾、設定、討論紀錄
```

## 1. 在 Mac mini 安裝

需要 Node.js 22.12 以上版本。

```bash
git clone https://github.com/jimmyeyes03160729/AI-Trinity-Desk.git
```

```bash
cd AI-Trinity-Desk && npm ci && npm run web:build
```

先在前景啟動一次，確認可以正常執行：

```bash
npm run web:start
```

終端機會顯示網址（預設 `http://127.0.0.1:8765/`）和一組**設定碼**，例如 `K7QM-3XPA-R9TD`。

## 2. 第一次登入：建立唯一的帳號

1. 用瀏覽器開啟網址，會自動進入「建立登入帳號」頁。
2. 輸入 Mac mini 終端機顯示的**設定碼**，再設定帳號和密碼。
3. 建立後自動登入。這組帳號就是唯一的登入方式：**之後不能再新增帳號**，設定頁也會關閉。

設定碼的作用是：就算有人比你先打開網址，看不到 Mac mini 的終端機就無法搶先建立帳號。設定碼另外保存在資料目錄的 `setup-code.txt`（權限 0600），建立帳號後自動刪除。

已登入時，右上角有「帳號」（變更密碼）和「登出」。

### 帳號密碼怎麼保護

| 項目 | 做法 |
| --- | --- |
| 密碼保存 | 只保存 scrypt 雜湊（N=32768、r=8、每個帳號隨機 salt），不保存明文。`web-auth.json` 權限 0600 |
| 密碼強度 | 至少 12 個字元、不可包含帳號、不可大量重複字元。建議用密碼管理器產生 |
| 暴力破解 | 同一來源失敗 10 次鎖 15 分鐘，每次失敗延遲約 1 秒；錯誤一律回覆「帳號或密碼錯誤」，不透露是哪一項錯 |
| 登入狀態 | Cookie 設 `HttpOnly`、`SameSite=Strict`，走 HTTPS 時加 `Secure`，30 天到期。硬碟只存 token 的 SHA-256 雜湊 |
| 跨站攻擊 | 登入 API 和 WebSocket 都檢查 `Origin`，其他網站即使帶著你的 Cookie 也無法連線操作終端 |
| 變更密碼 | 要輸入目前密碼。變更後其他裝置全部登出 |
| 未登入 | 除了登入頁，所有頁面、程式檔和 WebSocket 都拒絕存取 |

**忘記密碼**：網頁上沒有重設入口，只能在 Mac mini 本機執行：

```bash
npm run web:reset-account
```

這會刪除帳號並登出所有裝置。重新啟動伺服器後會顯示新的設定碼，再重新建立帳號。

> 重要：登入網頁版等於能在 Mac mini 上用你的身分執行 CLI（CLI 本身可以執行指令、修改檔案）。請把這組密碼當成 Mac mini 的登入密碼來保管。

## 3. 從其他網路連線

伺服器預設只監聽 `127.0.0.1`，不會直接暴露在網路上。跨網路請透過下面任一種加密通道，**不要在路由器開 port 轉發未加密的 HTTP**。

### 使用現有網站的 `/desk/` 路徑

可設定 `TRINITY_BASE_PATH=/desk`，讓登入、API、終端 WebSocket 和 Cookie 都使用 `/desk/` 路徑。未設定時仍使用根目錄。本機測試：

```bash
TRINITY_BASE_PATH=/desk npm run web:start
```

開啟 `http://127.0.0.1:8765/desk/`。macOS 常駐服務安裝時同樣需要設定 `TRINITY_BASE_PATH=/desk`；環境變數在安裝時寫入設定，修改後須重新執行 install。

例如 `https://jimmyeyes.com/desk/`：需要在現有網站的 Cloudflare 路由中，將 `/desk` 和 `/desk/*`（包括 WebSocket）導向 Mac mini 的服務，其他路徑維持原有來源。路由須保留 `/desk` 前綴；Cloudflare Tunnel 本身不會移除路徑。現有網域已有網站，不能只把其 DNS 改到 Tunnel，應先確認現有設定及路由方案，並測試 HTTPS、登入、WebSocket、重連及其他網站路徑。專案目前沒有自動建立這些 Cloudflare 設定。

### 方案 A：Tailscale（推薦，只有你的裝置能連）

1. 在 Mac mini 和要連線的電腦都安裝 [Tailscale](https://tailscale.com/download)，並登入同一個帳號。
2. 在 Mac mini 執行以下指令，提供 HTTPS 網址：

```bash
tailscale serve --bg 8765
```

3. 用 `tailscale serve status` 查看網址（例如 `https://mac-mini.xxxx.ts.net`），並設定允許的來源：

```bash
export TRINITY_ALLOWED_ORIGINS=https://mac-mini.xxxx.ts.net TRINITY_TRUST_PROXY=1
```

### 方案 B：Cloudflare Tunnel（任何電腦用自己的網域連線，不用裝軟體）

1. 依 [Cloudflare Tunnel 文件](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) 建立 tunnel，把 `desk.你的網域.com` 指到 `http://127.0.0.1:8765`。
2. 強烈建議再加一層 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)（例如只允許你的 email 用一次性驗證碼通過）。這樣在輸入帳號密碼之前，還要先過一關。
3. 設定允許的來源：

```bash
export TRINITY_ALLOWED_ORIGINS=https://desk.你的網域.com TRINITY_TRUST_PROXY=1
```

`TRINITY_TRUST_PROXY=1` 讓伺服器讀取代理轉發的真實來源 IP，失敗次數限制才會依每個來源分開計算。只在伺服器監聽 `127.0.0.1` 並經由代理連線時才設定。

## 4. 設成常駐服務（開機自動啟動、當機自動重啟）

先設定好需要的環境變數，再安裝 LaunchAgent。安裝時的 `TRINITY_*` 變數會寫入服務設定：

```bash
TRINITY_ALLOWED_ORIGINS=https://mac-mini.xxxx.ts.net TRINITY_TRUST_PROXY=1 scripts/macos-web-service.sh install
```

查看記錄檔（第一次的設定碼也在這裡）：

```bash
scripts/macos-web-service.sh logs
```

其他指令：`restart`、`status`、`uninstall`。更新程式後，執行 `git pull && npm ci && npm run web:build`，再執行 `restart`。

另外請到「系統設定 → 能源」關閉自動睡眠，否則 Mac mini 睡著後就連不上。

## 5. 使用時跟桌面版不同的地方

- **選擇專案**：會開啟主機資料夾瀏覽視窗。預設只能選家目錄底下的資料夾，可用 `TRINITY_PROJECT_ROOTS` 改範圍（多個用 `:` 分隔）。
- **多裝置共用**：所有瀏覽器看到的是同一組終端。重新整理頁面或從另一台電腦開啟，會自動接上執行中的 CLI，並重播最近約 512 KB 的輸出。不同裝置視窗大小不同時，以最後調整大小的裝置為準。
- **斷線**：瀏覽器斷線不會停止 CLI，恢復連線後會自動重新載入並接回。伺服器停止時才會停止全部終端。
- **剪貼簿**：用 HTTPS 連線時，複製／貼上按鈕可直接使用。在終端內按 Ctrl+V／⌘V 一律使用瀏覽器原生貼上。
- **CLI 登入**：在網頁終端第一次執行 `claude`、`codex`、`agy` 時，若 CLI 要求登入，把終端顯示的登入網址複製到你的瀏覽器完成即可。
- **Skills 市場的連結**：會在你的瀏覽器開新分頁，不會在 Mac mini 上開啟。
- 網頁版和桌面版的資料目錄分開（macOS 為 `~/Library/Application Support/AI Trinity Desk Web`），兩者可以同時存在。

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `TRINITY_WEB_HOST` | `127.0.0.1` | 監聽位址。使用 Tailscale 或 Cloudflare 時維持預設 |
| `TRINITY_WEB_PORT` | `8765` | 連接埠 |
| `TRINITY_BASE_PATH` | 空 | 網頁路徑前綴，例如 `/desk`；根目錄保留空值 |
| `TRINITY_ALLOWED_ORIGINS` | 空 | 允許的網址來源，例如 `https://desk.example.com`，多個用逗號分隔 |
| `TRINITY_TRUST_PROXY` | 關 | 設 `1` 時讀取 `X-Forwarded-*`／`CF-Connecting-IP` |
| `TRINITY_PROJECT_ROOTS` | 家目錄 | 可選為專案的資料夾範圍 |
| `TRINITY_DATA_DIR` | 見上方 | 設定、帳號與討論紀錄的位置 |
| `TRINITY_TLS_CERT`／`TRINITY_TLS_KEY` | 空 | 由伺服器直接提供 HTTPS 時使用的憑證檔路徑 |

## 開發與測試

```bash
npm run web:build && TRINITY_CHROMIUM=/path/to/chromium npm run test:web
```

`tests/web-e2e.mjs` 會在暫存目錄啟動伺服器，用真實瀏覽器驗證以下項目：設定碼建立帳號、拒絕第二個帳號、弱密碼、錯誤密碼、跨站登入與 WebSocket、資料夾範圍、終端輸入輸出與大量輸出、重新整理後接回、兩台裝置共用終端、變更密碼使其他裝置登出，以及登出。測試使用本機假 CLI，不會送出真實 AI 請求。
