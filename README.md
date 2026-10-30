# AI Trinity Desk V1.3.0

> 公開儲存庫不包含本機測試紀錄、截圖與安裝產物；以下歷史驗證紀錄的 evidence 與 VALIDATION 參照僅適用於原始本機交付包。

以 Electron + React + TypeScript + xterm.js + node-pty 建立的本機桌面工作台，同時顯示 Claude Code、Antigravity CLI 和 Codex CLI。Windows x64 為主要目標，提供 macOS 原生架構建置設定。

## 網頁版：放在 Mac mini 駐點，其他電腦用瀏覽器連線

除了桌面版，也可以把 AI Trinity Desk 跑成網頁伺服器，其他電腦透過 Tailscale 或 Cloudflare Tunnel 在不同網路直接開網頁使用。第一次開啟時用主機顯示的設定碼建立唯一的帳號密碼，之後不能再新增帳號。安裝、連線方式與安全說明見 [docs/WEB.md](docs/WEB.md)。

## 安裝與開始

Windows 使用 `release/AI-Trinity-Desk-1.3.0-win-x64.exe` 安裝，可選安裝位置，預設安裝到目前使用者。安裝包包含 Electron 與終端元件。開啟時會自動檢查並安裝缺少的三家官方 CLI，不需要先裝 Node.js；帳號登入仍由你完成。

1. 開啟 AI Trinity Desk，查看「CLI 自動安裝」面板，等待缺少的工具完成安裝。
2. 按「選擇專案…」選擇工作資料夾。如使用自訂執行檔，可在「設定」調整命令與參數。
3. 按「環境檢查」，確認執行檔是否存在。
4. 各欄按「啟動」，直接在終端輸入。可分別停止、重啟、清屏。
5. 拖曳分隔線調整大小；也可以切換三欄／三列。「平均」恢復預設比例。

開啟程式時**不會自動啟動 CLI**。終端執行時必須先停止才能切換專案。關閉視窗時若有程序仍在執行，會提示是否停止全部並關閉。

### 共用或各自的專案資料夾

專案列右側可切換「共用資料夾」與「各自資料夾」（需先停止所有終端）。共用時三個 AI 在同一個資料夾工作；各自資料夾時，專案列會列出每個 AI 的資料夾，分別按「選擇…」設定，只需停止該 AI 的終端即可切換。尚未設定的 AI 沿用共用資料夾。模式與各資料夾都會保存。

## V1.2.0：Skills 一鍵安裝、來源 Summary 中文翻譯

1. 開啟「Skills 熱門市場」，在「安裝所屬 AI」勾選 Claude Code、Codex CLI、Antigravity CLI，可複選。
2. 找到需要的 Skill，按「一鍵安裝至所選 AI」。不需要額外安裝 Node.js、npm 或 Git。
3. 每張卡片分別列出各 AI 的下載／安裝／完成／失敗狀態；展開「位置與紀錄」查看目錄、來源版本與檔案雜湊。安裝成功後，重開對應 CLI 載入。

| 所屬 AI | 使用者 Skills 位置 |
| --- | --- |
| Claude Code | `~/.claude/skills/<skill>` |
| Codex CLI | `~/.agents/skills/<skill>` |
| Antigravity CLI（agy） | `~/.gemini/antigravity-cli/skills/<skill>` |

`~` 是目前使用者家目錄，Windows 通常為 `C:\Users\你的名稱`；這是使用者層級安裝，可供不同專案使用。Codex 的 `.agents/skills` 是標準共享位置，也可能由支援此位置的其他代理讀取；安裝標示表示寫入對應目錄，並非專屬授權或實際載入偵測。Antigravity CLI 與 Antigravity IDE 的 Skills 位置不同，本程式針對 CLI。

