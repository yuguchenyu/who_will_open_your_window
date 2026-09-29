# 登录系统与服务端状态迁移 · 设计

日期：2026-09-29

## 背景与目标

这个项目要从"单人本地 Demo"走向**交友网站**。当前状态：

- 打开网页无需登录，直接进入。
- 所有互动数据（纸条、对话、心笺、额度、周期）存在浏览器 `localStorage` 的单个 key `heart-window-demo-v1` 下，服务端不存任何数据，只转发 AI 请求。
- 页面上的三个人物（小夏 / 阿屿 / 小宁）是写死在 `public/core.mjs` 里的 AI 假人。
- `/api/*` 完全没有鉴权（README 里已明确警告：同网段任何人扫到端口就能消耗你的模型额度）。

本次要完成两件事：

1. **加入登录系统**，账号信息存 SQLite。
2. **把互动数据从浏览器搬到服务端**，按账号隔离。

加上一条明确的产品约束：**一个账户只允许登录一个设备，后登录顶掉先登录。**

## 范围

### 做

- 账号注册 / 登录 / 登出，凭据存 SQLite。
- 会话绑定单设备：同一账号后登录的会话顶掉先前的，被顶掉的设备收到明确提示。
- 互动数据迁移到服务端，按账号隔离。
- 业务规则（纸条额度、周期、屏蔽等）改由服务端强制执行。
- `/api/*` 全面要求登录。

### 不做（本次的边界）

- **真人之间的社交**。聊天对象仍然是那三个 AI 假人，只是记录改为按账号存服务端。"人物"是下一个子项目（用户资料、浏览/搜索、双向匹配、真人私信、举报拉黑）。
- 邮箱验证、找回密码、验证码、设备指纹、HTTPS。
- 浏览器里已有旧数据的导入。旧 key 原样留着，不读也不删。

## 关键决策

### 决策 1：数据搬到服务端，而不是继续留在浏览器

如果数据留在浏览器，用户用手机注册聊天、再换电脑登录同一账号会什么都看不到 —— 登录就只是一块门帘。要成为网站，数据必须在服务端。

### 决策 2：单设备 = 后登录顶掉先登录

被顶掉的设备不是静默失败，而是在**下次任何操作时**收到 `401 SESSION_REPLACED`，前端提示"你的账号已在另一台设备登录，请重新登录"并跳回登录页。

选择"顶掉"而非"拒绝新登录"的理由：用户不需要人工干预就能自己换设备；"拒绝新登录"在用户忘记在哪里登录过、或手机丢失时会把人锁死在外面。

### 决策 3：服务端当权威，复用 `core.mjs`

`public/core.mjs` 是一个**纯函数状态机** —— `sendNote`、`sendMessage`、`confirmHeart` 等全是 `(state, ...) => 新状态`，没有 DOM、没有 IO。而且 `server.mjs` 已经为了 `PEOPLE` 在 import 它。这份业务逻辑服务端本来就能直接用。

因此：前端把动作发给服务端，服务端跑 `core.mjs` 算出新状态、落库、把新状态返回给前端渲染。**前端不再自己修改状态。**

对比被否掉的两个方案：

| 方案 | 否掉的理由 |
|---|---|
| 客户端算状态，整份 `PUT /api/state` | 服务端不校验规则，打开开发者工具改一下就能绕过"每天 2 张纸条"—— 而这个额度正是"让相遇慢一点"的产品核心机制。多标签页还会互相覆盖。 |
| 全部规范化建表（notes / messages / feelings 各一张表） | 改动最大，`core.mjs` 状态机基本作废重写，测试跟着重写。而当前并没有任何查询需求，属于提前设计。 |

**`core.mjs` 在这次改动中一行不用改，现有测试继续有效。**

### 决策 4：并发不需要锁

`node:sqlite` 的 `DatabaseSync` 是**同步** API。Node 单线程下，一个"同步读状态 → 跑 `core.mjs` → 同步写回"的函数不可能被另一请求插入执行，天然原子。

唯一会 `await` 的是 AI 调用，而它发生在**重新读取状态之前**：`/api/reply` 先等 AI 返回，再去读最新的状态执行 `finishReply`。而 `finishReply` 本身在 `pending` 已被清除时（例如用户在此期间屏蔽了该人物）会返回 `false`，不会写脏数据。

