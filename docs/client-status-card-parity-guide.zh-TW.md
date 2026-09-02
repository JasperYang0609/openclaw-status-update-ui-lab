# 客戶端狀態卡頻率對齊指南

用途：把客戶端 OpenClaw 的狀態卡體感，對齊安賽目前採用的「立即有回應、重要階段有更新、但不洗頻」模式。

本文件可直接交給客戶端 OpenClaw 閱讀。執行設定變更前，必須先備份設定、回讀目前值並合併；不得覆蓋既有 Plugin allowlist、工具權限、頻道設定或憑證。

## 一句話結論

安賽的狀態卡體感不是只靠一個時間參數，而是三層共同作用：

1. Status Update UI Lab runtime 在符合條件的使用者回合開始時，先嘗試送出一張首卡。
2. 單一可觀測工具執行超過 15 秒時，runtime 每個 run 最多補一張等待卡。
3. Agent instructions 要求模型在階段、卡點、策略、驗證或恢復狀態有變化時，主動補事件型狀態卡。

只安裝 Plugin、沒有同步第三層 instructions，通常只會看到首卡與偶爾一張長工具等待卡；這正是多數客戶端「很久才出一張」的原因。

## 已驗證的安賽基準

- OpenClaw：`2026.7.1-2`
- Status Update UI Lab runtime：`v0.3.0`
- 公開最新版：`v0.3.1`
- `v0.3.1` 只是發布包自我測試修正，runtime 行為與 `v0.3.0` 相同。
- Plugin 狀態：`loaded`
- 工具：`status_update_ui`
- Typed hooks：`before_agent_run`、`before_prompt_build`、`before_tool_call`、`after_tool_call`
- Hook 權限：`allowPromptInjection=true`、`allowConversationAccess=true`

`v0.3.1` 要求 OpenClaw `2026.7.1-2` 或更新版本。若客戶版本較舊，不要直接套用本設定。

## 建議的 Plugin 設定

以下為完整、明確鎖定的對齊值。實際寫入時只合併 `status-update-ui-lab` 區塊，不得覆蓋其他 `plugins.entries`。

```json
{
  "plugins": {
    "entries": {
      "status-update-ui-lab": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "titleTemplate": "{name} 正在處理",
          "fallbackName": "助理",
          "prefix": "狀態更新：",
          "maxLength": 240,
          "silent": true,
          "style": "presentation",
          "dedupeWindowMs": 30000,
          "guardMaxEntries": 1000,
          "enforcementMode": "hybrid",
          "autoStartMessage": "狀態更新：已收到任務，正在確認範圍並開始處理。",
          "autoWaitAfterMs": 15000,
          "autoWaitMessage": "狀態更新：目前仍在等待這個步驟完成；完成後會立即驗證結果並繼續。",
          "turnStateMaxEntries": 1000,
          "turnStateTtlMs": 600000,
          "turnToolTimerMaxEntries": 64
        }
      }
    }
  }
}
```

安賽目前只顯式設定 `enforcementMode=hybrid` 與 `autoWaitAfterMs=15000`，其餘採 Plugin 預設值。上方將預設值全部寫明，是為了讓客戶端不受未來預設值變動影響。

### 參數判讀

- `enforcementMode=hybrid`：runtime 自動首卡、注入靜態判斷規則，並啟用一次性長工具等待卡。
- `autoWaitAfterMs=15000`：每個工具從自身開始執行時計時；超過 15 秒才送等待卡。不是從整個回合開始計時。
- `autoWaitAfterMs=0`：停用自動等待卡，但仍保留 hybrid 首卡。一般客戶不建議。
- `autoStartMessage`／`autoWaitMessage`：必須是固定營運文字，不得插入使用者訊息、工具參數、路徑、錯誤、秘密或模型推理。
- `dedupeWindowMs=30000`：相同 Session、route 與訊息的短期重複抑制，不是狀態卡發送週期。
- `turnStateTtlMs=600000`：runtime 記憶的 run 狀態存活 10 分鐘，不是等待卡間隔。
- `turnToolTimerMaxEntries=64`：單一 run 最多保留的同時工具計時器數量，不代表會送 64 張卡。
- 自動等待卡每個 run 最多一張；它不是固定每 15 秒重複發送的 heartbeat。