安裝直接讀取已登錄市場項目的 GitHub 來源，固定至下載時取得的 commit，再從 ZIP 找到名稱相符且具有描述的 SKILL.md，只複製該 Skill 目錄。拒絕越界路徑、符號連結與不支援的檔名；封存下載上限 64 MiB，單個 Skill 最多 500 檔／25 MiB。先寫入暫存目錄，完整後才移入目的位置。遇到既有同名位置保留原檔並顯示「同名既有，未覆寫」，不冒稱由本程式安裝。可取消下載或尚未完成的安裝，已完成的目標保留。安裝不執行 Skill 腳本，也不自動補裝其外部依賴；真正使用時仍依各 CLI 的權限與相容性。

市場會讀取技能詳細頁真正的 **Summary 大綱**，使用選定的現有 AI CLI 翻成繁體中文名稱與用途說明，不以名稱猜測功能。預設自動翻譯目前可見的卡片，可關閉或改選翻譯 AI，也能逐張按「讀取並翻譯 Summary」。**翻譯沿用既有登入與模型，計入該 AI 帳號用量**，不另輸入 API 金鑰。每次最多四項，翻譯僅傳公開名稱與 Summary，提示禁止執行其中指令；不傳專案內容。失敗時保留原文與錯誤提示，可重試，不假造中文摘要。可展開原文、來源時間並查看翻譯 AI。

Summary 快取 24 小時；同一份內容重用中文翻譯，來源內容變更才重新翻譯。本機 `skill-summaries.json` 保存公開摘要與翻譯，`skill-installations.json` 保存安裝位置、commit 與狀態。它們位於 Electron 使用者資料目錄，與既有設定／討論紀錄分開。重新整理市場仍遵守 Summary 快取期限。市場網頁若改版或沒有 Summary，會顯示讀取失敗。

專案推薦沿用本機技術偵測，並讀取最多六個名稱符合專案技術的新增候選 Summary，從實際大綱補充技術標籤與推薦理由；可見的推薦卡片再翻成中文。匹配可能有誤，仍需核對原文。取得特定公開頁面會向該網站揭露所瀏覽的 Skill，但不傳專案路徑、內容或套件清單。AI 互相對話仍維持既有純文字討論流程，不因市場安裝而自動套用 Skills。

