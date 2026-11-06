# 第3章编辑索引

`../03-design.tex` 提供章标题并按编号顺序加载下列文件。文件名编号是加载顺序，不是节编号；章节、图表及引用仍由 LaTeX 自动生成。

| 文件 | 修改内容 | 当前正文页 |
|---|---|---|
| `01-architecture.tex` | 项目概述与总体架构 | 1 |
| `02-modules.tex` | 模块职责与协作组织 | 2 |
| `03-http-contracts.tex` | HTTP请求处理与接口契约 | 3 |
| `04-browser-state.tex` | 浏览器快照、UI状态与轮询 | 4 |
| `05-er-account-matching.tex` | 账号、匹配与抽取ER图 | 5 |
| `06-er-real-chat.tex` | 真人通信与参考分ER图 | 6 |
| `07-er-media.tex` | 媒体与生成任务ER图 | 7 |
| `08-virtual-state.tex` | 虚拟状态结构与权威归属 | 8 |
| `09-database-access.tex` | 数据库约束、索引与访问设计 | 9 |
| `10-auth-session.tex` | 身份认证与会话生命周期 | 10 |
| `11-tag-matching.tex` | 标签提取与双向匹配设计 | 11 |
| `12-draw-collection.tex` | 候选过滤、加权抽取与收藏冷却 | 12 |
| `13-real-notes-chat.tex` | 真人纸条与会话建立 | 13 |
| `14-virtual-chat.tex` | 虚拟纸条、聊天与回复等待 | 14 |
| `15-cycle-consent.tex` | 虚拟体验的心笺、回望与授权 | 15 |
| `16-ai-guidance.tex` | AI建议、对话理解与情绪立绘 | 16 |
| `17-favorability-cache.tex` | 真人交流参考分与结果复用 | 17 |
| `18-media-generation.tex` | 本人素材与情绪立绘生成流程 | 18 |
| `19-png-save.tex` | 生成图检查与确认保存方案 | 19 |
| `20-consistency-recovery.tex` | 数据保存与操作衔接 | 20 |

## 编辑与编译

- 正文以模块作用、核心流程、设计理由和处理结果为主；匹配、加权抽取和综合参考分保留核心公式。
- 直接修改对应主题文件，不需要编辑原来的两份大文件。
- 文件是正文片段，不能单独编译；在报告根目录运行 `build.bat` 或 `build.sh`，正式入口仍为 `report.tex`。
- 现有分页命令沿用原文，后续内容增删可能改变页数；正式构建检查正文必须20页、附录最多6页。
- 全局字体、配色和图形样式在报告根目录的 `reportstyle.sty` 中管理。
- 保留已有 `label` 名称，避免破坏跨文件引用；新增或调整顺序时同步修改 `03-design.tex`。