## 工具權限必須合併，不得覆蓋

確認 `status_update_ui` 在目前 agent／provider／channel 的有效工具清單中。若需要新增，優先把它加入既有 `tools.alsoAllow`；不要把整份 `tools` 改成只允許這一項。

概念範例：

```json
{
  "tools": {
    "alsoAllow": [
      "status_update_ui"
    ]
  }
}
```

注意：

- 若同一 scope 已有 `tools.allow`，不可再同時設定 `tools.alsoAllow`；OpenClaw 會拒絕此組合。應把 `status_update_ui` 合併進既有 `allow`，或保留 profile 並改用 `alsoAllow`。
- `plugins.allow` 是 Plugin 載入 allowlist，不是工具 allowlist。若它已存在，只能加入 `status-update-ui-lab`，不能用單一值覆蓋原清單，否則其他 Plugin 可能停止載入。
- 不要照抄安賽的完整 `tools` 設定。客戶端應保留自己的最小權限、sandbox、exec policy 與頻道限制。

## 必須加入 Agent instructions 的事件判斷規則

把以下 marker block 放入該客戶實際 agent 每回合一定會載入的 `AGENTS.md`。若安裝包內的 `scripts/install_agent_hook.py` 可用，優先使用該冪等腳本；否則人工合併此區塊。

```text
<!-- status-update-ui-lab:start -->
Status Update UI Lab runtime 會在符合條件的頻道回合自動嘗試送出第一張進度卡；不要重複送同一張開工卡。

只有在下列事件發生時才主動呼叫 status_update_ui：
- 開始新的明確階段；
- 工具批次完成，且結果改變下一步；
- 發現關鍵線索、風險或 blocker；
- 原方法失敗，需要改策略；
- blocker 已解除或流程恢復；
- 準備進入驗證；
- 驗證完成，正準備交付最後結論。

多步驟任務應讓使用者持續看得懂目前階段。若 10–15 秒沒有可見輸出，可說明仍在等待什麼與下一步；但 runtime 已送過同一工具的自動等待卡時，不要再用相同文字重複洗頻。

連續發生有意義的變化時，狀態卡通常至少間隔 5–10 秒。沒有新狀況時不要為了湊頻率發卡；同一等待狀態不要固定心跳重複。

狀態卡只能公開：目前階段、已確認的狀況、改用方式與下一步。不得公開 chain-of-thought、完整內部推理、訊息內容、raw commands、工具參數／結果、秘密、敏感路徑或客戶隱私。

狀態卡保持短、具體、使用繁體中文。建議格式：
狀態更新：目前在查／改／測 XXX；發現或卡點是 YYY；下一步 ZZZ。

最後正式結論必須用一般 assistant reply，不得包成狀態卡。status_update_ui 失敗時，仍要完成正常回覆；除非 status_update_ui 不可用或失敗，不要改用 status_update。
<!-- status-update-ui-lab:end -->
```

### 模型判斷示例

應發卡：

- 「需求核對完成，開始讀取設定。」
- 「發現工具被 provider 層 policy 過濾，改查有效工具清單。」
- 「設定修正完成，開始 fresh Session 驗證。」
- 「短／長／錯誤三種情境均已通過，準備交付結果。」

不應發卡：

- 每讀一個檔案就發一張。
- 每 10 秒重複「還在處理」。
- 把 shell 指令、完整錯誤或敏感路徑貼進卡片。
- runtime 已送首卡後，模型立刻再送一張同義首卡。
- 用狀態卡取代最後正式答案。

## 為什麼客戶端可能仍然比較慢

1. **只裝了 Plugin，沒裝 instructions**：runtime 會送首卡與一次等待卡，但模型不會在階段轉換時主動補卡。
2. **不是 fresh Session**：舊 Session 可能仍持有安裝前的工具清單或 system context。Gateway restart 後還要 `/new` 或建立新 Session 驗證。
3. **工具不通過 typed lifecycle hooks**：Codex、外部 provider harness 或內部工具若 OpenClaw 看不到 `before_tool_call`／`after_tool_call`，runtime 無法替該工具計時。此時硬保證只有回合首卡，後續依 instructions 由模型在可控制的階段補卡。
4. **工具在 15 秒內完成**：不會出現自動等待卡，這是正常行為。
5. **整個 run 只允許一張等待卡**：第二個長工具不會再得到 runtime 等待卡，必須靠有意義的階段更新維持可見度。
6. **工具或 Plugin 被 policy 過濾**：設定檔看得到不等於目前 Session 有效；必須查 `tools.effective`。
7. **route 不確定或不是使用者頻道回合**：cron、heartbeat、background、route-less、衝突 route 會安全跳過自動卡，避免錯送。