位置依據：[官方 Skills CLI 支援的 AI 目錄](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)、[Codex Skills](https://learn.chatgpt.com/docs/build-skills)、[Antigravity Skills](https://www.antigravity.google/docs/skills?tab=cli)。

## Skills 熱門市場與專案推薦

按右上「Skills 熱門市場」，可以瀏覽：

- **專案推薦**：先選擇專案，依本機偵測到的框架、語言、測試與資料檔案類型，列出適合參考的 Skills。每項顯示對應證據，例如 package.json 的 React 依賴；不是必要安裝清單，也未深入審閱所有需求。
- **熱門排行**：顯示 skills.sh 公開累計榜的 GitHub 來源項目、來源榜名次與安裝數，附取得時間。名次可能因非 GitHub 來源被略過而不連續。
- **近期趨勢**：讀取來源網站的趨勢榜，以「趨勢榜數值」呈現該榜資料，不把它混稱為本機使用量或訂閱額度。
- **搜尋**：可輸入英文或中文；中文也會匹配內建已整理的用途摘要。手動輸入的搜尋字詞會送到 skills.sh 公開搜尋端點。

卡片提供用途說明、摘要來源程度與「市場介紹／GitHub 來源」按鈕。尚未讀取 Summary 的項目會明確標示；內建中文摘要只作為初始參考，來源 Summary 翻譯完成後替換。中文說明不代表安全審核。

推薦分析僅在本機進行：最多處理 150 個資料夾、2,500 個檔案名稱、4,000 個目錄項目，深度最多三層。只讀有限大小的 package.json 與 Python 套件清單，擷取框架／依賴名稱；其餘以副檔名判斷。略過 .git、node_modules、虛擬環境、產物目錄、.env／憑證類檔名及連結資料夾。掃描有上限或部分檔案不可讀時會標示。不把專案內容、路徑或套件資訊送至市場或翻譯 AI，不執行專案腳本。使用已整理的確定來源與實際 Summary 技術訊號，不僅以同名或高安裝數判斷。

市場資料透過 Electron 系統網路連線讀取公開網頁與官方 CLI 使用的公開搜尋端點，不需要 Vercel OIDC 帳號。不使用需要認證的 v1 API，也不繞過登入。這些公開網頁／未版本化端點可能變更，失敗時會明確提示；有快取時標示舊資料，沒有快取則只顯示內建參考清單，沒有虛構的安裝數。排行快取 15 分鐘、搜尋快取 5 分鐘，可手動重新整理；本機 market-cache.json 只保存排行資料，不保存搜尋字詞與專案內容。

安裝數只反映來源網站的統計，不代表品質、安全性、已安裝狀態或每一家 CLI 的相容性。請開啟來源核對用途。本次已實際取得熱門榜、趨勢榜、React 搜尋及 AI Trinity Desk 專案推薦，結果見 evidence/market-live-check.json。

資料來源與整合依據：[skills.sh 公開市場](https://www.skills.sh/)、[市場說明](https://www.skills.sh/docs)、[官方 Skills CLI 搜尋實作](https://github.com/vercel-labs/skills/blob/main/src/find.ts)。

## V1.0.6：自由調整回答順序

「AI 互相對話」左側的「參與的 AI 與回答順序」提供 ↑／↓ 按鈕，可用滑鼠或鍵盤操作。畫面會列出目前順序，例如 Codex → Antigravity → Claude；每輪都按此順序回答，最後一位負責綜合總結。取消勾選會移出順序，再勾選會加入末位，可重新上移。

開始新討論前可自由排序；完成或停止後，接續前也可重排**原本相同的一組成員**，既有發言及討論編號會保留，新順序從追加輪次開始生效。每段接續紀錄與複製出的文字都會標示該段順序，重開後保留最近使用的順序。執行中不允許排序；逾時重試仍按該次原順序重試未完成的 AI。若要增減成員，請另開新討論。

V1.0.5 保存的討論可直接還原；沒有歷史順序欄位時沿用原有成員順序。本次使用本機測試 CLI 驗證三家重排、兩家接續改序與保存還原，未額外送出真實 AI 請求。

## V1.0.5：接續討論、延長等候與一致時停止

討論完成後，在「補充問題或分歧」輸入尚未解決的問題，選擇追加輪數，再按「接續討論」。留空也可要求繼續釐清分歧。原始主題、成員、明確指定的模型、發言與補充重點會保留於同一場討論，輪次接續編號，無須重新開始或手動複製。接續沿用原本的提前停止設定；可重排原成員的回答順序；更換成員或主題則用「開始新討論」。

- 等待 AI 回覆時，可按「延長等候 +3 分鐘」，延長目前同一個請求，單次最多延長至 30 分鐘。
- 若已逾時，先選擇較長的「每次回覆等候」，再按「延長並重試這次回覆」。只重試未完成的那位 AI，不重跑已完成發言，也不新增一場討論；重試仍計入各家帳號用量。
- 進入本次最後一輪時，**每位 AI** 都會收到最後一輪提示並要求各自總結；最後一位再綜合所有人的結論。
- 預設啟用「全員明確表示一致時提前停止」。必須同一輪全部參與者都以明確標記表示一致，才停止後續輪次；自然語言看似同意、缺少標記、仍有 OPEN 標記或只部分 AI 同意，都不會觸發。每次發言皆要求簡述目前結論，提前停止時保留該輪結論，不為補足輪數送出更多請求。這是 AI 自行表示的一致，不能當成客觀正確性驗證。
- AI 的一致標記由程式辨識後不顯示在正文；介面顯示「全員表示一致，已提前結束」。仍可補充新分歧後按「接續討論」。

最新一場討論自動保存到 Electron 使用者資料目錄的 `discussions/latest.json`（Windows 通常是 `%APPDATA%\AI Trinity Desk\discussions\latest.json`），為本機明文紀錄，不含登入憑證。重開程式會還原，不會自動發送 AI 請求；未完成的回覆可手動接續。若保存失敗會顯示警告，損壞檔案不會在讀取時被覆寫。

「開始新討論」會取代最新一場紀錄；未解決的分歧請用「接續討論」。介面保留整場文字；傳給 AI 的前文仍限最近 48,000 字元的完整發言及最近八份補充重點，省略數會寫入提示。本機保存上限 8 MiB。**V1.0.4 沒有保存過的記憶體紀錄無法自動移轉；本版起的新討論才具有重開還原能力。**

## V1.0.4：AI 互相對話（不需 Skills）

1. 在「模型與額度」選好各家模型；留空沿用 CLI 預設。討論開始時會固定本次模型。
2. 按右上「AI 互相對話」，輸入討論主題及背景，不需要先啟動終端或選擇專案。
3. 勾選兩至三個 AI、選擇一至五輪及每次回覆等候時間，按「開始討論」。
4. 依你排好的回答順序（預設 Claude → Antigravity → Codex），輪流將已完成回覆交給下一位；未勾選的 AI 直接略過。**取消 Antigravity 時，Claude 與 Codex 仍會互相對話**；一輪是兩者各發言一次。
5. 最後一輪每位都會被要求總結，最後一位綜合共識、分歧、待確認事項與下一步。「停止討論」會中止目前請求及後續輪次；「複製討論紀錄」可另存文字／Markdown。

討論進行時鎖定參與名單、主題與輪數，修改模型設定也不影響當次討論。若要更換成員，先停止，再開始新討論；新討論會清除工作台內上一場紀錄，請先複製需要保留的內容。收合討論面板會繼續執行，可隨時回來查看。

沿用目前設定的官方 CLI 執行檔、登入及模型，在應用程式資料目錄建立獨立討論工作階段；**不接續目前三個互動終端的歷史，也不以選取的專案作為討論目錄**。只有使用者填入的主題及討論文字會由工作台轉交。討論內容會送給所選的 AI 並計入各家帳號用量。V1.0.5 起，最新一場工作台討論會自動保存於本機；各 CLI 自身的歷史及服務留存依各家工具設定。

互相對話不要求使用 Skills，也不增加 API 金鑰輸入。Claude 使用官方 print JSON 模式並關閉工具／斜線命令；Codex 使用 `exec --json` 與 read-only；Antigravity 使用 stdin／stdout 串流 JSON、plan 模式與終端限制。提示要求僅做文字討論；本功能不提供自動修改專案或部署流程，也不開啟略過權限的旗標。既有使用者／管理員 CLI 設定仍由該 CLI 管理。

每次只允許一場討論，每次開始或接續最多十五次回覆、本場累計最多 150 次回覆及 20 次接續；遇到錯誤、逾時或無效／不完整結果時停止，保留之前的完整回覆，不自動重試或無限循環。單次回覆上限 12,000 字元，轉交最近最多 48,000 字元的完整發言；較舊發言若被省略，會在提示中標示。自訂啟動參數目前僅支援 `--model`／`-m`，其他參數會要求先調整，不會偷偷改成另一個帳號。

本次已用目前電腦既有登入完成 Claude → Antigravity → Codex 一輪真實測試：後兩位分別收到前一份、前兩份回覆。另以測試 CLI 驗證 Claude／Codex 兩者兩輪、停止、失敗保留紀錄、收合與複製。證據與限制見 `VALIDATION.md`。

整合依據：[OpenAI Docs：Codex 非互動模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[Claude 程式化使用](https://code.claude.com/docs/en/headless)、[Antigravity Headless 模式](https://antigravity.google/docs/cli/headless/)。

## V1.0.3 顯示、熱鍵、模型與帳號額度

右上「顯示欄位」可以自行勾選 Claude Code、Antigravity CLI、Codex CLI，至少保留一欄，選擇會保存。只顯示一欄時自動使用全部終端空間。隱藏欄位不會停止該 CLI，也不會清除對話；底部會標示隱藏的執行中工作，重新勾選可回到原本工作階段。請先停止不需要繼續工作的 CLI 再隱藏。

修正 Claude／Codex 滿版終端底部被裁切：終端外框留白與實際內容區分開計算，最後一列不會被程式自己的狀態列蓋住。支援視窗縮放及顯示放大後重新計算。

右上「模型與額度」或各欄「模型」按鈕會開啟模型選單與帳號額度面板，也可按「手動輸入其他模型 ID」填入模型 ID／別名。留空使用該 CLI 原本的模型設定，指定值會在下次啟動以 `--model` 套用。正在進行的對話不會被自動重啟。要在目前對話切換，請自行在 CLI 輸入 `/model`，使用各家工具提供的帳號可用清單。實際模型與額度依帳號／供應商決定。

帳號額度顯示已用、剩餘百分比與重置時間；僅在服務回傳資料時顯示數字，缺少資料不視為零使用量。開啟面板時讀取，面板保持開啟且視窗可見時每 60 秒更新，也可手動重新整理。每次資料都標示來源與更新時間。

| CLI | 模型選擇 | 帳號已用／剩餘／重置時間 |
| --- | --- | --- |
| Codex | 從目前 CLI 的 `model/list` 讀取，另可手動填 ID | 從官方 `account/rateLimits/read` 讀取帳號額度視窗；實際登入方式可能不提供額度 |
| Claude Code | 提供官方 `opus`、`sonnet`、`haiku` 別名，另可手動填 ID | 尚無本次可用的穩定非互動介面；在 Claude 終端輸入 `/usage` 查看 |
| Antigravity | 嘗試讀取 `agy models`，另可手動填 ID | 嘗試原生 `agy --print /usage`；失敗則顯示原因與手動 `/usage` 提示，地區限制仍適用 |

Codex 額度查詢只使用官方 CLI 的初始化、模型清單與帳號額度方法，不建立 AI 對話。Antigravity 強制啟用其原生斜線指令後取得用量報告。程式不擷取登入憑證、不呼叫未公開的帳號網頁介面、不推估訂閱剩餘額度。若啟動命令帶自訂參數，額度面板會要求使用 CLI 內建指令，避免查到與工作階段不同的帳號。模型設定是「下次啟動偏好」，不是目前工作階段模型的即時偵測。

模型設定參考：[Codex](https://learn.chatgpt.com/docs/models?surface=cli)、[Claude Code](https://code.claude.com/docs/en/model-config)、[Antigravity CLI](https://antigravity.google/docs/cli/reference/)。三家 CLI 的本機 `--help` 也已確認支援 `--model`。

Antigravity 若回覆 `FAILED_PRECONDITION (code 400): User location is not supported for the API use`，屬 Google 服務的地區／資格限制，介面會清楚提示，重裝或切換模型不會解除服務限制。Claude 的 HTTP 403 也會區分為服務連線遭拒；這些不會被假報為安裝失敗。本版本不改動登入、地區、代理、VPN 或安全設定。

## V1.0.2 安裝修正

Windows 的 Claude Code 與 Codex 改用官方 npm 發佈的原生執行檔，安裝在 `%APPDATA%\AI Trinity Desk\clis`，不需要 Node.js 或 npm。程式只讀取兩家官方主套件指定的 Windows 平台依賴，核對 SHA-512、檢查封存路徑並執行 `--version`，通過後才提供啟動命令。官方腳本仍供 Antigravity 與 macOS 使用。

大型下載使用系統網路連線，斷線會保留進度並續傳；完整檔案仍須通過校驗。安裝紀錄保存在 `installers/claude.log`、`codex.log`、`antigravity.log`，關閉程式後仍可查核。既有 CLI 與自訂命令保持優先。

本次已實際安裝並驗證 Claude Code 2.1.312、Codex CLI 0.165.0；既有 Antigravity CLI 1.4.9 也通過版本檢查。未登入 AI 帳號或送出任務，未操作 EasyStock 或 VM。從舊版更新時請先關閉舊程式，再執行新版安裝包；新版會沿用設定並找到已準備好的工具。

## CLI 自動安裝

預設啟用「開啟時自動安裝缺少的官方 CLI」，可在設定關閉。三個安裝依序執行，顯示下載、安裝、完成或錯誤，不顯示虛構百分比。每項可取消或重試；每次啟動只自動嘗試一次，不會無限重試。已找到的工具會略過，不強制升級既有版本。自訂執行檔由你管理，不會被自動安裝替換。

| CLI | Windows 官方腳本 | macOS 官方腳本 |
| --- | --- | --- |
| Claude Code | `https://claude.ai/install.ps1` | `https://claude.ai/install.sh` |
| Antigravity (`agy`) | `https://antigravity.google/cli/install.ps1` | `https://antigravity.google/cli/install.sh` |
| Codex | `https://chatgpt.com/codex/install.ps1` | `https://chatgpt.com/codex/install.sh` |

腳本安裝來源已依 [Claude Code 官方安裝文件](https://code.claude.com/docs/en/setup)、[Antigravity 官方入門文件](https://antigravity.google/docs/getting-started?tab=cli) 及 [OpenAI Docs 的 Codex CLI 文件](https://learn.chatgpt.com/docs/codex/cli) 核對。Claude 來源可重新導向官方 `downloads.claude.ai`，Codex 可重新導向官方 `releases.openai.com`。下載使用 Electron 系統網路連線，以沿用系統代理設定。

程式下載固定 HTTPS 來源的官方腳本，檢查重新導向主機、大小與非 HTML 內容，保存腳本及 SHA-256 供追溯，再由 PowerShell／Bash 執行。雜湊是本次下載紀錄，不代表額外的供應商簽章驗證。Windows 只對該次安裝子程序使用 ExecutionPolicy Bypass，不修改系統政策；企業群組政策仍可能阻擋執行。

工具依官方安裝器安裝到目前使用者位置；官方安裝器可能更新使用者 PATH 或 shell 設定。程式會補入已知安裝目錄，完成後可立即使用，不必重開。取消會停止安裝程序及其子程序，但已下載或部分安裝的檔案可能保留，可重試完成安裝。腳本與目前畫面的紀錄位於應用程式設定目錄及面板，不寫入選取的專案。

## CLI 設定

| 欄位 | 預設執行檔 | 說明 |
| --- | --- | --- |
| Claude Code | `claude` | 可使用 PATH 上的命令或完整路徑 |
| Antigravity CLI | `agy` | Google 官方 CLI；舊版預設佔位命令會自動遷移，自訂命令保留 |
| Codex CLI | `codex` | 可使用 PATH 上的命令或完整路徑 |

「執行檔」只放命令名稱或絕對路徑，不要附加引號、參數、管線或 `&&`。含空白的路徑直接填入即可。啟動參數為 JSON 字串陣列，例如：

```json
["--help"]
```

不需要參數則填 `[]`。如需 shell 語法，明確指定 `powershell.exe` 或 `/bin/zsh` 並自行提供參數。Windows 的 `.cmd`、`.bat`、`.ps1` 啟動器由 PowerShell 以字面值引號轉接；不會自動略過系統執行原則。

範例：Windows 若 Codex 安裝在 npm 的使用者目錄，可把實際的 `C:\Users\你的名稱\AppData\Roaming\npm\codex.cmd` 填入執行檔。請以你電腦的實際位置為準。

「環境檢查」只確認執行檔位置，不會執行 CLI、驗證登入、確認網路服務或扣用量。程式內自動安裝後可立即使用；在其他程式改動 PATH 時可重開本程式。macOS 從 Finder 啟動時會嘗試讀取登入 shell 的 PATH；失敗時可填入完整路徑。

## 終端操作

- Windows：選取文字後 `Ctrl+C` 複製、`Ctrl+V` 貼上；另保留 `Ctrl+Shift+C / V`。沒有選取文字時，`Ctrl+C` 保留 CLI 中斷功能。
- macOS：`⌘C` 複製選取文字、`⌘V` 貼上。
- 也可使用每欄的「複製」、「貼上」按鈕。貼上使用 xterm bracketed paste；CLI 如何處理多行內容取決於該工具。
- 滑鼠拖曳分隔線，或將鍵盤焦點移到分隔線後使用方向鍵調整。
- 字體 10–24 px、排列方向、比例、CLI 設定及專案路徑會保存；終端輸出與工作階段不保存。

## 從原始碼執行

建議 Node.js 24 LTS 與 npm。第一次安裝需要網路下載依賴與 Electron。

```powershell
npm ci
npm run dev
```

`dev` 啟動本機 Vite 及 Electron。修改 React 介面會熱更新；修改 `electron/` 後請停止並重跑 `npm run dev`。

```powershell
npm test
npm run typecheck
npm run test:e2e
npm run build
npm start
npm run dist:win
```

若打包時下載 Electron 遇到網路逾時，而 `npm start` 已可正常開啟，可以重用相同版本、相同架構的本機 Electron：

```powershell
npm run build
npx electron-builder --win nsis --x64 --config.electronDist=node_modules/electron/dist
```

Windows 安裝包輸出至 `release/`，`release/win-unpacked/` 為解包後的應用程式。建議 Windows 11 x64，最低須具備 Windows 10 1809 以上的 ConPTY 支援並符合所用 Electron 的系統需求。

node-pty 1.1 使用 Node-API 原生元件，已隨 npm 套件附帶常見平台的預編譯檔，因此本專案停用 electron-builder 的無條件原生重編。`postinstall` 會檢查元件存在並可載入。若你自行修改 node-pty、使用未提供預編譯檔的平台或需要從原始碼編譯，安裝 Windows Visual Studio Build Tools「使用 C++ 的桌面開發」（含 Windows SDK，必要時安裝 Spectre 程式庫）及 Python，然後執行 `npm run rebuild:native`。macOS 從原始碼重編則需要 Xcode Command Line Tools。

## macOS 建置

請在 macOS 上建置，以確保 node-pty 及平台包裝工具相容：

```bash
npm ci
npm test
npm run test:e2e
npm run dist:mac          # 本機架構，產生 dmg 與 zip
npm run dist:mac:arm64    # Apple Silicon
npm run dist:mac:x64      # Intel
```

Apple Silicon 與 Intel 分別產生安裝包；本版不產生 universal 包。`build/entitlements.mac.plist` 提供 Electron JIT 權限設定。正式發佈時請使用自己的 Apple Developer 憑證簽署並公證，可透過 electron-builder 的 `CSC_LINK`、`CSC_KEY_PASSWORD` 及 Apple 公證設定配置；不要把憑證或密碼提交進原始碼。沒有憑證時可設定 `CSC_IDENTITY_AUTO_DISCOVERY=false` 產生未簽署測試包，Gatekeeper 可能阻擋開啟。

`.github/workflows/build.yml` 提供 Windows 與 macOS 的測試、建置及產物上傳流程。這只是原始碼設定；本次沒有建立遠端儲存庫或觸發雲端建置。

## 資料與權限

設定位置使用 Electron `userData/settings.json`，通常為：

- Windows：`%APPDATA%\AI Trinity Desk\settings.json`
- macOS：`~/Library/Application Support/AI Trinity Desk/settings.json`

設定為 JSON，啟動參數會以明文保存；不要把 API 金鑰或密碼放在參數中。各 CLI 沿用使用者自己的登入資訊及程式環境。應用程式自動安裝缺少的官方 CLI；Skills 僅在按一鍵安裝時下載。不代管帳號、不傳送遙測、不保存終端紀錄。AI CLI 自身的網路行為與資料傳送由各工具控制。

介面使用本機檔案、關閉 Node integration、啟用 context isolation 與 renderer sandbox；preload 只公開固定用途方法。主程序檢查 IPC 來源主框架、pane ID、工作階段 token、輸入長度及終端尺寸，拒絕額外欄位；不提供任意檔案讀寫、任意 IPC channel 或任意命令 RPC。啟動只能使用已儲存的三組命令與透過系統對話框選出的專案。禁止新視窗、外部導航與 webview，並拒絕網頁權限要求。

**PTY 是與你相同權限執行的本機程序，不是程式碼安全隔離環境。** 設定中的命令以及在 CLI 內輸入的操作都能影響你的檔案。三欄使用同一資料夾，請協調修改範圍；Git worktree 自動隔離列為後續增強。Skills 可一鍵安裝至所選 AI 的使用者目錄；重開互動 CLI 後由該工具載入及依其規則使用。

## 測試範圍

`npm test` 驗證 IPC 資料限制、設定格式／保存／損壞檔案處理、PATH 搜尋及 Windows 引號處理。`npm run test:e2e` 使用 Playwright 開啟真正 Electron 視窗，在專用測試資料夾啟動三個 Node 測試 CLI，驗證互動 PTY、程序隔離、重啟、子程序停止、剪貼簿、縮放、非零退出、輸出壓力、設定重啟保存及缺少命令的錯誤提示。

自動安裝測試涵蓋固定官方來源、舊設定遷移、PATH 更新、序列與去重、略過既有／自訂命令、下載失敗、重試、取消、安裝後找不到工具，以及真實本機安裝測試程序的輸出、錯誤碼和子程序停止。桌面測試停用真實廠商安裝，避免覆寫測試機的工具。`npm run test:install-sources` 是只下載官方腳本、不執行的網路診斷。

自動桌面測試使用測試 CLI 與明確標示的合成額度資料，不登入或送出 AI 任務；包含獨立的 `tests/discussion-e2e.mjs` 討論面板驗證。另有以本機既有登入進行的官方模型／帳號額度唯讀檢查與一次三家 AI 真實文字接力；摘要見 `evidence/provider-read-check.json`、`evidence/discussion-live-check.json`，不保存帳號憑證或實際額度數值。測試成功代表工作台整合通過，不等於各家 CLI 的所有版本均已驗證。實際本次結果與限制請見 `VALIDATION.md`。

可用 `TRINITY_PACKAGED_EXE` 指定已打包的執行檔，再執行 `node tests/e2e.mjs` 重跑同一套桌面驗證。測試會先確認實際設定目錄等於專用測試目錄，才進行設定寫入。

## 故障排除

| 現象 | 處理 |
| --- | --- |
| 找不到命令 | 安裝所需 CLI，確認命令可由一般終端啟動，再填入完整路徑或重開本程式 |
| `.ps1` 被執行原則阻擋 | 若安裝器同時提供 `.cmd`，改填 `.cmd`；其餘依你的系統政策處理 |
| 程序立即退出 | 查看終端輸出、退出代碼及設定參數；確認 CLI 已完成自己的登入／設定 |
| PTY 元件載入失敗 | 重新安裝套件或應用程式；開發時執行 `npm run postinstall` 檢查，必要時重編原生元件 |
| 設定損壞 | 啟動會顯示警告並使用預設設定；原始檔在你下一次明確儲存前保持不變 |
| macOS 找不到全域 npm CLI | 重開本程式或使用完整路徑；確認登入 shell 可以在 5 秒內啟動 |
| Windows 出現未知發行者提示 | 本次安裝包未簽署；核對提供的 SHA-256 與來源後依你的系統政策處理 |

實作參考：[Electron 安全性指南](https://www.electronjs.org/docs/latest/tutorial/security)、[node-pty 官方專案](https://github.com/microsoft/node-pty)、[xterm.js API](https://xtermjs.org/docs/api/terminal/classes/terminal/)、[electron-builder Windows 設定](https://www.electron.build/win/)。