**这个性质依赖于单进程 + 同步 API。** 将来若改用异步驱动或多进程部署，必须补上按用户的互斥。

### 决策 5：资料放 `users` 表，而不是塞进状态 JSON

账号资料（`name` / `habit` / `topic` / `allowNotes`）存 `users` 表的列，不留在 `states.json` 里。这样"用 SQLite 保存账号信息"是字面属实的，以后接真人时也能直接查别人的资料。

代价是服务端读状态时要把这四个字段**注入**回去、写状态时**抽出来**存回表。注入发生在 `validState` 校验之前，所以 `core.mjs` 的校验逻辑不用动。

### 决策 6：Cookie 不加 `Secure`

项目跑在 `http://` 上（局域网 IP），加了 `Secure` 浏览器根本不会回传 cookie，登录直接失效。取舍是：令牌在局域网内明文传输。对课程项目可接受，但**必须写进 README 的已知限制**，不藏。将来上 HTTPS 要加回来。

## 数据模型

新建 `lib/db.mjs`，开库时建表，启用 `PRAGMA journal_mode=WAL` 与 `PRAGMA foreign_keys=ON`。

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- u_ + 16 字节随机
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,             -- scrypt(password, salt, 64)
  salt          TEXT NOT NULL,             -- 每用户 16 字节随机
  created_at    INTEGER NOT NULL,
  name          TEXT NOT NULL,             -- ↓ 原 state.profile 的四个字段
  habit         TEXT NOT NULL,
  topic         TEXT NOT NULL,
  allow_notes   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,            -- sha256(令牌)，不存明文
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      TEXT NOT NULL,               -- 从 User-Agent 归纳的标签，只用于提示文案
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  replaced_by TEXT                         -- 顶掉它的那台设备
);
-- 单设备的关键：一个账号最多只允许一行 active=1
CREATE UNIQUE INDEX sessions_one_active ON sessions(user_id) WHERE active = 1;