## 客戶端套用流程

客戶端 OpenClaw 應依序執行，任何一步失敗都先停下，不要盲目重啟或放寬全部權限。

1. 回讀 OpenClaw 版本、Plugin runtime、現有 `plugins.allow`、`plugins.entries` 與 `tools` policy。
2. 確認版本至少為 OpenClaw `2026.7.1-2`。
3. 備份現有設定；只合併本文件的 UI Lab 區塊。
4. 確認兩項 hook 權限為 true，並確認 `status_update_ui` 在有效工具清單。
5. 將 marker block 合併到實際 agent 的 `AGENTS.md`。
6. 驗證設定格式與 Plugin doctor。
7. 重啟實際服務該客戶頻道的 Gateway。
8. 建立 fresh Session，再做驗收；不要用舊 Session 判斷成敗。

## 必做驗收

### A. Runtime 與權限

- `openclaw plugins inspect status-update-ui-lab --runtime --json`
- 必須看到 Plugin `loaded`。
- 必須看到四個 typed hooks。
- 必須看到兩項 hook permission 為 true。
- diagnostics 不得有未處理錯誤。

### B. 有效工具

用 `tools.effective` 查實際客戶 Session key：

- 必須存在 `status_update_ui`。
- owner 必須是 `status-update-ui-lab`。
- 原本需要的 Bash／exec、message、read 等工具不得因合併設定而消失。

### C. Fresh Session smoke

1. 短文字回合：模型執行前應快速出現一張首卡，最後答案仍是普通訊息。
2. 長工具回合：工具持續超過 15 秒時，該 run 最多出現一張等待卡。
3. 工具錯誤：狀態卡不得洩漏 raw error、command 或 path，最後答案仍正常說明安全摘要。
4. 階段型任務：至少在開始新階段、發現 blocker／改策略、進入驗證時看得到有內容差異的卡片。
5. Gateway restart 後再開 fresh Session，行為仍應保留。
6. 至少跨兩個 channel／thread 驗證，不得錯送到別的 route。

## 驗收判定

只有以下全部成立才能標記 `PASS`：

- 首卡早於正常答案，且沒有重複首卡。
- 15 秒以上的可觀測工具有一次等待卡，沒有固定 heartbeat 洗頻。
- 多階段任務有事件型更新，不只首卡與最後答案。
- 最後結論維持普通訊息。
- 原有工具、頻道與 Plugin 權限沒有被覆蓋。
- 卡片未洩漏命令、錯誤、秘密、路徑、訊息內容或客戶資料。
- Fresh Session、Gateway restart 與跨 route 驗證均通過。

若自動首卡正常、但長工具沒有等待卡，先確認該工具是否通過 typed lifecycle hooks；不要直接把 `autoWaitAfterMs` 調得更短。若首卡與 `status_update_ui` 都正常、但階段更新很少，優先檢查 `AGENTS.md` 是否真的被該 agent／Session 載入。

## 安全與回滾邊界

- 本設定只改狀態呈現，不授權新增工具、擴張 recipient、關閉 sandbox 或放寬 exec。
- 不得把 token、API key、Bot token、Session transcript 或客戶訊息寫進本文件或狀態模板。
- 出現重複卡、route 異常或工具受影響時，先把 `enforcementMode` 改為 `prompt`，重啟 Gateway 並 fresh Session 驗證；這會停止 runtime 自動卡，但保留靜態模型指引。
- 若仍有問題，再回滾至已驗證的 `v0.2.2`，並恢復對應設定備份。不要刪除 Session 或訊息作為第一個回滾手段。
- 未經客戶／負責人核准，不得直接修改正式客戶環境。
