# 附录 A:证据索引与源码对照

> 本附录回应评审意见:此前提交包仅含三个 md,交叉引用的证据无法比对。现提交包新增 `证据/` 目录,本次补齐历史提交 029f274 的运行源码、测试和启动/监控脚本；历史截图与验证记录保留。具体清单如下，不包含真实 .env、运行时数据库、依赖安装目录或原始 AI 会话导出。本附录给出"需求项 → 源码位置"的对照表,便于按条查验。

## A.1 随包证据文件清单

| 文件 | 内容 | 对应需求文档 |
|---|---|---|
| `证据/core.mjs` | 业务规则完整源码(人物、纸条、心笺、回望、确认、屏蔽、校验) | FR-01~28、NFR-11,业务规则汇总 |
| `证据/server.mjs` | 本地服务完整源码(配置读取、AI 代理、安全头、错误分支) | FR-11~16/29/30、NFR-01~07 |
| `证据/core.test.mjs` | 8 项单元测试(伪造时钟,纯规则) | AC-1~7 |
| `证据/server.test.mjs` | 5 项服务端测试(伪造上游) | AC-8、AC-9 |
| `证据/browser.mjs` | 独立浏览器端到端测试脚本 | AC-10、AC-11、AC-13 |
| `证据/VERIFICATION.md` | 2026-09-26 实测记录全文 | 第 8 章历史结果列 |
| `证据/screenshots/*.png` | 三档宽度截图(390/320/1440px)5 张 | AC-11、NFR-08 |
| `证据/package.json` | 无 dependencies，Node ≥24，npm test 入口 | NFR-12、AC-18 |
| `证据/public/app.mjs`、`public/index.html`、`public/style.css`、`public/core.mjs` | 同版本前端及规则，含资料编辑、举报、响应式与 localStorage | FR-02/03/28/32、AC-14/16/17、NFR-08 |
| `证据/tests/*.mjs` | 规范目录布局的 3 个测试脚本 | AC-1～13；新增 AC-20～22 不在历史测试覆盖内 |
| `证据/start.ps1`、`stop.ps1`、`monitor.ps1`、`run-service.ps1`、`启动Demo.cmd` | 启停/监控、隐藏后台 supervisor | NFR-10；service.json 为运行时生成，不伪造静态结果 |
| `证据/.env.example`、`README.md` | 不含密钥的配置模板和历史运行说明 | C1～C5、FR-29 |
| `证据/验证记录-v1.1.txt`、`文件校验清单.sha256` | 本次自动化结果摘要和逐文件校验值 | 版本追溯；不替代人工验收记录 |


复现：在 `证据/` 目录运行 `npm test`（13 项，无真实密钥）；浏览器测试用 `node tests/browser.mjs`，需先安装仅供测试的 playwright-core 至 runtime/test-tools 并使用脚本指定的 Windows Chrome。运行时服务本身没有第三方依赖。根目录旧的 core.test/server.test/browser 为原包存档副本，路径按原项目写成，不作为直接执行入口；执行请用 tests/ 中的同版本文件。

历史 README 中“导出备份”的描述不能证明已有导出按钮；本次已在主文档更正，并将 FR-36 列为待实现。README 为原提交的证据文本，保留原样以便核对。

## A.2 需求项 → 源码位置对照表

### core.mjs(业务规则)