CREATE TABLE states (                      -- 纸条/对话/心笺/额度，整份存
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (              -- 登录限速
  key        TEXT PRIMARY KEY,             -- ip + '|' + username
  failures   INTEGER NOT NULL,
  first_at   INTEGER NOT NULL
);
```

那条 `WHERE active = 1` 的偏索引就是"一个账户一个设备"的落点，**由数据库强制保证，不靠应用层自觉**。

数据库文件路径由 `.env` 的 `DB_PATH` 指定，默认 `runtime/app.db`（`runtime/` 已在 `.gitignore` 中）。

## 认证流程

### 注册 `POST /api/register`

用户名 3–20 位字母/数字/下划线，`COLLATE NOCASE` 保证 `An` 与 `an` 不能同时注册。密码 8–128 位。

用内置 `crypto.scrypt` + 每用户随机盐，比对走 `timingSafeEqual`。注册成功**直接建立会话**，不用再登录一次。

注册时资料列的初始值：`name` 取用户名（让用户一眼认得出是自己的账号），`habit` 与 `topic` 取 `C.freshState().profile` 的默认文案，`allow_notes` 为 1。`states` 行同时以 `C.freshState()` 写入。这两步在同一个事务里完成。

`reset` 动作是"保留账号、清空互动"：互动状态回到 `C.freshState()`，资料四列也一并恢复成上面的默认值（与现有 Demo 面板"重置全部演示数据"的行为一致）。

### 登录 `POST /api/login`

校验失败时统一返回"用户名或密码不正确"，不区分是用户名不存在还是密码错误（避免用户名枚举）。失败计入限速表。

成功时在**一个事务**里完成顶替：

```sql
UPDATE sessions SET active = 0, replaced_by = :新设备 WHERE user_id = :uid AND active = 1;
INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (...);
```

### 令牌

`randomBytes(32).toString('base64url')`，约 43 字符。**库里存 `sha256(令牌)`，不存明文** —— 数据库泄露也不能直接拿来登录。

Cookie：`HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`（30 天）。不加 `Secure`（见决策 6）。

### 鉴权中间件

除 `/api/register`、`/api/login`、`/api/status` 外，所有 `/api/*` 必须带有效会话：

| 情况 | 响应 | 前端表现 |
|---|---|---|
| `active=1` 且未过期 | 放行 | — |
| `active=0`（被顶掉） | `401 SESSION_REPLACED` | 提示"你的账号已在另一台设备登录，请重新登录"，跳登录页 |
| 查不到 / 过期 | `401 UNAUTHENTICATED` | 跳登录页 |

### 登出 `POST /api/logout`

**删除**会话行，而不是置 `active=0`。否则用户重新登录时，会被自己那条旧的 `active=0` 记录误判成"被顶掉"。

### 限速

同一 `ip|username` 连续失败 10 次锁 15 分钟。内存 Map 即可，服务重启清零。

### 会话清理

每次登录时顺手清理，不引入定时任务：

```sql
DELETE FROM sessions WHERE expires_at < :now OR (active = 0 AND created_at < :weekAgo);
```

## 接口

| 方法 | 路径 | 需登录 | 作用 |
|---|---|---|---|
| GET | `/api/status` | 否 | 服务与 AI 配置状态（登录页要用） |
| POST | `/api/register` | 否 | 注册并直接登录 |
| POST | `/api/login` | 否 | 登录（顶掉旧会话） |
| POST | `/api/logout` | 是 | 登出 |
| GET | `/api/me` | 是 | 当前账号 + 整份状态 |
| POST | `/api/action` | 是 | 所有业务动作 |
| POST | `/api/reply` | 是 | 调 AI 生成回复并落库 |
| POST | `/api/suggestions` | 是 | 调 AI 生成建议 |
| POST | `/api/check` | 是 | 检查 AI 连接 |

### `/api/action` 的动作表

`lib/actions.mjs` 导出一张**写死的**动作表，把动作名映射到 `core.mjs` 的函数：

```js
export const ACTIONS = {
  sendNote:       (s,b) => C.sendNote(s, b.personId, b.text),
  sendMessage:    (s,b) => C.sendMessage(s, b.personId, b.text),
  incomingAction: (s,b) => C.incomingAction(s, b.noteId, b.op, b.text),
  startNoteReply: (s,b) => C.startNoteReply(s, b.noteId),
  blockPerson:    (s,b) => C.blockPerson(s, b.personId),
  recordFeeling:  (s,b) => C.recordFeeling(s, b.personId, b.score, b.memo),
  review:         (s,b) => C.review(s, b.personId, b.intent, b.authorized),
  confirmHeart:   (s,b) => C.confirmHeart(s, b.personId),
  injectNote:     (s,b) => C.injectNote(s, b.personId),
  saveProfile:    (s,b) => { /* 校验后写入 users 表的 name/habit/topic/allow_notes 四列 */ },
  saveScenario:   (s,b) => { s.scenarios[b.personId] = {intent:b.intent, authorized:b.authorized, cycle:C.cycleOf(s)} },
  advance:        (s,b) => { const n = s.offsetDays + b.days; if (n > 3650) throw new Error('演示时间已达上限，请重置。'); s.offsetDays = n },
  reset:          (s)   => C.freshState(),
};
```

`b.days` 与 `b.score` 必须是整数 —— 服务端不接受字符串数字，避免 `'"1"' + 1` 这类隐式转换。`saveScenario` 的 `cycle` 由服务端取当前周期，不信客户端传的值。

前端**只能发这张表里列出的动作**，服务端不接受"整份状态"上传。未列出的动作名一律拒绝。这就是决策 3 的落点：额度、周期、屏蔽等规则由 `core.mjs` 在服务端执行，客户端改不动。

### `/api/action` 与 `/api/reply` 为什么分开

`/api/reply` 要等 AI（最长 35 秒），而其他动作必须立刻返回。分开可以保住现有体验：

1. 发消息 → `/api/action {type:'sendMessage'}` → 落库并标记 `pending`，立即返回 → 前端显示"AI 正在组织回应"。
2. `/api/reply` → 服务端读最新状态、调 AI、`core.finishReply`、落库、返回新状态。

`core.mjs` 的 `pending` 机制原样生效，重试不会重复扣额度。

## 前端改动

### 新增

- `public/login.html` + `public/login.mjs` —— 登录/注册页，复用 `public/style.css`，保持现有视觉语言。
- `public/api.mjs` —— 统一 fetch 封装与 401 处理。收到 `SESSION_REPLACED` 时提示并跳转登录页；收到 `UNAUTHENTICATED` 时直接跳登录页。

### 修改

- `public/app.mjs`（改动最大）：
  - 启动改为 `GET /api/me` 取账号与状态，替换掉 `localStorage.getItem`。
  - 删除 `save()` 里的 localStorage 写入。状态改为服务端返回后整体替换。
  - `action()` 里那些本地调用（`C.sendNote(...)`、`C.sendMessage(...)`、`C.recordFeeling(...)` 等）改成 `await` 调 `/api/action`，再用返回的 state 覆盖本地 `s`。
  - 删除 `broken` / `backup` / `recover` 那套"本地数据读不出来"的恢复逻辑 —— 服务端不会读不出来。
  - 新增登出入口。
- `server.mjs`：加路由与鉴权中间件；静态白名单加 `/login.html`、`/login.mjs`；未登录访问 `/` 时 302 到 `/login.html`；已登录访问 `/login.html` 时 302 回 `/`。
- `tests/server.test.mjs`：`/api/check` 与 `/api/suggestions` 现在需要登录，需先注册测试账号。

### 不动

- `public/core.mjs` —— 一行不改。
- `public/style.css` —— 登录页复用，最多追加少量样式。

### 清理

- 删除 `public/server.mjs`。它是 `public/core.mjs` 的逐字复制，且不在静态白名单里，是死代码。

### 旧数据

浏览器里已有的 `heart-window-demo-v1` 不导入、不删除，原样留在那里。登录后从服务端取全新状态。迁移逻辑对本次目标没有价值。

## 安全边界

**做到**：密码 scrypt + 随机盐、令牌只存哈希、`HttpOnly` + `SameSite=Strict`（防 CSRF；现有的 Origin 与 `Sec-Fetch-Site` 检查保留）、登录限速、服务端动作白名单、现有 CSP（`script-src 'self'`）随之要求登录页脚本必须是独立 `.mjs` 文件而非内联。

**不做**：邮箱验证、找回密码、HTTPS、验证码、设备指纹。全部写进 README 的"已知限制"一节。

## 测试

新增 `tests/auth.test.mjs`（`node --test`，用 `:memory:` 内存库）：

1. 注册：用户名唯一（含大小写不敏感）、密码长度校验、密码不以明文入库。
2. 登录：密码错误返回 401，且文案不区分"用户不存在"与"密码错误"。
3. **单设备**：同账号二次登录后，旧令牌得到 `SESSION_REPLACED`，新令牌正常工作。
4. 鉴权：未登录访问 `/api/action` 得 401；未登录访问 `/` 得 302 到 `/login.html`。
5. **跨账号隔离**：A 递出的纸条不出现在 B 的状态里。
6. **服务端强制规则**：伪造超额度动作、或发送动作表之外的 action 名，均被拒绝。
7. 登出后令牌立即失效。
8. 会话过期。

`createServer` 的签名扩展为 `createServer(config, {fetchImpl, timeout, db})`，测试传入内存库。

## 实施顺序

先用测试把服务端钉死，再动前端 —— `app.mjs` 的状态管理从"本地可变对象"改成"服务端返回后整体替换"是本次最容易出错的地方，前端必须在服务端契约稳定之后再改。

1. `lib/db.mjs` + 建表
2. `lib/auth.mjs`（注册、登录、会话、限速）+ `tests/auth.test.mjs`
3. `lib/actions.mjs` + `/api/action` + `/api/me` + 规则强制测试
4. `server.mjs` 路由与鉴权接线，修复 `tests/server.test.mjs`
5. `public/login.html` + `public/login.mjs` + `public/api.mjs`
6. `public/app.mjs` 改造
7. 删除 `public/server.mjs`，更新 README 与 `.env.example`

## 已知限制（写入 README）

- 令牌在局域网内明文传输（cookie 未加 `Secure`，因为服务跑在 HTTP 上）。
- 没有找回密码，忘记密码只能直接改数据库。
- 会话固定 30 天过期，不滑动续期。
- 被顶掉的设备在下一次操作时才会发现，不会实时推送。
- 聊天对象仍是 AI 假人，不是真实用户。
