# Status UI v0.2.2：未知送達防重複設計

## 背景

Discord 曾出現狀態卡已送達，但傳輸層未回傳成功確認的情況。現行 `status_update_ui` 會把任何 rich-presentation 例外視為「未送達」，並立刻改送文字 fallback；若第一張實際已送達，就會產生重複訊息。多人、多 Session 併發可能增加發生率，但不是正當的失敗原因。

## 目標

- 阻止「第一張已送達但確認遺失」後立即 fallback 造成的重複訊息。
- 保留 presentation 不支援或確定在送出前失敗時的文字 fallback。
- 不讓不同 Session、頻道、帳號或不同內容互相誤去重。
- 提供安全、可診斷的 delivery attempt 資訊，不記錄訊息正文或敏感資料。

## 非目標

- 不在 plugin 內建立跨主機、跨程序的永久訊息資料庫。
- 不宣稱解決 Discord／HTTP/2 或 OpenClaw core 的未知送達問題。
- 不限制多人或多 Session 同時使用。
- 不改動 OpenClaw core、Discord adapter 或正式客戶設定。

## 方案比較

### A. 任何例外都禁止 fallback

最安全地避免重複，但 presentation 在送出前確定失敗時也不會降級，降低可用性。

### B. 依失敗階段分類並做短窗去重（採用）

只有「確定未開始平台送出」才允許 fallback；一旦已進入平台送出或無法判定，就回傳 `delivery outcome unknown`，禁止自動重送。同時以 route＋Session＋內容摘要建立短時間、記憶體內的 attempt guard。

優點是兼顧可用性與重複風險，且不引入永久狀態。限制是程序重啟後無法跨程序去重；真正的 exact reconciliation 仍屬 OpenClaw core。

### C. plugin 自建持久 delivery ledger

可跨重啟去重，但會引入儲存、清理、隱私與一致性問題，也可能與 OpenClaw durable delivery 重複，現階段不採用。

## 設計

### 1. Attempt identity

每次呼叫產生本機 `attemptId`，並計算不可逆摘要鍵：

`accountId + channel + target + threadId + sessionKey + normalized message hash`

摘要鍵不保存原始訊息。不同 Session 即使文字相同，也不得互相去重。

### 2. Delivery state machine

- `prepared`：只完成 route、title 與 payload 建構。
- `dispatching`：已呼叫 channel adapter；此後例外皆視為未知送達。
- `confirmed`：adapter 回傳 message identity。
- `unknown`：dispatching 後拋錯或回傳無法證明送達的結果。
- `failed_pre_dispatch`：載入 adapter、render 或能力檢查在平台送出前失敗。

只有 `failed_pre_dispatch` 可嘗試文字 fallback。`unknown` 必須停止，不得自動再送。

### 3. Short-window attempt guard

- 以 module-local Map 保存最近 attempt 摘要與狀態，TTL 預設 30 秒。
- 同一摘要鍵在 TTL 內若為 `dispatching`、`confirmed` 或 `unknown`，後續呼叫回傳 suppressed／unknown，不再送出。
- TTL 清理必須有最大筆數上限，避免記憶體無界增長。
- 不同 Session、thread、target、account 或不同文字摘要必須互不影響。

### 4. Error contract

- 已確認送達：維持 `sent (..., message ID)`。
- 已在本次呼叫內安全去重：回傳非錯誤 suppressed 結果。
- 未知送達：回傳明確 tool error，指出「可能已送達，未自動重送」，但不曝光原始錯誤、訊息正文或敏感 route。
- 確定 pre-dispatch 失敗：才使用既有文字 fallback。

### 5. OpenClaw core 邊界

plugin 的短窗 guard 只處理同一程序內的重複呼叫。跨程序、Gateway restart、平台端確認遺失與 durable reconciliation 應由 OpenClaw core 的 delivery queue／provider reconciliation 負責，另行追蹤 upstream。

## 測試與驗收

- Rich send 成功：只送一次並回傳 message ID。
- Rich send 在 dispatch 後拋錯：不呼叫 `sendText`，回傳 unknown-delivery error。
- Render 在 dispatch 前失敗：允許且只執行一次文字 fallback。
- 同 Session、同 route、同內容短窗重試：不得再次送出。
- 相同內容但不同 Session：兩次都必須送出。
- 相同 Session 但不同 thread／target／account：不得誤去重。
- TTL 過期後：允許新的狀態更新。
- Guard 達容量上限：安全清理且不崩潰。
- `npm test`、`npm run check`、`npm pack --dry-run` 全部通過。
- 套件版本更新為 `0.2.2`，README 與風險文件同步更新。

## Security Scope（OWASP Top 10:2025）

- A01/A07：attempt key 必須包含 account、target、thread、Session，避免跨租戶／跨 Session 誤抑制。
- A02/A09：錯誤與診斷不得輸出 token、正文、敏感路徑或 raw exception；只記錄安全 attempt ID、狀態與雜湊。
- A04：未知送達採 fail-safe，不盲目重送；容量與 TTL 有界。
- A05：TTL／容量設定必須驗證範圍，非法值採安全預設。
- A06/A08：package lock／pack contents／版本與來源一致性需驗證，不新增外部依賴。
- A03/A10：本次不解析外部輸入為指令、不新增 SSRF／URL fetch；以測試證據標記不適用。

## 發布與回復

- 實作於獨立修復分支，通過測試後 commit、tag `v0.2.2` 並 push。
- 發布前比對 tarball contents，不包含測試資料、秘密或本機檔案。
- 回復方式：客戶可 pin `v0.2.1`；程式碼可 revert v0.2.2 implementation commit。