| 需求 | 函数/常量 | 关键行(节选) |
|---|---|---|
| FR-01 人物与话题 | `PEOPLE` | 3 位人物,含 `persona`/`topic` 字段 |
| FR-03 身份编辑 | `public/app.mjs` profile 表单与 save-profile | maxlength 和 cleanText 为 20/100/100；此前仅凭 freshState 推断长度不成立，现修正 |
| FR-04 纸条 ≤100 字 | `cleanText(value,max=500)` / `sendNote` | `cleanText(text,100)`,按 `Array.from(text).length` 计数 |
| FR-05 日额度 2 次 | `noteEligibility` | `filter(n=>n.direction==='out'&&n.day===dayOf(s,real)).length>=2` |
| FR-06 重复限制 | `noteEligibility` | pending/saved/declined、已聊天、已屏蔽三分支 |
| FR-12/13 待回复锁 | `sendMessage` | `if(s.pending[id])fail('还有一条回复待完成…')` |
| FR-14 幂等重试 | `finishReply` | 重试只补 AI 回复,`return false` 防重复入列 |
| FR-17 注入预设来信 | `injectNote` | `demo:true` 标记;"已有互动…不能注入"分支 |
| FR-18 收件三操作 | `incomingAction` | save/decline/reply,状态机防重复操作 |
| FR-19 心笺 0–100 整数 | `recordFeeling` | `Number.isInteger(score)&&score>=0&&score<=100`,备注 ≤200 |
| FR-21 七天周期 | `cycleOf` | `Math.floor((clockNow-s.started)/(7*86400000))` |
| FR-22 意愿与周期绑定 | `review` | 记录 `{intent, authorized, cycle, at}` |
| FR-23/25 确认前置与不扣额 | `confirmationReason` | 屏蔽/未交流/对方当期无效/本人当期无效/周期已用,五分支全部置灰 |
| FR-24 结果无分数 | `confirmHeart` | 返回 `{id, personId, cycle, mutual, at}`,无 score 字段 |
| FR-26 跨周期失效 | `confirmationReason` | `own.cycle!==cycle`/`other.cycle!==cycle` 判定 |
| FR-27 屏蔽即停 | `blockPerson` | 清 pending、`reviews[id].authorized=false` |
| FR-32 损坏数据拒渲染 | `validState` | 版本、字段类型与范围(offsetDays 0–3650、分数 0–100 等)逐项校验 |
| FR-34 时间推进 | `offsetDays` / `clockNow` | 演示时钟 = 真实时间 + offsetDays×86400000 |

### server.mjs(服务与安全)

| 需求 | 位置 | 关键行(节选) |
|---|---|---|
| C4/NFR-01 超时 35s | `completion(config,{timeout=35000})` | `AbortSignal.timeout(timeout)` |
| NFR-02 并发 4 | `createServer` | `if(active>=4)throw new ApiError('已有多个请求进行中…',429,'BUSY')` |
| NFR-03 请求体 64KB | 请求读取循环 | `if(size>64000)throw new ApiError('请求内容过长。',413)` |
| FR-15 上下文 ≤20 条 | `makeMessages` | `body.messages.length>20` 拒绝;单条 `text(m.content,3000)` |
| NFR-04 密钥不出前端 | `/api/status` | 只返回 `{configured, model}`,无 key 字段 |
| NFR-05 仅本机 + 同源 | 请求处理头部 | Host 白名单、Origin 比对、`sec-fetch-site` 校验 |
| NFR-05 静态白名单 | `whitelist` | 仅 index.html/app.mjs/core.mjs/style.css 四个文件 |
| NFR-06 安全响应头 | `headers` | CSP `default-src 'self'…`、nosniff、no-referrer、no-store |
| FR-30 错误分支 | `completion` catch | 401/403→AUTH、429→RATE_LIMIT、超时→TIMEOUT、网络→NETWORK |
| FR-10 建议格式校验 | `parseSuggestions` | 恰好 3 条、label ≤12、text ≤100,否则 502 FORMAT |
| FR-16 安全提示词 | `makeMessages` 的 `safety`/system | 不索要证件住址密码联系方式、尊重拒绝、不推断隐藏状态 |

## A.3 测试名清单(与验收标准对应)

`npm test` 共 **13 项**:

| # | 测试名(源文件内原文) | 验收项 |
|---|---|---|
| 1 | daily paper limits and no duplicate before reply | AC-1 |
| 2 | incoming save and decline are private and stop re-injection | AC-2 |
| 3 | replies retry without duplicate user message, both directions | AC-3 |
| 4 | feelings never imply intent or authorization | AC-4 |
| 5 | mutual outcome requires current explicit consent and spends once | AC-5 |
| 6 | unavailable people consume no quota, withdrawal and block take effect | AC-6 |
| 7 | persistence round trip and reset | AC-7 |
| 8 | damaged nested storage is rejected before rendering | AC-7 |
| 9 | private data is excluded from upstream messages | AC-9 |
| 10 | suggestion validation | AC-8 |
| 11 | HTTP route protections, static files and secret exclusion | AC-8 |
| 12 | mock upstream validates authorization and successful API flows | AC-8 |
| 13 | missing config, auth, rate limit, malformed output and network error | AC-8 |

另有独立浏览器端到端脚本 `browser.mjs`(AC-10/11/13),使用两个临时端口,不读 `.env`。

## A.4 源码与文档的一致性声明

附录 A.2 包含定位与摘要，不把省略后的摘要称为逐字原文。发现需求与源码不一致时，记录实现缺口或需求修订及理由，不以源码静默改写需求。FR-36/37 与 44px 目标尚未由历史代码实现/验证。v1.1 已纠正 FR-03 的长度误差；测试结果见本次记录，人工验收状态见 03 第 7 节。
