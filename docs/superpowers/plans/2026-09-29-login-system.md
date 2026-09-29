# 登录系统与服务端状态迁移 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给这个本地 Demo 加上账号登录（账号存 SQLite），并把互动数据从浏览器 `localStorage` 搬到服务端按账号隔离，同时保证一个账号同时只能在一个设备登录。

**Architecture:** 服务端当权威。`public/core.mjs` 是一份纯函数状态机，服务端直接复用它 —— 前端只发"动作"，服务端跑 `core.mjs` 算出新状态、落库、把新状态返回。`core.mjs` 一行不改。并发不需要锁，因为 `node:sqlite` 的 `DatabaseSync` 是同步 API，Node 单线程下"读状态 → 算 → 写回"这段没有 `await`，天然原子。

**Tech Stack:** Node ≥ 24（`node:sqlite`、`node:crypto`、`node:http`），零外部依赖，无数据库驱动包。前端是原生 ES module，无框架、无构建步骤。测试用 `node --test`。

**Spec:** `docs/superpowers/specs/2026-09-29-login-system-design.md`

## Global Constraints

- **零依赖**：只用 Node 内置模块。不得修改 `package.json` 的 `dependencies`（当前根本没有这个字段，保持没有）。`npm install` 永远不需要。
- **Node ≥ 24**：`node:sqlite` 的 `DatabaseSync` 是硬要求。当前开发机是 v26.5.0。
- **`public/core.mjs` 一行不改。** 任何任务都不许动它。
- **CSP 是 `script-src 'self'`**：前端脚本必须是独立 `.mjs` 文件，不得内联 `<script>`，不得用 `eval`。
- **所有面向用户的文案用中文**，与现有风格一致（简短、克制、不用感叹号）。
- **测试**：`node --test tests/*.test.mjs`。注意 `tests/browser.mjs` 不在这个 glob 里，它是单独的 Playwright 脚本。
- **常量**（照抄，不要改）：用户名 `^[A-Za-z0-9_]{3,20}$`；密码 8–128 个字符；会话 30 天；登录失败 10 次锁 15 分钟；`advance` 天数上限 3650；数据库默认路径 `runtime/app.db`。
- **Cookie 不加 `Secure`**（服务跑在 HTTP 上），但必须带 `HttpOnly; SameSite=Strict; Path=/`。

## Review Focus

以下是 spec 隐含、但单靠各任务的功能测试不会覆盖的输入与状况。每一条都已经在下面某个任务的测试里钉住：

1. **同一浏览器开着两个标签页** —— 两个标签共用同一个 cookie，所以"一账号一设备"管不到它们。标签 B 做的操作不会出现在标签 A 的画面上（A 手里那份副本是旧的），但**服务端数据必须正确、不能被覆盖回退**。期望：刷新后两边一致，无数据丢失。
   → Task 6 步骤 2 的 `a stale tab cannot roll back another tab's work`
2. **会话被顶掉的那一刻用户正在写东西** —— 用户写了很长的纸条，点发送时才拿到 401。期望：草稿不丢，界面说清原因，人重新登录后那几句话还在。
   → Task 7 步骤 1 的 `beforeLeaving` 钩子 + Task 8 步骤 2 的 `sessionStorage` 抢救 + Task 9 步骤 5 的端到端断言
3. **用户名含中文、emoji 或超长** —— 必须返回可读的中文提示和 4xx，不得把 SQLite 的 `UNIQUE constraint failed` 原文或 500 抛给用户。
   → Task 3 步骤 1 的 `credential rules reject bad input with readable Chinese messages`；注册撞名走 `USERNAME_TAKEN`，见 `a duplicate username is refused regardless of case, with a readable message`
4. **同一账号在自己这台设备上重新登录** —— 不该把自己判成"被顶掉"。登出用 `DELETE` 而非 `active=0`，正是为了这个。
   → Task 4 步骤 1 的 `logging out then back in on the same device is not mistaken for a takeover`
5. **`advance` 推到边界之后** —— 再推、或传负数、小数、超大数，必须被拒且**状态一个字节都不变**。
   → Task 5 步骤 1 的 `advance only accepts whole, sane day counts and changes nothing when it refuses`

---

## 文件结构

**新建**

| 文件 | 职责 |
|---|---|
| `lib/errors.mjs` | `ApiError`，全服务端共用的错误类型（`server.mjs` 里现在有一份局部的，要换成这个） |
| `lib/db.mjs` | 打开数据库、建表。不管任何业务 |
| `lib/state.mjs` | `states` 表的读写，以及账号资料在 `users` 列与 state 对象之间的注入/抽取 |
| `lib/auth.mjs` | 密码哈希、注册、登录、会话解析、登出、登录限速 |
| `lib/actions.mjs` | 动作白名单表，把动作名映射到 `core.mjs` 的函数 |
| `lib/http.mjs` | 请求体读取、cookie 解析与序列化等 HTTP 小工具 |
| `public/login.html` / `public/login.mjs` | 登录/注册页 |
| `public/api.mjs` | 前端 fetch 封装与 401 统一处理 |
| `tests/auth.test.mjs` | 账号与会话的测试 |
| `tests/actions.test.mjs` | 动作表与服务端规则强制的测试 |

**修改**

| 文件 | 改动 |
|---|---|
| `server.mjs` | 加路由与鉴权中间件、静态白名单、未登录跳转、`createServer` 增加 `db` 选项 |
| `public/app.mjs` | 状态改为服务端返回后整体替换；删掉 localStorage 那一套 |
| `tests/server.test.mjs` | 需要登录的接口先注册测试账号 |
| `tests/browser.mjs` | 端到端流程前面加注册/登录 |
| `.env.example` / `README.md` | 加 `DB_PATH`，写"已知限制" |

**删除**：`public/server.mjs`（`public/core.mjs` 的逐字复制，且不在静态白名单里，死代码）。

**依赖顺序**：`errors` → `db` → `state` → `auth` → `actions` → `server` → 前端。`state` 必须早于 `auth`，因为注册时要写初始状态。

---

### Task 1: `lib/errors.mjs` 与 `lib/db.mjs`

**Files:**
- Create: `lib/errors.mjs`
- Create: `lib/db.mjs`
- Test: `tests/db.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `ApiError extends Error`，构造签名 `new ApiError(message, status = 400, code = 'INVALID_INPUT')`，实例带 `.status` `.code`
  - `openDatabase(filename = ':memory:') → DatabaseSync`（已建好表、已开 WAL 与外键）

- [ ] **Step 1: 写失败的测试**

创建 `tests/db.test.mjs`：

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {ApiError} from '../lib/errors.mjs';

test('openDatabase creates every table', () => {
  const db = openDatabase(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['users', 'sessions', 'states', 'login_attempts']) assert(names.includes(t), `missing table ${t}`);
});

test('a user can only ever have one active session', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u1', 'an', 'h', 's', 1, 'an', 'h', 't');
  const add = (token) => db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, 'u1', 'dev', 1, 9e12);
  add('t1');
  assert.throws(() => add('t2'), /UNIQUE constraint failed/);
  db.prepare('UPDATE sessions SET active = 0 WHERE user_id = ? AND active = 1').run('u1');
  add('t2');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 2);
});

test('usernames are unique regardless of case', () => {
  const db = openDatabase(':memory:');
  const add = (u) => db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u_' + u, u, 'h', 's', 1, u, 'h', 't');
  add('An');
  assert.throws(() => add('an'), /UNIQUE constraint failed/);
});

test('deleting a user removes their sessions and state', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u1', 'an', 'h', 's', 1, 'an', 'h', 't');
  db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?,?,?,?,?)').run('t1', 'u1', 'd', 1, 9e12);
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?,?,?)').run('u1', '{}', 1);
  db.prepare('DELETE FROM users WHERE id = ?').run('u1');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) c FROM states').get().c, 0);
});

test('ApiError carries status and code', () => {
  const e = new ApiError('不行。', 401, 'NOPE');
  assert.equal(e.message, '不行。');
  assert.equal(e.status, 401);
  assert.equal(e.code, 'NOPE');
  assert(e instanceof Error);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/db.test.mjs`
Expected: FAIL —— `Cannot find module '../lib/db.mjs'`

- [ ] **Step 3: 实现 `lib/errors.mjs`**

```js
// 全服务端共用的错误类型。带 status 与 code，由 server.mjs 统一转成 JSON 响应。
export class ApiError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
```

- [ ] **Step 4: 实现 `lib/db.mjs`**

```js
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// 建表。IF NOT EXISTS 让重复启动安全。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  habit         TEXT NOT NULL,
  topic         TEXT NOT NULL,
  allow_notes   INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  replaced_by TEXT
);
-- 单设备的关键：一个账号最多只允许一行 active = 1。由数据库强制，不靠应用层自觉。
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_active ON sessions(user_id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS states (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key      TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  first_at INTEGER NOT NULL
);
`;

export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/db.test.mjs`
Expected: PASS（5 个测试）

- [ ] **Step 6: 提交**

```bash
git add lib/errors.mjs lib/db.mjs tests/db.test.mjs
git commit -m "添加数据库开库建表与共用的 ApiError 类型"
```

---

### Task 2: `lib/state.mjs` —— 状态读写与资料注入

**Files:**
- Create: `lib/state.mjs`
- Test: `tests/state.test.mjs`

**Interfaces:**
- Consumes: `openDatabase`（Task 1）、`ApiError`（Task 1）、`public/core.mjs` 的 `freshState` / `validState`
- Produces:
  - `defaultProfile(username) → {name, habit, topic, allowNotes}`
  - `readState(db, userId) → state`（已注入 profile，已通过 `validState`）
  - `writeState(db, userId, state, now = Date.now()) → void`（把 profile 抽进 `users` 列，其余存 JSON）
  - `userById(db, id) → row | undefined`

**关键点**：`states.json` 里**不存 profile**。profile 的唯一真相是 `users` 表的四列。读的时候注入，写的时候抽出。这样不会出现两份资料打架。

- [ ] **Step 1: 写失败的测试**

创建 `tests/state.test.mjs`：

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {openDatabase} from '../lib/db.mjs';
import {readState, writeState, defaultProfile, userById} from '../lib/state.mjs';

function seedUser(db, id = 'u1', username = '小安') {
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run(id, username, 'h', 's', 1, username, '习惯', '话题');
  return id;
}

test('a brand new user reads back a valid fresh state with their profile injected', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  assert(C.validState(s), 'injected state must satisfy the client state machine');
  assert.equal(s.profile.name, '小安');
  assert.equal(s.profile.habit, '习惯');
  assert.equal(s.profile.topic, '话题');
  assert.equal(s.profile.allowNotes, true);
  assert.equal(s.notes.length, 0);
});

test('profile lives in the users table, not in the state JSON', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  s.profile = {name: '改了', habit: '新习惯', topic: '新话题', allowNotes: false};
  writeState(db, id, s);
  const row = userById(db, id);
  assert.equal(row.name, '改了');
  assert.equal(row.habit, '新习惯');
  assert.equal(row.topic, '新话题');
  assert.equal(row.allow_notes, 0);
  const json = JSON.parse(db.prepare('SELECT json FROM states WHERE user_id = ?').get(id).json);
  assert.equal(json.profile, undefined, 'profile must not be duplicated into the JSON blob');
  assert.equal(readState(db, id).profile.allowNotes, false);
});

test('notes and messages survive a write/read round trip', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  C.sendNote(s, 'xia', '你好，很高兴认识你。');
  C.startNoteReply(s, s.notes[0].id);
  C.finishReply(s, 'xia', '很高兴认识你！');
  C.recordFeeling(s, 'xia', 73, '只给自己看');
  writeState(db, id, s);
  const back = readState(db, id);
  assert.deepEqual(back, s);
  assert.equal(back.feelings.xia[0].score, 73);
});

test('a corrupted stored blob is rejected loudly instead of rendering garbage', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?,?,?)').run(id, '{"version":1,"messages":{"xia":[null]}}', 1);
  assert.throws(() => readState(db, id), /损坏/);
});

test('reading a state for a user that does not exist is an auth failure, not a crash', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => readState(db, 'nobody'), (e) => e.status === 401 && e.code === 'UNAUTHENTICATED');
});

test('defaultProfile names the account after its username', () => {
  const p = defaultProfile('小安');
  assert.equal(p.name, '小安');
  assert.equal(p.allowNotes, true);
  assert.equal(typeof p.habit, 'string');
  assert.equal(typeof p.topic, 'string');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/state.test.mjs`
Expected: FAIL —— `Cannot find module '../lib/state.mjs'`

- [ ] **Step 3: 实现 `lib/state.mjs`**

```js
import * as C from '../public/core.mjs';
import {ApiError} from './errors.mjs';

// 注册时资料的初始值：名字取用户名，让用户一眼认得出是自己的账号；
// 习惯与话题沿用 core.mjs 的默认文案。
export function defaultProfile(username) {
  const base = C.freshState().profile;
  return {name: username, habit: base.habit, topic: base.topic, allowNotes: base.allowNotes};
}

export function userById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function profileOf(row) {
  return {name: row.name, habit: row.habit, topic: row.topic, allowNotes: !!row.allow_notes};
}

export function readState(db, userId) {
  const user = userById(db, userId);
  if (!user) throw new ApiError('账号不存在，请重新登录。', 401, 'UNAUTHENTICATED');
  const row = db.prepare('SELECT json FROM states WHERE user_id = ?').get(userId);
  const state = row ? JSON.parse(row.json) : C.freshState();
  // 注入必须发生在校验之前 —— core.mjs 的 validState 要求 profile 存在。
  state.profile = profileOf(user);
  if (!C.validState(state)) throw new ApiError('账号数据损坏，请联系管理员。', 500, 'INTERNAL');
  return state;
}

export function writeState(db, userId, state, now = Date.now()) {
  const p = state.profile;
  db.prepare('UPDATE users SET name = ?, habit = ?, topic = ?, allow_notes = ? WHERE id = ?')
    .run(p.name, p.habit, p.topic, p.allowNotes ? 1 : 0, userId);
  const {profile, ...rest} = state;   // profile 不进 JSON，users 表才是唯一真相
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
    .run(userId, JSON.stringify(rest), now);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/state.test.mjs`
Expected: PASS（6 个测试）

- [ ] **Step 5: 提交**

```bash
git add lib/state.mjs tests/state.test.mjs
git commit -m "添加状态读写与账号资料注入"
```

---

### Task 3: `lib/auth.mjs` —— 密码、校验与注册

**Files:**
- Create: `lib/auth.mjs`
- Test: `tests/auth.test.mjs`

**Interfaces:**
- Consumes: `openDatabase`（Task 1）、`ApiError`（Task 1）、`defaultProfile` / `writeState`（Task 2）
- Produces:
  - `validateCredentials(username, password) → void`（不合法则抛 `ApiError`）
  - `newSalt() → hex string`
  - `hashPassword(password, salt) → hex string`
  - `verifyPassword(password, salt, expectedHex) → boolean`
  - `hashToken(token) → hex string`
  - `newToken() → string`
  - `deviceLabel(userAgent) → string`
  - `register(db, {username, password, userAgent, now}) → {token, user}`
  - 常量 `SESSION_MS`（30 天毫秒数）、`COOKIE_NAME = 'hw_session'`

- [ ] **Step 1: 写失败的测试**

创建 `tests/auth.test.mjs`：

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register, validateCredentials, newSalt, hashPassword, verifyPassword, hashToken, deviceLabel} from '../lib/auth.mjs';
import {readState} from '../lib/state.mjs';

test('password hashing is salted and verifiable', () => {
  const a = newSalt(), b = newSalt();
  assert.notEqual(a, b, 'each salt must be unique');
  const h = hashPassword('correct horse', a);
  assert.equal(h.length, 128);
  assert(verifyPassword('correct horse', a, h));
  assert(!verifyPassword('wrong horse', a, h));
  assert(!verifyPassword('correct horse', b, h), 'a different salt must not verify');
  // 长度对不上时返回 false，不能抛异常。
  assert.equal(verifyPassword('correct horse', a, 'deadbeef'), false);
});

test('credential rules reject bad input with readable Chinese messages', () => {
  assert.throws(() => validateCredentials('ab', 'password12'), /用户名/);
  assert.throws(() => validateCredentials('a'.repeat(21), 'password12'), /用户名/);
  assert.throws(() => validateCredentials('小安', 'password12'), /用户名/, 'non-ASCII usernames are rejected, not passed to SQLite');
  assert.throws(() => validateCredentials('an🙂', 'password12'), /用户名/);
  assert.throws(() => validateCredentials('an_1', 'short'), /密码/);
  assert.throws(() => validateCredentials('an_1', 'x'.repeat(129)), /密码/);
  validateCredentials('an_1', 'password12');
});

test('register creates an account, a fresh state, and a session in one go', () => {
  const db = openDatabase(':memory:');
  const {token, user} = register(db, {username: 'an_1', password: 'password12', userAgent: 'Mozilla/5.0 (iPhone)', now: 1000});
  assert.match(user.id, /^u_[0-9a-f]{32}$/);
  assert.equal(user.username, 'an_1');
  assert.equal(user.name, 'an_1', 'the display name starts as the username');
  const state = readState(db, user.id);
  assert(C.validState(state));
  assert.equal(state.notes.length, 0);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  assert(row, 'a session must be created so the user is logged in right away');
  assert.equal(row.active, 1);
  assert.equal(row.expires_at, 1000 + 30 * 86400000);
});

test('a duplicate username is refused regardless of case, with a readable message', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'password12', now: 1});
  assert.throws(() => register(db, {username: 'AN_1', password: 'password12', now: 1}),
    (e) => e.status === 409 && e.code === 'USERNAME_TAKEN' && /已经被注册/.test(e.message));
});

test('the password never reaches the database in plaintext', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'hunter2hunter2', now: 1});
  const dump = JSON.stringify(db.prepare('SELECT * FROM users').all());
  assert(!dump.includes('hunter2hunter2'));
});

test('a failed registration leaves nothing behind', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => register(db, {username: 'an_1', password: 'short', now: 1}));
  assert.equal(db.prepare('SELECT count(*) c FROM users').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
});

test('deviceLabel turns a user agent into something worth showing a person', () => {
  assert.match(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1'), /iOS/);
  assert.match(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120'), /Android/);
  assert.match(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), /Windows/);
  assert.equal(deviceLabel(''), '未知设备 · 浏览器');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/auth.test.mjs`
Expected: FAIL —— `Cannot find module '../lib/auth.mjs'`

- [ ] **Step 3: 实现 `lib/auth.mjs` 的密码与校验部分**

```js
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {defaultProfile, writeState} from './state.mjs';
import * as C from '../public/core.mjs';

export const COOKIE_NAME = 'hw_session';
export const SESSION_MS = 30 * 86400000;              // 30 天
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export function newSalt() { return randomBytes(16).toString('hex'); }
export function hashPassword(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token) { return createHash('sha256').update(String(token)).digest('hex'); }

export function verifyPassword(password, salt, expectedHex) {
  let actual;
  try { actual = Buffer.from(hashPassword(password, salt), 'hex'); } catch { return false; }
  const expected = Buffer.from(String(expectedHex), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 用户名限 ASCII：中文名走 profile.name，不走登录名。这样也避免把奇怪字符喂给 SQLite。
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    throw new ApiError('用户名需为 3–20 位字母、数字或下划线。');
  const length = typeof password === 'string' ? Array.from(password).length : -1;
  if (length < MIN_PASSWORD || length > MAX_PASSWORD)
    throw new ApiError(`密码需为 ${MIN_PASSWORD}–${MAX_PASSWORD} 个字符。`);
}

export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const kind = /iPhone|iPad|iPod/i.test(ua) ? 'iOS 设备'
    : /Android/i.test(ua) ? 'Android 设备'
    : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows 设备'
    : '未知设备';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : '浏览器';
  return `${kind} · ${browser}`;
}

export function register(db, {username, password, userAgent = '', now = Date.now()}) {
  validateCredentials(username, password);
  const id = 'u_' + randomBytes(16).toString('hex');
  const salt = newSalt();
  const profile = defaultProfile(username);
  const token = newToken();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, username, hashPassword(password, salt), salt, now, profile.name, profile.habit, profile.topic, profile.allowNotes ? 1 : 0);
    const state = C.freshState(now);
    state.profile = profile;
    writeState(db, id, state, now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at, active) VALUES (?,?,?,?,?,1)')
      .run(hashToken(token), id, deviceLabel(userAgent), now, now + SESSION_MS);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (/UNIQUE constraint failed: users\.username/.test(error.message))
      throw new ApiError('这个用户名已经被注册了，换一个试试。', 409, 'USERNAME_TAKEN');
    throw error;
  }
  return {token, user: db.prepare('SELECT * FROM users WHERE id = ?').get(id)};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/auth.test.mjs`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add lib/auth.mjs tests/auth.test.mjs
git commit -m "添加密码哈希、凭据校验与注册"
```

---

### Task 4: `lib/auth.mjs` —— 登录、单设备顶替、登出、限速

**Files:**
- Modify: `lib/auth.mjs`（追加，不删 Task 3 的内容）
- Test: `tests/auth.test.mjs`（追加）

**Interfaces:**
- Consumes: Task 1 与 Task 3 的产物
- Produces:
  - `login(db, {username, password, userAgent, now}) → {token, user, replacedDevice}`（失败抛 401 `BAD_CREDENTIALS`）
  - `resolveSession(db, token, now) → {user, session} | {reason}`，`reason ∈ 'missing' | 'expired' | 'replaced'`
  - `logout(db, token) → void`
  - `failureKey(ip, username) → string`
  - `isLockedOut(db, key, now) → boolean`
  - `recordFailure(db, key, now) → void`
  - `clearFailures(db, key) → void`
  - 常量 `MAX_FAILURES = 10`、`LOCK_MS = 15 * 60000`

**两个要点：**

1. **用户不存在时也要走一次 scrypt。** 否则响应时间会泄露用户名是否存在。用一个固定的假哈希兜底。
2. **登出是 `DELETE` 而不是把 `active` 置 0。** 否则用户下次登录时，`resolveSession` 会把自己那条旧的 `active = 0` 记录当成"被别的设备顶掉"，提示错乱。

（注：spec 里限速那节写的是"内存 Map 即可"，但同一份 spec 的表结构里已经建了 `login_attempts` 表。按表实现，重启后仍然生效，比内存 Map 好，也不多花成本。）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/auth.test.mjs`：

```js
// --- 登录、单设备顶替、登出、限速 -------------------------------------------
import {login, resolveSession, logout, failureKey, isLockedOut, recordFailure, clearFailures} from '../lib/auth.mjs';

test('logging in on a second device kicks the first one off', () => {
  const db = openDatabase(':memory:');
  const first = register(db, {username: 'an_1', password: 'password12',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', now: 1000});
  assert.equal(resolveSession(db, first.token, 1000).user.username, 'an_1');

  const second = login(db, {username: 'an_1', password: 'password12', userAgent: 'Windows NT 10.0 Chrome', now: 2000});
  assert.equal(second.replacedDevice, 'iOS 设备 · Safari');

  const old = resolveSession(db, first.token, 2000);
  assert.equal(old.reason, 'replaced', 'the displaced device must be told why, not just logged out');
  assert.equal(resolveSession(db, second.token, 2000).user.username, 'an_1');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions WHERE active = 1').get().c, 1);
});

test('bad credentials give one message that does not reveal whether the account exists', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'password12', now: 1});
  const wrongPassword = assert.throws(() => login(db, {username: 'an_1', password: 'nope-nope', now: 1}));
  const noSuchUser = assert.throws(() => login(db, {username: 'zz_9', password: 'nope-nope', now: 1}));
  assert.equal(wrongPassword.code, 'BAD_CREDENTIALS');
  assert.equal(noSuchUser.code, 'BAD_CREDENTIALS');
  assert.equal(wrongPassword.message, noSuchUser.message);
  assert(!/不存在/.test(noSuchUser.message));
});

test('logging out then back in on the same device is not mistaken for a takeover', () => {
  const db = openDatabase(':memory:');
  const first = register(db, {username: 'an_1', password: 'password12', now: 1});
  logout(db, first.token);
  const again = login(db, {username: 'an_1', password: 'password12', now: 2});
  const r = resolveSession(db, again.token, 2);
  assert.equal(r.user.username, 'an_1', 'the fresh session must work, not report "replaced"');
  assert.equal(resolveSession(db, first.token, 2).reason, 'missing');
});

test('an expired session is rejected and cleaned up', () => {
  const db = openDatabase(':memory:');
  const {token} = register(db, {username: 'an_1', password: 'password12', now: 1});
  assert.equal(resolveSession(db, token, 1 + 30 * 86400000 + 1).reason, 'expired');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
});

test('an unknown or absent token is simply missing', () => {
  const db = openDatabase(':memory:');
  assert.equal(resolveSession(db, '', 1).reason, 'missing');
  assert.equal(resolveSession(db, 'not-a-real-token', 1).reason, 'missing');
});

test('repeated failures lock the account out for a window, then it frees up', () => {
  const db = openDatabase(':memory:');
  const key = failureKey('10.0.0.5', 'An_1');
  assert.equal(key, failureKey('10.0.0.5', 'an_1'), 'the key must be case-insensitive to match the username rule');
  assert(!isLockedOut(db, key, 0));
  for (let i = 0; i < 10; i++) recordFailure(db, key, 0);
  assert(isLockedOut(db, key, 0));
  assert(!isLockedOut(db, key, 15 * 60000 + 1), 'the lock must expire on its own');
  clearFailures(db, key);
  assert(!isLockedOut(db, key, 0));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/auth.test.mjs`
Expected: FAIL —— `login is not a function`

- [ ] **Step 3: 实现，追加到 `lib/auth.mjs` 末尾**

```js
export const MAX_FAILURES = 10;
const LOCK_MS = 15 * 60000;

// 用户不存在时用它跑一次等价的 scrypt，让响应时间不泄露账号是否存在。
const DUMMY_SALT = newSalt();
const DUMMY_HASH = hashPassword('this password is never valid', DUMMY_SALT);

export function login(db, {username, password, userAgent = '', now = Date.now()}) {
  const row = typeof username === 'string'
    ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)   // COLLATE NOCASE 生效
    : undefined;
  const ok = verifyPassword(typeof password === 'string' ? password : '', row ? row.salt : DUMMY_SALT, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new ApiError('用户名或密码不正确。', 401, 'BAD_CREDENTIALS');

  const device = deviceLabel(userAgent);
  const previous = db.prepare('SELECT device FROM sessions WHERE user_id = ? AND active = 1').get(row.id);
  const token = newToken();
  db.exec('BEGIN');
  try {
    // 顶替：把旧会话标成 active = 0 并记下是谁顶的，用户下次操作时才能看到有用的提示。
    db.prepare('UPDATE sessions SET active = 0, replaced_by = ? WHERE user_id = ? AND active = 1').run(device, row.id);
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (active = 0 AND created_at < ?)').run(now, now - 7 * 86400000);
    db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at, active) VALUES (?,?,?,?,?,1)')
      .run(hashToken(token), row.id, device, now, now + SESSION_MS);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return {token, user: row, replacedDevice: previous ? previous.device : ''};
}

export function resolveSession(db, token, now = Date.now()) {
  if (!token) return {reason: 'missing'};
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  if (!row) return {reason: 'missing'};
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return {reason: 'expired'};
  }
  if (!row.active) return {reason: 'replaced', replacedBy: row.replaced_by || ''};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  return user ? {user, session: row} : {reason: 'missing'};
}

// 删除而不是置 active = 0：否则用户重新登录时会被自己那条旧记录误判成"被顶掉"。
export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function failureKey(ip, username) { return `${ip}|${String(username || '').toLowerCase()}`; }

export function isLockedOut(db, key, now = Date.now()) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (!row) return false;
  if (now - row.first_at > LOCK_MS) { db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key); return false; }
  return row.failures >= MAX_FAILURES;
}

export function recordFailure(db, key, now = Date.now()) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (!row || now - row.first_at > LOCK_MS)
    db.prepare('INSERT INTO login_attempts (key, failures, first_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures = 1, first_at = excluded.first_at').run(key, now);
  else
    db.prepare('UPDATE login_attempts SET failures = failures + 1 WHERE key = ?').run(key);
}

export function clearFailures(db, key) { db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key); }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/auth.test.mjs`
Expected: PASS（13 个测试）

- [ ] **Step 5: 提交**

```bash
git add lib/auth.mjs tests/auth.test.mjs
git commit -m "添加登录、单设备顶替、登出与登录限速"
```

---

### Task 5: `lib/actions.mjs` —— 动作白名单与服务端规则强制

**Files:**
- Create: `lib/actions.mjs`
- Test: `tests/actions.test.mjs`

**Interfaces:**
- Consumes: `readState` / `writeState`（Task 2）、`ApiError`（Task 1）、`core.mjs`
- Produces:
  - `ACTIONS`：`{动作名: (state, body, user) => result}` 的表，含一个仅限服务端的 `finishReply`
  - `runAction(db, user, type, body, now = Date.now(), {internal = false} = {}) → {state, result}`
    —— `internal: true` 才允许调用 `finishReply`，`/api/action` 永远不传它

**为什么重要**：前端**只能发这张表里的动作**，服务端不接受"整份状态"上传。纸条额度、周期、屏蔽这些规则因此由 `core.mjs` 在服务端执行，用户改不动。

**两个易错点**：

1. `core.mjs` 的校验失败抛的是**普通 `Error`**（带中文文案），不是 `ApiError`。必须转成 400，否则会变成 500。
2. `advance` 的 `days`、`recordFeeling` 的 `score` 必须是**真正的整数**。不校验的话 `"1" + 1` 会变成 `"11"`，用户能一次推进 11 天。

- [ ] **Step 1: 写失败的测试**

创建 `tests/actions.test.mjs`：

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {readState} from '../lib/state.mjs';
import {runAction, ACTIONS} from '../lib/actions.mjs';

function account(patch = {}) {
  const db = openDatabase(':memory:');
  const {user} = register(db, {username: 'an_1', password: 'password12', now: 1000});
  return {db, user: {...user, ...patch}};
}

test('an action persists and the next read sees it', () => {
  const {db, user} = account();
  const {state, result} = runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  assert.equal(state.notes.length, 1);
  assert.equal(result.id, state.notes[0].id, 'the created note is handed back so the client can act on it');
  assert.equal(readState(db, user.id).notes.length, 1, 'it must be on disk, not just in memory');
});

test('the daily note quota is enforced by the server, not the client', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '第一张'});
  runAction(db, user, 'sendNote', {personId: 'yu', text: '第二张'});
  assert.throws(() => runAction(db, user, 'sendNote', {personId: 'ning', text: '第三张'}),
    (e) => e.status === 400 && /机会已用完/.test(e.message));
  assert.equal(readState(db, user.id).notes.length, 2, 'the refused note must not be persisted');
});

test('an action outside the whitelist is refused', () => {
  const {db, user} = account();
  assert.throws(() => runAction(db, user, 'grantMyselfNotes', {count: 99}), (e) => e.code === 'UNKNOWN_ACTION');
  assert.throws(() => runAction(db, user, 'constructor', {}), (e) => e.code === 'UNKNOWN_ACTION');
  assert.throws(() => runAction(db, user, '__proto__', {}), (e) => e.code === 'UNKNOWN_ACTION');
});

test('a client cannot smuggle a whole state in and have it stored', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '真的'});
  runAction(db, user, 'sendNote', {personId: 'yu', text: '真的', state: {notes: [], feelings: {xia: [{score: 99}]}}});
  const s = readState(db, user.id);
  assert.equal(s.notes.length, 2, 'the extra state field must be ignored entirely');
  assert.equal(s.feelings.xia, undefined);
});

test('advance only accepts whole, sane day counts and changes nothing when it refuses', () => {
  const {db, user} = account();
  runAction(db, user, 'advance', {days: 7});
  assert.equal(readState(db, user.id).offsetDays, 7);
  for (const days of ['7', 1.5, -1, NaN, null, Infinity, 3651]) {
    assert.throws(() => runAction(db, user, 'advance', {days}), undefined, `days=${String(days)} must be refused`);
  }
  assert.equal(readState(db, user.id).offsetDays, 7, 'a refused advance must leave the state untouched');
  assert.throws(() => runAction(db, user, 'advance', {days: 3650}), /上限/);
});

test('a feeling score must be a real integer in range', () => {
  const {db, user} = account();
  runAction(db, user, 'recordFeeling', {personId: 'xia', score: 73, memo: '只给自己看'});
  for (const score of ['73', 20.5, -1, 101, null]) {
    assert.throws(() => runAction(db, user, 'recordFeeling', {personId: 'xia', score}), undefined, `score=${String(score)} must be refused`);
  }
  assert.equal(readState(db, user.id).feelings.xia.length, 1);
});

test('a rejected action leaves the stored state exactly as it was', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  const before = JSON.stringify(readState(db, user.id));
  // 越界的分数一定被拒（core.mjs 的 recordFeeling 本来就会挡，服务端再挡一道）。
  assert.throws(() => runAction(db, user, 'recordFeeling', {personId: 'xia', score: 101}));
  assert.throws(() => runAction(db, user, 'sendNote', {personId: 'xia', text: '还没有人回应我呢'}));
  assert.equal(JSON.stringify(readState(db, user.id)), before);
});

test('saveProfile writes through to the users row', () => {
  const {db, user} = account();
  runAction(db, user, 'saveProfile', {profile: {name: '小安', habit: '慢热', topic: '今天如何', allowNotes: false}});
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(row.name, '小安');
  assert.equal(row.allow_notes, 0);
  assert.equal(readState(db, user.id).profile.name, '小安');
});

test('reset clears the interactions but keeps the account and its username', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '你好'});
  runAction(db, user, 'reset', {});
  const s = readState(db, user.id);
  assert.equal(s.notes.length, 0);
  assert.equal(s.offsetDays, 0);
  assert.equal(s.profile.name, 'an_1', 'the display name falls back to the username, not to a stranger');
  assert(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), 'the account itself must survive');
});

test('saveScenario takes the cycle from the server, not from the client', () => {
  const {db, user} = account();
  runAction(db, user, 'saveScenario', {personId: 'xia', intent: 'closer', authorized: true, cycle: 999});
  assert.equal(readState(db, user.id).scenarios.xia.cycle, 0);
});

test('finishReply exists for the server but cannot be triggered from the client', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  assert.throws(() => runAction(db, user, 'finishReply', {personId: 'xia', text: '我假装是 AI'}),
    (e) => e.code === 'UNKNOWN_ACTION', 'a client must not be able to forge an AI reply');
  const {state} = runAction(db, user, 'finishReply', {personId: 'xia', text: '真的回复'}, Date.now(), {internal: true});
  assert.equal(state.messages.xia.at(-1).content, '真的回复');
});

test('every action name maps to a function', () => {
  for (const [name, fn] of Object.entries(ACTIONS)) assert.equal(typeof fn, 'function', `${name} must be callable`);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/actions.test.mjs`
Expected: FAIL —— `Cannot find module '../lib/actions.mjs'`

- [ ] **Step 3: 实现 `lib/actions.mjs`**

```js
import * as C from '../public/core.mjs';
import {ApiError} from './errors.mjs';
import {readState, writeState, defaultProfile} from './state.mjs';

const str = (value, name) => {
  if (typeof value !== 'string') throw new ApiError(`${name} 必须是文本。`);
  return value;
};
const int = (value, name) => {
  if (!Number.isInteger(value)) throw new ApiError(`${name} 必须是整数。`);
  return value;
};

// 白名单。前端只能发这里列出的动作 —— 服务端不接受"整份状态"上传，
// 所以纸条额度、周期、屏蔽这些规则由 core.mjs 在服务端执行，客户端改不动。
export const ACTIONS = {
  sendNote:       (s, b) => C.sendNote(s, str(b.personId, 'personId'), str(b.text, 'text')),
  sendMessage:    (s, b) => C.sendMessage(s, str(b.personId, 'personId'), str(b.text, 'text')),
  startNoteReply: (s, b) => C.startNoteReply(s, str(b.noteId, 'noteId')),
  incomingAction: (s, b) => C.incomingAction(s, str(b.noteId, 'noteId'), str(b.op, 'op'), b.text),
  blockPerson:    (s, b) => C.blockPerson(s, str(b.personId, 'personId')),
  injectNote:     (s, b) => C.injectNote(s, str(b.personId, 'personId')),
  review:         (s, b) => C.review(s, str(b.personId, 'personId'), str(b.intent, 'intent'), !!b.authorized),
  confirmHeart:   (s, b) => C.confirmHeart(s, str(b.personId, 'personId')),
  recordFeeling:  (s, b) => {
    const score = int(b.score, 'score');
    // 自己挡一道，不依赖 core.mjs 内部怎么判 —— 这样负数也是明确的 400 而不是别的什么。
    if (score < 0 || score > 100) throw new ApiError('好感度需为 0–100 的整数。');
    return C.recordFeeling(s, str(b.personId, 'personId'), score, typeof b.memo === 'string' ? b.memo : '');
  },
  saveScenario:   (s, b) => {
    s.scenarios[str(b.personId, 'personId')] = {
      intent: str(b.intent, 'intent'),
      authorized: !!b.authorized,
      cycle: C.cycleOf(s),          // 周期由服务端取，不信客户端传的值
    };
  },
  saveProfile:    (s, b) => {
    const p = b.profile || {};
    s.profile = {
      name: C.cleanText(p.name, 20),
      habit: C.cleanText(p.habit, 100),
      topic: C.cleanText(p.topic, 100),
      allowNotes: !!p.allowNotes,
    };
  },
  advance:        (s, b) => {
    const days = int(b.days, 'days');
    if (days < 0) throw new ApiError('天数不能为负。');
    const next = s.offsetDays + days;
    if (next > 3650) throw new ApiError('演示时间已达上限，请重置。');
    s.offsetDays = next;
  },
  reset:          (s, b, user) => {
    const fresh = C.freshState();
    fresh.profile = defaultProfile(user.username);
    // 不 return —— 这里返回什么，响应里就会多带一份什么，而整份状态已经在 state 字段里了。
    Object.assign(s, fresh);
  },
  // 由服务端在 AI 回复返回后调用。前端直接发它会得到"不支持的操作"——
  // 否则任何人都能伪造一条 AI 回复塞进自己的对话里。
  finishReply:    (s, b) => C.finishReply(s, str(b.personId, 'personId'), str(b.text, 'text')),
};

// 只允许服务端内部调用的动作。
const SERVER_ONLY = new Set(['finishReply']);

export function runAction(db, user, type, body, now = Date.now(), {internal = false} = {}) {
  // 用 hasOwn 挡住 constructor / __proto__ 这类原型链上的名字。
  if (typeof type !== 'string' || !Object.hasOwn(ACTIONS, type) || (SERVER_ONLY.has(type) && !internal))
    throw new ApiError('不支持的操作。', 400, 'UNKNOWN_ACTION');
  const state = readState(db, user.id);
  let result;
  try {
    result = ACTIONS[type](state, body && typeof body === 'object' ? body : {}, user);
  } catch (error) {
    // core.mjs 的校验失败抛的是普通 Error，带中文文案。转成 400，否则会变成 500。
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || '操作没有成功。', 400, 'INVALID_INPUT');
  }
  writeState(db, user.id, state, now);
  return {state, result};
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/actions.test.mjs`
Expected: PASS（11 个测试）

- [ ] **Step 5: 提交**

```bash
git add lib/actions.mjs tests/actions.test.mjs
git commit -m "添加动作白名单，把业务规则强制在服务端"
```

---

### Task 6: `lib/http.mjs` 与 `server.mjs` 路由鉴权接线

**Files:**
- Create: `lib/http.mjs`
- Modify: `server.mjs`（改动集中在路由与鉴权，见步骤 5 的逐条清单）
- Modify: `tests/server.test.mjs`（需要登录的接口先注册账号）

**Interfaces:**
- Consumes: Task 1–5 的全部产物
- Produces:
  - `readJson(req, maxBytes = 64000) → object`（超限抛 413，坏 JSON 抛 400）
  - `cookieOf(req, name) → string`
  - `sessionCookie(token, maxAgeSeconds) → string`
  - `clearCookie(name) → string`
  - `createServer(config, {fetchImpl, timeout, db} = {}) → http.Server`（不传 `db` 时按 `config.dbPath` 开库）
  - `readConfig(...)` 的返回值新增一个 `dbPath` 字段

**路由表**

| 方法 | 路径 | 鉴权 | 行为 |
|---|---|---|---|
| GET | `/api/status` | 否 | 原样保留 |
| POST | `/api/register` | 否 | 建号并登录，`Set-Cookie` |
| POST | `/api/login` | 否 | 登录，`Set-Cookie`，含限速 |
| POST | `/api/logout` | 是 | 删会话，清 cookie |
| GET | `/api/me` | 是 | `{user:{id,username,name}, state}` |
| POST | `/api/action` | 是 | `runAction` → `{state, result}` |
| POST | `/api/reply` | 是 | 调 AI → `finishReply` → `{state}` |
| POST | `/api/suggestions` | 是 | 调 AI → `{suggestions}`（不落库） |
| POST | `/api/check` | 是 | 调 AI → `{ok:true}` |
| GET | `/`、`/index.html` | 否* | 有会话给 `index.html`，没有则 302 `/login.html` |
| GET | `/login.html` | 否* | 有会话则 302 `/` |
| GET | `/login.mjs`、`/app.mjs`、`/core.mjs`、`/api.mjs`、`/style.css` | 否 | 静态文件 |

\* 这两个路径不做 401，而是做 302 跳转 —— 浏览器地址栏访问时跳转比 JSON 错误好得多。

- [ ] **Step 1: 更新现有测试**

`tests/server.test.mjs` 里有两处会因鉴权失效，改成先注册。把第 8 行的 `config` 之后加上辅助函数，并改掉 `withServer`：

```js
import {openDatabase} from '../lib/db.mjs';

const db = () => openDatabase(':memory:');

// 注册一个测试账号并返回带 cookie 的请求头。
async function signIn(url, username = 'tester1') {
  const res = await fetch(url + '/api/register', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username, password: 'password12'}),
  });
  assert.equal(res.status, 200, 'test account registration must succeed');
  return res.headers.getSetCookie()[0].split(';')[0];   // 'hw_session=...'
}

async function withServer(t, options = {}) {
  const server = createServer(config, {db: db(), ...options});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  return `http://127.0.0.1:${server.address().port}`;
}
```

然后把那一处断言静态首页的改成断言跳转：

```js
  assert.equal((await fetch(url + '/', {redirect: 'manual'})).status, 302, 'logged-out visitors go to the login page');
```

并把 `/api/check` 与 `/api/suggestions` 的用例改成带上 cookie：

```js
test('mock upstream validates authorization and successful API flows', async t => {
  let sent;
  const url = await withServer(t, {fetchImpl: async (u, opt) => { sent = {u, opt}; return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(suggestions)}}]}), {status: 200}); }});
  const cookie = await signIn(url);
  const r = await fetch(url + '/api/suggestions', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify({personId: 'xia', messages: [], profile})});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).suggestions.length, 3);
  assert.equal(sent.u, config.base + '/chat/completions');
  assert.equal(sent.opt.headers.Authorization, 'Bearer ' + config.key);
});
```

局域网那几组用例也要跟着改，因为 `/api/check` 现在需要登录，而 `withLanServer` 起的服务还不带数据库：

```js
// rawRequest 现在要把响应头带回来 —— 注册接口靠 Set-Cookie 下发会话。
function rawRequest(port,pathname,{method='GET',headers={},body,connectTo='127.0.0.1',localAddress}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:connectTo,port,path:pathname,method,headers,localAddress},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text,headers:res.headers}))});
  req.on('error',reject);if(body)req.write(body);req.end();
 });
}
async function withLanServer(t,overrides={},listenOn='127.0.0.1'){
 const server=createServer({...config,...overrides},{db:openDatabase(':memory:'),fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'连接成功'}}]}),{status:200})});
 await new Promise(r=>server.listen(0,listenOn,r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 return server.address().port;
}
// 局域网用例里凡是要 POST /api/check 的，都得先有个账号。
async function lanCookie(port){
 const res=await rawRequest(port,'/api/register',{method:'POST',headers:{'Content-Type':'application/json',host:`127.0.0.1:${port}`},body:JSON.stringify({username:'lan_user',password:'password12'})});
 assert.equal(res.status,200,'the LAN test account must register');
 return res.headers['set-cookie'][0].split(';')[0];
}
```

那条 `assert.equal(ok.status,200)` 的用例（`a LAN Origin is accepted for POST only when LAN is enabled`）里，只有 `allowed` 这一行需要带 cookie —— 它之前的 `refused` 断的是 403，而同源检查排在鉴权之前，所以不带 cookie 也仍然是 403：

```js
 const on=await withLanServer(t,{lan:true});
 const allowed=await rawRequest(on,'/api/check',{method:'POST',headers:{...json,host:`${lanIps[0]}:${on}`,Origin:`http://${lanIps[0]}:${on}`,cookie:await lanCookie(on)},body:'{}'});
 assert.equal(allowed.status,200);
 assert.equal(JSON.parse(allowed.body).ok,true);
```

- [ ] **Step 2: 追加鉴权相关的测试**

追加到 `tests/server.test.mjs`：

```js
// --- 鉴权、单设备顶替、跨账号隔离 ---------------------------------------------
test('everything under /api except status, register and login requires a session', async t => {
  const url = await withServer(t);
  assert.equal((await fetch(url + '/api/status')).status, 200, 'the login page needs status to render');
  const post = (path) => fetch(url + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
  for (const path of ['/api/action', '/api/logout', '/api/reply', '/api/suggestions', '/api/check']) {
    assert.equal((await post(path)).status, 401, `${path} must not be reachable without a session`);
  }
  assert.equal((await fetch(url + '/api/me')).status, 401, 'GET /api/me must not leak the state either');
  // 方法用错时要给出 405，而不是把人绕到 404 上去猜。
  assert.equal((await post('/api/me')).status, 405);
  // 注册和登录本身当然不需要会话。
  assert.equal((await post('/api/login')).status, 401, 'a login attempt with no credentials fails on the credentials, not on the session');
});

test('the login page is served to visitors and skipped once signed in', async t => {
  const url = await withServer(t);
  const root = await fetch(url + '/', {redirect: 'manual'});
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/login.html');
  assert.equal((await fetch(url + '/login.html')).status, 200);
  assert.equal((await fetch(url + '/login.mjs')).status, 200);
  const cookie = await signIn(url);
  const back = await fetch(url + '/login.html', {headers: {cookie}, redirect: 'manual'});
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/');
  assert.equal((await fetch(url + '/', {headers: {cookie}})).status, 200);
  // 被顶掉的设备直接刷新页面时，跳转链接里要带上原因，登录页才好解释。
  const kicked = await signIn(url, 'kicked1');
  await fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'kicked1', password: 'password12'})});
  assert.equal((await fetch(url + '/', {headers: {cookie: kicked}, redirect: 'manual'})).headers.get('location'), '/login.html?reason=replaced');
});

test('a displaced device is told why on its next request', async t => {
  const url = await withServer(t);
  const first = await signIn(url, 'tester1');
  const second = await fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'tester1', password: 'password12'})});
  assert.equal(second.status, 200);
  const res = await fetch(url + '/api/me', {headers: {cookie: first}});
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'SESSION_REPLACED', 'the code is what lets the client explain itself instead of silently logging out');
  assert.match(body.error, /另一台设备/);
});

test('a stale tab cannot roll back another tab’s work', async t => {
  // 同一浏览器开两个标签页时共用同一个 cookie，"一账号一设备"管不到它们。
  // 但客户端只发动作、不发状态，所以后发的那个不会把先发的覆盖掉。
  const url = await withServer(t);
  const cookie = await signIn(url);
  const stale = await (await fetch(url + '/api/me', {headers: {cookie}})).json();
  const post = (payload) => fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify(payload)});
  await post({type: 'sendNote', personId: 'xia', text: '标签页 A 写的'});
  await post({type: 'sendNote', personId: 'yu', text: '标签页 B 写的'});
  const now = await (await fetch(url + '/api/me', {headers: {cookie}})).json();
  assert.equal(now.state.notes.length, 2, 'both tabs’ notes must survive');
  assert.equal(stale.state.notes.length, 0, 'the stale copy is simply out of date, which is harmless — it is never sent back');
});

test('two accounts cannot see each other', async t => {
  const url = await withServer(t);
  const a = await signIn(url, 'alice1');
  const b = await signIn(url, 'bob_22');
  const post = (cookie, payload) => fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify(payload)});
  assert.equal((await post(a, {type: 'sendNote', personId: 'xia', text: '爱丽丝的纸条'})).status, 200);
  const seen = await (await fetch(url + '/api/me', {headers: {cookie: b}})).json();
  assert.equal(seen.state.notes.length, 0, 'bob must not see alice notes');
  assert(!JSON.stringify(seen).includes('爱丽丝的纸条'));
});

test('logout drops the session immediately', async t => {
  const url = await withServer(t);
  const cookie = await signIn(url);
  assert.equal((await fetch(url + '/api/logout', {method: 'POST', headers: {cookie}})).status, 200);
  assert.equal((await fetch(url + '/api/me', {headers: {cookie}})).status, 401);
});

test('a user cannot smuggle in an action the server does not have', async t => {
  const url = await withServer(t);
  const cookie = await signIn(url);
  const res = await fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify({type: 'setOffsetDays', offsetDays: 3000})});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'UNKNOWN_ACTION');
});

test('login failures are rate limited', async t => {
  const url = await withServer(t);
  await signIn(url, 'tester1');
  const attempt = () => fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'tester1', password: 'wrong-password'})});
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429, 'the eleventh try must be locked out');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test tests/server.test.mjs`
Expected: FAIL —— `/api/register` 返回 404

- [ ] **Step 4: 实现 `lib/http.mjs`**

```js
import {ApiError} from './errors.mjs';

export async function readJson(req, maxBytes = 64000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError('请求内容过长。', 413, 'TOO_LARGE');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new ApiError('请求不是有效 JSON。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('请求格式错误。');
  return body;
}

export function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

// 不加 Secure：服务跑在 http 上，加了浏览器根本不会回传 cookie，登录直接失效。
export function sessionCookie(name, token, maxAgeSeconds) {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie(name) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
```

- [ ] **Step 5: 改写 `server.mjs`**

`accessPolicy`、`listenHost`、`lanAddresses`、`clientIp`、`makeMessages`、`completion`、`parseSuggestions` 与文件末尾的启动块**一字不改**。改动只有下面这几处：

1. 删掉文件里的局部 `class ApiError`（第 42 行），改成 `import {ApiError} from './lib/errors.mjs';`。

2. `readConfig` 的返回值多一个 `dbPath`（第 23 行那个 `return {...}` 里加一项，别的不动）：

```js
 const dbPath=take('DB_PATH')||path.join(root,'runtime','app.db');
```
```js
 return {base,key,model,port,lan,lanFlag,allowIps,dbPath,configured:valid&&!!key&&!!model&&key!=='your-api-key'&&model!=='your-model-name'};
```

`root` 用的是 `readConfig` 的第一个参数（默认项目根目录），所以 `runtime/app.db` 落在项目里，而 `runtime/` 已经在 `.gitignore` 里了。
3. 顶部加：

```js
import {openDatabase} from './lib/db.mjs';
import {readJson, cookieOf, sessionCookie, clearCookie} from './lib/http.mjs';
import {COOKIE_NAME, SESSION_MS, register, login, logout, resolveSession, failureKey, isLockedOut, recordFailure, clearFailures} from './lib/auth.mjs';
import {runAction} from './lib/actions.mjs';
import {readState} from './lib/state.mjs';
```

4. 静态白名单加三个文件：

```js
  const whitelist={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/core.mjs':'core.mjs','/api.mjs':'api.mjs','/style.css':'style.css','/login.html':'login.html','/login.mjs':'login.mjs'};
```

5. `createServer` 签名与鉴权辅助：

```js
export function createServer(config, {fetchImpl = fetch, timeout = 35000, db} = {}) {
  const database = db || openDatabase(config.dbPath || path.join(ROOT, 'runtime', 'app.db'));
```

在 `createServer` 内部、`json()` 旁边，加一个设置 cookie 的辅助与鉴权函数：

```js
  // 只把能给浏览器看的字段发出去 —— users 表里还有 password_hash 和 salt。
  const publicUser = (user) => ({id: user.id, username: user.username, name: user.name});

  // 解析当前请求的会话。要么返回 {user, token}，要么返回 {denied}。
  // "被顶掉"要和"从没登录过"分开，因为前者需要给用户一句解释，后者不需要。
  function authenticate(req) {
    const token = cookieOf(req, COOKIE_NAME);
    const found = resolveSession(database, token);
    if (found.user) return {user: found.user, token};
    if (found.reason === 'replaced') return {denied: {error: '你的账号已在另一台设备登录，请重新登录。', code: 'SESSION_REPLACED'}};
    return {denied: {error: '请先登录。', code: 'UNAUTHENTICATED'}};
  }
```

6. 静态资源与页面跳转。把原来第 84–87 行那段（`/api/status` 与静态白名单）换成：

```js
   // —— 页面跳转 ——
   // 页面用 302 而不是 401：这是浏览器地址栏访问，跳转比一个 JSON 错误有用得多。
   // 被顶掉的人直接刷新页面时，查询串把原因带过去，登录页才能解释一句为什么。
   if (req.method === 'GET') {
    const who = authenticate(req);
    if ((url.pathname === '/' || url.pathname === '/index.html') && !who.user)
     return redirect(res, who.denied?.code === 'SESSION_REPLACED' ? '/login.html?reason=replaced' : '/login.html');
    if (url.pathname === '/login.html' && who.user) return redirect(res, '/');
   }

   // —— 静态文件 ——
   if (req.method === 'GET' && Object.hasOwn(whitelist, url.pathname)) {
    const file = whitelist[url.pathname];
    const content = await fs.promises.readFile(path.join(ROOT, 'public', file));
    res.writeHead(200, {...headers, 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'});
    return res.end(content);
   }
```

配套加一个 `redirect` 辅助（放在 `json()` 旁边）：

```js
  function redirect(res, location) { res.writeHead(302, {...headers, Location: location}); res.end() }
```

7. `/api` 分派。把原来从 `if (req.method==='GET' && url.pathname==='/api/status')` 到 `if (url.pathname==='/api/check')` 那一整段换成：

```js
   if (req.method === 'GET' && url.pathname === '/api/status')
    return json(200, {app: 'heart-window-demo', configured: config.configured, model: config.configured ? config.model : '', version: '1.0.0'});

   // /api/me 是唯一的 GET 业务接口，必须在下面那道"只收 POST"的关卡之前处理。
   if (url.pathname === '/api/me') {
    if (req.method !== 'GET') return json(405, {error: '请求方法不正确。', code: 'METHOD_NOT_ALLOWED'});
    const who = authenticate(req);
    if (who.denied) return json(401, who.denied);
    return json(200, {user: publicUser(who.user), state: readState(database, who.user.id)});
   }

   if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return json(404, {error: '页面或接口不存在。', code: 'NOT_FOUND'});

   // 同源与 Content-Type 检查保留，对登录接口一样适用。
   const origins = new Set([origin, `http://localhost:${port}`, ...lanNames.map(ip => `http://${ip}:${port}`)]);
   if (req.headers.origin && !origins.has(req.headers.origin)) throw new ApiError('不允许跨站调用。', 403, 'FORBIDDEN');
   if (req.headers['sec-fetch-site'] === 'cross-site' || !(req.headers['content-type'] || '').startsWith('application/json'))
    throw new ApiError('仅接受同源 JSON 请求。', 403, 'FORBIDDEN');

   const body = await readJson(req);
   const client = clientIp(req);

   if (url.pathname === '/api/register') {
    const {token, user} = register(database, {username: body.username, password: body.password, userAgent: req.headers['user-agent'] || ''});
    res.setHeader('Set-Cookie', sessionCookie(COOKIE_NAME, token, SESSION_MS / 1000));
    return json(200, {user: publicUser(user)});
   }

   if (url.pathname === '/api/login') {
    const key = failureKey(client, body.username);
    if (isLockedOut(database, key)) throw new ApiError('失败次数过多，请 15 分钟后再试。', 429, 'RATE_LIMITED');
    let result;
    try { result = login(database, {username: body.username, password: body.password, userAgent: req.headers['user-agent'] || ''}); }
    catch (error) { if (error.code === 'BAD_CREDENTIALS') recordFailure(database, key); throw error; }
    clearFailures(database, key);
    res.setHeader('Set-Cookie', sessionCookie(COOKIE_NAME, result.token, SESSION_MS / 1000));
    return json(200, {user: publicUser(result.user), replacedDevice: result.replacedDevice});
   }

   // —— 以下全部需要登录 ——
   const auth = authenticate(req);
   if (auth.denied) return json(401, auth.denied);
   const user = auth.user;

   if (url.pathname === '/api/logout') {
    logout(database, auth.token);
    res.setHeader('Set-Cookie', clearCookie(COOKIE_NAME));
    return json(200, {ok: true});
   }

   if (url.pathname === '/api/action') {
    if (active >= 4) throw new ApiError('已有多个请求进行中，请稍后重试。', 429, 'BUSY');
    active++;
    try {
      const {state, result} = runAction(database, user, body.type, body);
      return json(200, {state, result: result === undefined ? null : result});
    } finally { active-- }
   }

   if (!['/api/reply', '/api/suggestions', '/api/check'].includes(url.pathname)) return json(404, {error: '页面或接口不存在。', code: 'NOT_FOUND'});
   if (active >= 4) throw new ApiError('已有多个请求进行中，请稍后重试。', 429, 'BUSY');
   active++;
   try {
    if (url.pathname === '/api/check') { await completion(config, [{role: 'user', content: '请只回复：连接成功'}], fetchImpl, timeout); return json(200, {ok: true}) }

    // 资料一律取自服务端状态，不接受客户端传进来的 profile。
    const state = readState(database, user.id);
    const profile = {name: state.profile.name, habit: state.profile.habit, topic: state.profile.topic};

    if (url.pathname === '/api/suggestions') {
      // 建议不落库，是纯读操作，上下文由客户端给（它可能正在写一条还没发出去的话）。
      const result = await completion(config, makeMessages({...body, profile}, 'suggestions'), fetchImpl, timeout);
      return json(200, {suggestions: parseSuggestions(result)});
    }

    // 回复的上下文同样取自服务端，客户端说了不算 —— 否则可以伪造一整段对话历史去诱导模型。
    // 注意这里在 await 之前读状态、await 之后才写回，中间用户可能已经改了状态；
    // finishReply 在 pending 已被清掉时（例如刚屏蔽了该人物）返回 false，不会写脏数据。
    const history = (state.messages[body.personId] || []).slice(-16);
    // 纸条来往的第一轮：对话记录还是空的，把那张纸条作为用户这一侧的内容接上去。
    const pending = state.pending[body.personId];
    let context = body.context;
    if (pending?.kind === 'note') {
      const note = state.notes.find(n => n.id === pending.noteId);
      if (note) history.push({role: 'user', content: note.text});
      context = '对方回应你主页上话题后递来的第一张纸条，请礼貌接话。';
    }
    const result = await completion(config, makeMessages({...body, messages: history, context, profile}, 'reply'), fetchImpl, timeout);
    const applied = runAction(database, user, 'finishReply', {personId: body.personId, text: result}, Date.now(), {internal: true});
    return json(200, {state: applied.state, text: result.slice(0, 3000)});
   } finally { active-- }
```

8. 上面的 `/api/reply` 里调用 `finishReply` 时**必须传 `{internal: true}`**，这是 Task 5 就已经定好的第六个参数。`lib/actions.mjs` 在本任务里不需要再改一个字 —— `finishReply` 条目与 `SERVER_ONLY` 集合都在 Task 5 里写好了。

- [ ] **Step 6: 跑全部测试确认通过**

Run: `node --test tests/*.test.mjs`
Expected: PASS（`db` `state` `auth` `actions` `core` `server` 全部通过）

- [ ] **Step 7: 手动确认服务能起来**

Run: `node -e "import('./server.mjs').then(m=>{const db=m.createServer({configured:false,model:'',dbPath:':memory:'}).listen(0,'127.0.0.1',async()=>{const p=process.argv[1];const base='http://127.0.0.1:'+p;const r=await fetch(base+'/',{redirect:'manual'});console.log('GET / ->',r.status,r.headers.get('location'));process.exit(0)})})" 0` —— 太绕，直接用这条：

```bash
node -e "
import('./server.mjs').then(async (m) => {
  const s = m.createServer({configured: false, model: '', dbPath: ':memory:'});
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + s.address().port;
  const root = await fetch(base + '/', {redirect: 'manual'});
  console.log('GET / ->', root.status, root.headers.get('location'));
  const login = await fetch(base + '/login.html');
  console.log('GET /login.html ->', login.status);
  s.close(); process.exit(0);
});
"
```
Expected: `GET / -> 302 /login.html` 和 `GET /login.html -> 200`

- [ ] **Step 8: 提交**

```bash
git add lib/http.mjs lib/actions.mjs server.mjs tests/server.test.mjs tests/actions.test.mjs
git commit -m "给服务端接上注册、登录、鉴权与动作路由"
```

---

### Task 7: 登录页与前端 API 封装

**Files:**
- Create: `public/login.html`
- Create: `public/login.mjs`
- Create: `public/api.mjs`
- Modify: `public/style.css`（末尾追加登录页样式）

**Interfaces:**
- Consumes: Task 6 的接口
- Produces:
  - `public/api.mjs` 导出 `post(path, body) → Promise<data>`、`get(path) → Promise<data>`、`sessionLost(reason) → void`
  - 这两个函数在收到 401 时统一处理：`SESSION_REPLACED` 跳 `/login.html?reason=replaced`，`UNAUTHENTICATED` 跳 `/login.html`，并抛出 `Error` 让调用方保留草稿。

- [ ] **Step 1: 写 `public/api.mjs`**

```js
// 前端统一的接口封装。401 一律在这里处理掉，调用方只要管自己的错。
export class ApiFailure extends Error {
  constructor(message, code = 'INTERNAL', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// 被顶掉或掉线时会整页跳走，跳走之前给调用方一次抢救未发送内容的机会。
let onLeave = () => {};
export function beforeLeaving(fn) { onLeave = fn; }

function leave(reason) {
  const target = reason === 'SESSION_REPLACED' ? '/login.html?reason=replaced' : '/login.html';
  if (location.pathname === '/login.html') return;
  try { onLeave(); } catch { /* 抢救失败也不能拦住跳转 */ }
  location.replace(target);
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    throw new ApiFailure('请求中断或超时。请检查连接后重试，已写下的内容仍然保留。', 'NETWORK');
  }
  let data;
  try { data = await res.json(); } catch { throw new ApiFailure('服务响应格式异常。', 'FORMAT', res.status); }
  if (res.status === 401) {
    // 先跳转再抛错：调用方捕获后什么都不用做，草稿仍在输入框里。
    leave(data.code);
    throw new ApiFailure(data.error || '登录状态已失效。', data.code || 'UNAUTHENTICATED', 401);
  }
  if (!res.ok) throw new ApiFailure(data.error || '请求失败，请重试。', data.code, res.status);
  return data;
}

export const post = (path, body) => request('POST', path, body ?? {});
export const get = (path) => request('GET', path, undefined);
```

- [ ] **Step 2: 写 `public/login.html`**

```html
<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f4ec"><meta name="description" content="谁能打开你的窗：为慢热的你，留一个从容的开始。"><title>登录 · 谁能打开你的窗</title><link rel="stylesheet" href="/style.css"></head><body><div id="app"></div><div id="toast" role="status" aria-live="polite"></div><script type="module" src="/login.mjs"></script></body></html>
```

- [ ] **Step 3: 写 `public/login.mjs`**

```js
import {post} from './api.mjs';

const app = document.getElementById('app');
const e = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const reason = new URLSearchParams(location.search).get('reason');
let mode = 'login';
let busy = false;
const notices = {replaced: '你的账号已在另一台设备登录，这里已退出。重新登录即可继续。'};

function render(error = '') {
  app.innerHTML = `
   <main class="auth">
    <div class="auth-card">
     <div class="auth-brand"><span class="window-mark" aria-hidden="true"></span><span><b>谁能打开<br>你的窗</b><small>AT YOUR OWN PACE</small></span></div>
     <h1>${mode === 'login' ? '欢迎回来' : '留一扇窗'}</h1>
     <p class="smallprint">${mode === 'login' ? '同一个账号同时只能在一台设备上登录，换设备登录会让原来的设备退出。' : '用户名 3–20 位字母、数字或下划线，密码至少 8 位。'}</p>
     ${reason && mode === 'login' && !error ? `<div class="notice"><span>${e(notices[reason] || '')}</span></div>` : ''}
     ${error ? `<div class="error-box" role="alert">${e(error)}</div>` : ''}
     <form id="auth-form">
      <label class="field"><span>用户名</span><input id="username" name="username" autocomplete="username" maxlength="20" required></label>
      <label class="field"><span>密码</span><input id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" maxlength="128" required></label>
      <button type="submit" class="btn full"${busy ? ' disabled' : ''}>${busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并进入'}</button>
     </form>
     <button type="button" class="link-btn" id="switch">${mode === 'login' ? '还没有账号？注册一个' : '已经有账号了？去登录'}</button>
    </div>
   </main>`;
  document.getElementById('auth-form').addEventListener('submit', submit);
  document.getElementById('switch').addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; render(); });
}

async function submit(event) {
  event.preventDefault();
  if (busy) return;
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  busy = true;
  render();
  try {
    await post(mode === 'login' ? '/api/login' : '/api/register', {username, password});
    location.replace('/');
  } catch (error) {
    busy = false;
    // 把输入过的用户名留着，只清密码。
    render(error.message);
    document.getElementById('username').value = username;
    document.getElementById('password').focus();
  }
}

render();
```

- [ ] **Step 4: 追加登录页样式到 `public/style.css` 末尾**

```css
.auth{min-height:100vh;display:grid;place-items:center;padding:24px}.auth-card{width:min(400px,100%);background:var(--white);border:1px solid var(--line);border-radius:12px;padding:34px 30px;box-shadow:var(--shadow)}.auth-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.auth-brand .window-mark{height:39px;width:29px;border:1px solid var(--green);border-radius:18px 18px 0 0;position:relative;flex-shrink:0}.auth-brand .window-mark:after{content:"";position:absolute;left:50%;top:0;bottom:0;border-left:1px solid var(--green)}.auth-brand b{display:block;font-family:"SimSun",serif;font-size:18px;letter-spacing:1px;line-height:1.7;font-weight:400}.auth-brand small{font-size:8px;letter-spacing:2px;color:var(--muted)}.auth-card h1{font-size:26px;margin:0 0 10px}.auth-card .btn.full{margin-top:8px}.auth-card .link-btn{margin-top:18px;display:block}
```

- [ ] **Step 5: 手动验证**

Run: `node server.mjs`，然后浏览器打开 `http://127.0.0.1:3210`
Expected：
1. 自动跳到 `/login.html`，看到登录卡片，无控制台报错。
2. 用 `ab` / `1` 注册 → 提示"用户名需为 3–20 位…"，页面不刷新，用户名还在。
3. 用 `an_1` / `123` 注册 → 提示密码长度。
4. 用 `an_1` / `password12` 注册 → 进入应用主页。
5. 手动访问 `/login.html` → 跳回 `/`。

- [ ] **Step 6: 提交**

```bash
git add public/login.html public/login.mjs public/api.mjs public/style.css
git commit -m "添加登录注册页与前端接口封装"
```

---

### Task 8: `public/app.mjs` 改造

**Files:**
- Modify: `public/app.mjs`

**Interfaces:**
- Consumes: Task 6 的接口、Task 7 的 `public/api.mjs`（`post` / `get` / `beforeLeaving`）
- Produces: 无（叶子节点）

**要改成什么**：状态不再由前端计算，而是每次动作后由服务端返回、整体替换本地 `s`。删掉 localStorage 那一整套（`STORE`、`save()` 的写入、`broken`、`storageIssue`、`backup`、`recover`）。

**这一节里几个容易漏的点：**

- `s` 是**服务端状态的副本**。任何 `C.xxx(s, ...)` 的直接调用都要消失 —— 那样改的是副本，刷新就没了。
- `save()` 保留成空函数。`generateReply` / `generateSuggestions` 里的调用点不动，行为已经由服务端负责。
- `me` 既是渲染函数名，又是原来的账号字段名。新的账号变量叫 `account`，不要用 `me`。
- 草稿的 id 是 `draft-聊天:xia`，选择器里带冒号，测试里要按属性选（`[data-draft="chat:xia"]`）。

- [ ] **Step 1: 改文件头**

第 1–2 行：

```js
import * as C from './core.mjs';
const STORE='heart-window-demo-v1';
```

换成：

```js
import * as C from './core.mjs';
import {post,get,beforeLeaving} from './api.mjs';
```

第 7–8 行那两个 `let s,storageIssue='',broken=false;` 与 `try{const raw=localStorage...}catch{...}`：

```js
let s,storageIssue='',broken=false;
try{const raw=localStorage.getItem(STORE);s=raw?JSON.parse(raw):C.freshState();if(!C.validState(s))throw new Error('invalid')}catch{broken=true;s=C.freshState()}
```

换成：

```js
// s 只是服务端状态的最近一份副本 —— 唯一真相在服务端。
let s=C.freshState();
let account=null;   // 当前登录的账号 {id, username, name}
```

- [ ] **Step 2: `save()` 换成空函数，并新增 `applyState` 与草稿抢救**

第 14 行整行：

```js
function save(){try{localStorage.setItem(STORE,JSON.stringify(s));storageIssue=''}catch{storageIssue='浏览器无法保存数据，当前操作仅在此页面有效，请勿刷新。'}}
```

换成：

```js
// 状态已经在产生它的那次 /api/action 里落库了，这里不需要做任何事。
// 保留这个函数是因为 generateReply / generateSuggestions 里还有调用点，留着更省事。
function save(){}
// 服务端返回的 state 是唯一真相，整体替换，不做增量合并。
function applyState(next){s=next}
// 被顶掉或掉线时会整页跳走，先把没发出去的草稿存一份，回来再取。
const DRAFT_KEY='heart-window-drafts';
function stashDrafts(){try{sessionStorage.setItem(DRAFT_KEY,JSON.stringify(ui.drafts))}catch{}}
function restoreDrafts(){try{const raw=sessionStorage.getItem(DRAFT_KEY);if(!raw)return;ui.drafts=JSON.parse(raw)||{};sessionStorage.removeItem(DRAFT_KEY)}catch{}}
beforeLeaving(stashDrafts);
```

- [ ] **Step 3: 加服务端动作映射与统一的 `submit`**

接在第 14 行（现在的 `beforeLeaving(stashDrafts);`）之后插入：

```js
// ui 动作名 → 服务端动作。这张表就是前端能动用的全部写操作。
const SERVER_ACTIONS={
 'submit-note':(id)=>['sendNote',{personId:id,text:ui.drafts['note:'+id]||''}],
 'simulate-reply':(id)=>['startNoteReply',{noteId:id}],
 'send-chat':(id)=>['sendMessage',{personId:id,text:ui.drafts['chat:'+id]||''}],
 'submit-reply-note':(id)=>['incomingAction',{noteId:id,op:'reply',text:ui.drafts['reply:'+id]||''}],
 'save-note':(id)=>['incomingAction',{noteId:id,op:'save'}],
 'decline-note':(id)=>['incomingAction',{noteId:id,op:'decline'}],
 'block':(id)=>['blockPerson',{personId:id}],
 'save-feeling':(id)=>['recordFeeling',{personId:id,score:Number(ui.drafts.score),memo:ui.drafts.memo||''}],
 'save-review':(id)=>['review',{personId:id,intent:ui.drafts.review.intent,authorized:!!ui.drafts.review.authorized}],
 'submit-knock':(id)=>['confirmHeart',{personId:id}],
 'save-profile':()=>['saveProfile',{profile:{...ui.drafts.profile}}],
 'advance':(id)=>['advance',{days:Number(id)}],
 'save-scenario':()=>['saveScenario',{personId:ui.selected,intent:document.getElementById('demo-intent').value,authorized:document.getElementById('demo-auth').checked}],
 'inject':()=>['injectNote',{personId:ui.selected}],
 'reset':()=>['reset',{}],
};
// 每个响应都带最新的完整状态，直接换掉本地副本。
async function submit(action,id){
 const build=SERVER_ACTIONS[action];if(!build)throw new Error('不支持的操作。');
 const [type,body]=build(id);
 const data=await post('/api/action',{type,...body});
 applyState(data.state);return data.result;
}
```

- [ ] **Step 4: `warning()` 去掉 `storageIssue`**

第 19 行开头：

```js
function warning(){const q=quota();return `${storageIssue?`<div class="notice error">${e(storageIssue)}</div>`:''}${!ai.ready?`
```

换成：

```js
function warning(){const q=quota();return `${!ai.ready?`
```

- [ ] **Step 5: `me()` 显示账号并加登出**

第 28 行里有四处要改：

1. `<span class="avatar">安</span>` → 用账号名的首字
2. `<span class="subtle">你的本地演示身份</span>` → 显示登录名
3. `<p class="smallprint">陌生人纸条：${s.profile.allowNotes?'接收中':'已关闭'} · 数据仅保存在当前浏览器</p>`
4. 结尾那行按钮

```js
<div class="chat-heading"><span class="avatar">安</span><div><h2>${e(s.profile.name)}</h2><span class="subtle">你的本地演示身份</span></div></div>
```

换成：

```js
<div class="chat-heading"><span class="avatar">${e(Array.from(account?.name||s.profile.name)[0]||'窗')}</span><div><h2>${e(s.profile.name)}</h2><span class="subtle">账号 ${e(account?.username||'')}</span></div></div>
```

```js
<p class="smallprint">陌生人纸条：${s.profile.allowNotes?'接收中':'已关闭'} · 数据仅保存在当前浏览器</p>
```

换成：

```js
<p class="smallprint">陌生人纸条：${s.profile.allowNotes?'接收中':'已关闭'} · 数据保存在服务端，同一账号同一时间只能登录一台设备</p>
```

```js
<div class="row-actions">${btn('AI 设置','config','','link-btn')}${btn('演示控制面板','demo','','link-btn')}</div>
```

换成：

```js
<div class="row-actions">${btn('AI 设置','config','','link-btn')}${btn('演示控制面板','demo','','link-btn')}${btn('退出登录','logout','','link-btn')}</div>
```

- [ ] **Step 6: `render()` 去掉 `broken` 分支**

第 30 行整行：

```js
 if(broken){app.innerHTML='<div class="recovery"><h1>本地数据暂时无法读取</h1><p>数据未被覆盖。可以先导出原始备份，再确认重置此 Demo。</p>'+btn('导出原始备份','backup','','btn secondary')+' '+btn('确认重置 Demo','recover','','btn')+'</div>';return}
```

整行删掉 —— 服务端状态要么读得到，要么就是 401，没有"读出一半"这回事。

- [ ] **Step 7: `status()` 换成 `boot()`**

第 54 行整行：

```js
async function status(){try{const r=await fetch('/api/status');if(!r.ok)throw new Error();const d=await r.json();ai.configured=!!d.configured;ai.model=d.model;ai.loaded=true;ai.ready=false;ai.error=''}catch{ai.configured=false;ai.ready=false;ai.error='本地服务不可用，请确认启动脚本正在运行。'}render()}
```

换成：

```js
// 启动：先问服务端"我是谁"，一次调用同时拿到账号和整份状态。
// 没登录的话 api.mjs 会直接跳登录页，不会走到这里之后的逻辑。
async function boot(){
 try{
  const data=await get('/api/me');
  account=data.user;applyState(data.state);restoreDrafts();
  const r=await fetch('/api/status');
  if(!r.ok)throw new Error();
  const d=await r.json();ai.configured=!!d.configured;ai.model=d.model;ai.loaded=true;ai.ready=false;ai.error='';
 }catch(err){ai.configured=false;ai.ready=false;ai.error=err.message||'本地服务不可用，请确认启动脚本正在运行。'}
 render();
}
```

- [ ] **Step 8: 删掉 `api()`，三处调用点改走 `post`**

第 55 行整行删掉：

```js
async function api(route,body){let r;try{r=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)})}catch{ai.ready=false;throw new Error('请求中断或超时。请检查连接后重试，已写下的内容仍然保留。')}let data;try{data=await r.json()}catch{throw new Error('本地服务响应格式异常。')}if(!r.ok){if(['AUTH','NETWORK','TIMEOUT','NOT_CONFIGURED'].includes(data.code))ai.ready=false;throw new Error(data.error||'请求失败，请重试。')}return data}
```

超时、坏 JSON、401 都已经由 `api.mjs` 统一处理，这里不再需要它。调用点改成：

- `await api('check',{})` → `await post('/api/check',{})`
- `const data=await api('reply',context)` → `const data=await post('/api/reply',context)`
- `const data=await api('suggestions',body)` → `const data=await post('/api/suggestions',body)`

`ai.ready=false` 那处判断挪进各自的 `catch`：

```js
 }catch(err){if(['AUTH','NETWORK','TIMEOUT','NOT_CONFIGURED'].includes(err.code))ai.ready=false;ai.error=err.message}
```

（`check-ai` 那处已经有 `ai.ready=false`，不用重复加。）

- [ ] **Step 9: `generateReply` 用服务端返回的状态**

第 58 行整行：

```js
async function generateReply(id){requireAI();if(ui.busy)throw new Error('请等待当前请求完成。');const pending=s.pending[id];if(!pending)return;ui.busy=id;ui.error='';render();try{const context=contextFor(id);if(pending.kind==='note'){const n=s.notes.find(n=>n.id===pending.noteId);context.messages=[{role:'user',content:n.text}];context.context='对方回应你主页上话题后递来的第一张纸条，请礼貌接话。'}const data=await api('reply',context);C.finishReply(s,id,data.text);save();ui.tab='chat';ui.person=id;toast('AI 已回应。你可以继续聊，也可以记下感受。')}catch(err){ui.error=err.message;toast(err.message)}finally{ui.busy='';render()}}
```

换成：

```js
async function generateReply(id){requireAI();if(ui.busy)throw new Error('请等待当前请求完成。');const pending=s.pending[id];if(!pending)return;ui.busy=id;ui.error='';render();try{const context=contextFor(id);if(pending.kind==='note')context.context='对方回应你主页上话题后递来的第一张纸条，请礼貌接话。';const data=await post('/api/reply',context);applyState(data.state);ui.tab='chat';ui.person=id;toast('AI 已回应。你可以继续聊，也可以记下感受。')}catch(err){if(['AUTH','NETWORK','TIMEOUT','NOT_CONFIGURED'].includes(err.code))ai.ready=false;ui.error=err.message;toast(err.message)}finally{ui.busy='';render()}}
```

注意 `C.finishReply(s,id,data.text)` 必须去掉 —— 回复现在由 `/api/reply` 里的服务端写进状态，`data.state` 里已经包含了。也不再需要为纸条单独拼 `context.messages`：服务端会用自己那份记录，并在 `pending.kind === 'note'` 时把纸条内容接上去（见 Task 6 步骤 6）。`contextFor` 里的 `messages` 对 `/api/reply` 会被服务端忽略，对 `/api/suggestions` 仍然有用，所以 `contextFor` 本身不动。

- [ ] **Step 10: `generateSuggestions` 改走 `post`**

第 60 行里的 `const data=await api('suggestions',body);ui.suggestions[key]=data.suggestions` 与 `catch` 改成：

```js
 try{const data=await post('/api/suggestions',body);ui.suggestions[key]=data.suggestions}catch(err){if(['AUTH','NETWORK','TIMEOUT','NOT_CONFIGURED'].includes(err.code))ai.ready=false;ui.error=err.message;toast(err.message)}finally{ui.busy='';render()}}
```

- [ ] **Step 11: 改写 `action()`**

第 61–93 行整个函数换成：

```js
async function action(action,id){
 if(action==='close'){closeModal();return}
 if(action==='tab'){closeModal();ui.tab=id;ui.error='';render();return}
 if(action==='paper-tab'){ui.paperTab=id;render();return}
 if(action==='open-chat'){closeModal();ui.person=id;ui.tab='chat';ui.error='';render();return}
 if(action==='logout'){try{await post('/api/logout',{})}catch{}location.replace('/login.html');return}
 if(['config','person','report','demo','note','feel','review','reply-note','profile','knock'].includes(action)){if(['note','reply-note'].includes(action)&&!ai.ready){openModal('config');toast('先连接 AI，再开始交流。');return}openModal(action,id);return}
 if(action==='refresh-ai'){await boot();return}
 if(action==='check-ai'){if(ui.busy||ai.checking)return;ai.checking=true;ai.error='';render();try{await post('/api/check',{});ai.ready=true;toast('AI 连接成功，可以开始体验。')}catch(err){ai.ready=false;ai.error=err.message}finally{ai.checking=false;render()}return}
 if(action==='suggest'){await generateSuggestions(id);return}
 if(action==='choose'){const split=id.lastIndexOf('|'),key=id.slice(0,split),index=Number(id.slice(split+1));ui.drafts[key]=ui.suggestions[key][index].text;render();document.getElementById('draft-'+key)?.focus();return}
 if(ui.busy||ai.checking)throw new Error('请等待当前 AI 请求结束后再操作。');

 if(action==='simulate-reply'){requireAI();const n=await submit(action,id);await generateReply(n.personId);return}
 if(action==='retry'){await generateReply(id);return}
 if(action==='send-chat'){requireAI();await submit(action,id);delete ui.suggestions['chat:'+id];await generateReply(id);return}
 if(action==='submit-reply-note'){requireAI();const n=await submit(action,id);ui.drafts['reply:'+id]='';closeModal();ui.tab='chat';ui.person=n.personId;await generateReply(n.personId);return}
 if(action==='submit-knock'){if(!document.getElementById('knock-consent').checked)throw new Error('请先确认自己的意愿与双向揭晓授权。');const c=await submit(action,id);openModal('result',c.id);return}
 if(action==='result-done'){closeModal();ui.tab='me';return}
 if(action==='reset-confirm'){openModal('reset');return}

 // 其余全是"发一次服务端动作、再按结果调整界面"的同一种形状。
 await submit(action,id);
 if(action==='submit-note'){ui.drafts['note:'+id]='';closeModal();ui.tab='notes';ui.paperTab='out';toast('纸条已递出。可以点击演示按钮，让 AI 回应。')}
 else if(action==='save-note')toast('已暂存，仅你可见。')
 else if(action==='decline-note')toast('已归档，对方不会收到拒绝通知。')
 else if(action==='block'){closeModal();toast('已屏蔽此人物，并撤回揭晓授权。')}
 else if(action==='save-feeling'){closeModal();toast('已记入心笺，仅自己可见。')}
 else if(action==='save-review'){closeModal();toast('已保存本周期的意愿与授权。')}
 else if(action==='save-profile'){closeModal();toast('已保存你的交流习惯与话题。')}
 else if(action==='advance')toast('已推进演示日期。')
 else if(action==='save-scenario')toast('虚拟人物的本周期状态已更新。')
 else if(action==='inject'){closeModal();ui.tab='notes';ui.paperTab='in';toast('已加入一张标注为预设的演示来信。')}
 else if(action==='reset'){ui.drafts={};ui.suggestions={};ui.intents={};ui.error='';ui.tab='meet';ui.person='xia';ui.selected='xia';closeModal();toast('已恢复初始演示状态，AI 配置保留。')}
 render();
}
```

与旧版的差别，逐条对照：

| 旧写法 | 新写法 | 为什么 |
|---|---|---|
| `C.sendNote(s,id,text);save()` | `await submit('submit-note',id)` | 规则改由服务端执行 |
| `const n=C.startNoteReply(s,id)` | `const n=await submit('simulate-reply',id)` | 同上；返回值仍是那张纸条 |
| `C.sendMessage(s,id,text)` | `await submit('send-chat',id)` | 同上 |
| `C.recordFeeling(...)` / `C.review(...)` / `C.blockPerson(...)` | 对应的 `submit(...)` | 同上 |
| `s.offsetDays+=Number(id)` 与那行 3650 判断 | `await submit('advance',id)` | 边界检查必须在服务端，否则改一下前端就能绕 |
| `if(s.offsetDays+Number(id)>3650)throw ...` | 已删除 | 服务端返回的中文错误会经 `toast` 显示出来 |
| `action==='backup'` / `action==='recover'` | 两个分支都删除 | 没有本地数据了，也就没有"读不出来"这回事 |
| （无） | `action==='logout'` | 新增 |

- [ ] **Step 12: 改 reset 弹窗的两句文案**

第 50 行 demo 面板结尾：

```js
<p class="smallprint">重置不会删除 .env 或修改原来的介绍网页。</p>
```

换成：

```js
<p class="smallprint">重置不会删除 .env，账号本身也会保留，只清除纸条、聊天、心笺、授权与模拟时间。</p>
```

第 51 行 reset 确认弹窗：

```js
else if(type==='reset'){title='重置这个 Demo？';body='<p>这会清除当前浏览器的纸条、聊天、心笺、授权、额度和模拟时间，恢复初始虚拟人物。</p><p class="smallprint">仅清除本应用的本地记录，不影响 API 配置或其他文件。</p>'+btn('确认清除并重新开始','reset','','btn',!!ui.busy)}
```

换成：

```js
else if(type==='reset'){title='重置这个 Demo？';body='<p>这会清除当前账号的纸条、聊天、心笺、授权、额度和模拟时间，恢复初始虚拟人物。</p><p class="smallprint">账号本身会保留，用户名和密码都不变。也不影响 API 配置或其他文件。</p>'+btn('确认清除并重新开始','reset','','btn',!!ui.busy)}
```

- [ ] **Step 13: 改启动那行**

第 98 行：

```js
if(!broken)save();render();status();
```

换成：

```js
boot();
```

- [ ] **Step 14: 手动验证完整流程**

Run: `node server.mjs`，浏览器开 `http://127.0.0.1:3210`。
Expected：
1. 自动跳到登录页；注册 `an_1` / `password12` → 进入主页，四个 tab 都能切。
2. 配好 `.env` 后点状态胶囊 → "检查连接" → 通过 → 递一张纸条 → "让 AI 回应这张纸条" → 回复出现。
3. 刷新页面 → 纸条、对话、心笺都还在（数据在服务端）。
4. 在同一台机器上再开一个隐身窗口登录**同一个**账号 → 回到原窗口随便点一下 → 提示"你的账号已在另一台设备登录"并跳登录页。
5. 在原窗口被顶掉前先在输入框里打几个字；被顶掉后重新登录 → 那几句话应该回到输入框里（`sessionStorage` 抢救）。
6. 点"退出登录" → 回登录页 → 用同一账号重新登录 → 正常进入，**不要**出现"已在另一台设备登录"的提示（这正是登出用 `DELETE` 而不是 `active=0` 的原因）。
7. 走一遍"重置全部演示数据" → 纸条清空、账号名还在、"我的"页仍显示登录名。

- [ ] **Step 15: 提交**

```bash
git add public/app.mjs
git commit -m "前端状态改为服务端权威，去掉 localStorage 存储"
```


### Task 9: 更新 `tests/browser.mjs` 端到端脚本

**Files:**
- Modify: `tests/browser.mjs`

**注意**：这个脚本写死了 Windows 上的 Chrome 路径（`C:/Program Files/Google/Chrome/Application/chrome.exe`），在 macOS 上跑不了。它也不在 `npm test` 的 glob 里（那是 `tests/*.test.mjs`），要手动 `node tests/browser.mjs`。**改完必须在 Windows 机器上跑一次**，跑不了就如实说"未在本机验证"，不要跳过不提。

改动有四类，按顺序做。

- [ ] **Step 1: 给两个测试服务器都接上内存数据库**

第 6 行加 import：

```js
import {openDatabase} from '../lib/db.mjs';
```

第 10 行的 `createServer(config, {fetchImpl: ...})` 与第 19 行的 `createServer({configured:false,model:''})` 都要带 `db` —— 不传的话它们会去开真实的 `runtime/app.db`，测试每跑一次就往里塞一个账号：

```js
const server=createServer({configured:true,base:'https://test.invalid/v1',key:'TEST_ONLY_KEY',model:'test-model'},{db:openDatabase(':memory:'),fetchImpl:async(url,options)=>{
```

```js
const errors=[];let context;const unconfigured=createServer({configured:false,model:''},{db:openDatabase(':memory:')});await new Promise(r=>unconfigured.listen(0,'127.0.0.1',r));
```

- [ ] **Step 2: 加注册/登录辅助，并在开头注册一个本次运行的账号**

第 20 行 `try{` 之后、第 21 行之前插入：

```js
 // 首页现在会跳到登录页，所以每个测试服务器都要先有个账号。
 async function register(page,base,username){
  await page.goto(base+'/login.html');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('password12');
  await page.getByRole('button',{name:'注册并进入'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
 }
 async function signIn(page,base,username){
  await page.goto(base+'/login.html');
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill('password12');
  await page.getByRole('button',{name:'登录'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
 }
 // 用户名规则是 3–20 位字母、数字或下划线，所以时间戳要转成 36 进制再截。
 const account='ua_'+Date.now().toString(36).slice(-8);
```

第 22 行：

```js
 await page.goto(url);await page.getByRole('button',{name:'AI 待检查',exact:true}).waitFor();
```

换成：

```js
 await register(page,url,account);await page.getByRole('button',{name:'AI 待检查',exact:true}).waitFor();
```

（`getByLabel` 能定位到 `login.html` 里的输入框，因为 `label.field` 包住了 `<span>用户名</span><input id="username">`。若定位不到，改用 `page.locator('#username')` / `page.locator('#password')`。）

- [ ] **Step 3: 重置之后加一条"账号还在"的断言**

第 70 行 `assert.equal(await page.locator('.person-card').count(),3);` 之后插入：

```js
 await page.locator('.bottom-nav').getByRole('button',{name:'我的',exact:true}).click();
 assert((await page.locator('.smallprint').filter({hasText:'数据保存在服务端'}).count())>0,'the account must survive a demo reset');
```

（重置现在清的是服务端那份状态，账号本身不删 —— 这条断言就是钉住这一点。）

- [ ] **Step 4: 改未配置服务的走法**

第 74 行：

```js
 await page.goto(`http://127.0.0.1:${unconfigured.address().port}`);await page.getByRole('button',{name:'配置 AI',exact:true}).waitFor();
```

换成：

```js
 // 端口不同 = 源不同 = cookie 不通用，这个服务器上要单独注册。
 const coldBase=`http://127.0.0.1:${unconfigured.address().port}`;
 await register(page,coldBase,'cfg_1');await page.getByRole('button',{name:'配置 AI',exact:true}).waitFor();
```

- [ ] **Step 5: 在结尾加"被顶掉 + 草稿抢救"的断言**

在最后的 `assert.deepEqual(errors,[])` 之前插入：

```js
 // —— 被另一台设备顶掉 -------------------------------------------------------
 // 注意要用独立的 context：同一个 context 共用 cookie，那样顶不掉自己。
 await page.locator('.bottom-nav').getByRole('button',{name:'对话',exact:true}).click();
 await page.locator('[data-draft="chat:xia"]').fill('这句话不能被弄丢');
 const other=await browser.newContext({viewport:{width:390,height:844}});
 const second=await other.newPage();
 await signIn(second,url,account);
 await page.getByRole('button',{name:'AI 已连接',exact:true}).click();
 await page.getByRole('button',{name:'检查连接（会调用模型）',exact:true}).click();
 await page.waitForURL(u=>u.pathname.startsWith('/login'),{timeout:10000});
 assert((await page.locator('.notice').innerText()).includes('另一台设备'),'the displaced device must be told why');
 // 被顶掉前写在输入框里的话，重新登录后要回来 —— 整页跳转会让它消失，所以先存了 sessionStorage。
 await signIn(page,url,account);
 await page.locator('.bottom-nav').getByRole('button',{name:'对话',exact:true}).click();
 assert.equal(await page.locator('[data-draft="chat:xia"]').inputValue(),'这句话不能被弄丢','an unsent draft must survive being signed out');
 await other.close();
```

`页面顶掉后点的是"AI 已连接"` —— 这时 `ai.ready` 已经是 `true`（前面检查过连接），所以状态胶囊上的文字是"AI 已连接"而不是"AI 待检查"。点它只打开设置面板，不会发请求；真正打服务端的是面板里的"检查连接"，返回 401 → `api.mjs` 跳转 → 跳转前把草稿存进 `sessionStorage`。

- [ ] **Step 6: 更新收尾那句 log**

第 76 行的 `console.log('PASS: ...')` 里加上新覆盖的内容：

```js
 console.log('PASS: mobile + desktop overflow, login gate, configuration gate, suggestions, editable note, AI reply, failure retry without duplicate, private feelings, authorization, both outcomes, persistence, cycle advance, inbox save/archive, reset, single-device takeover, draft survival.');
```

- [ ] **Step 7: 在 Windows 机器上运行**

Run: `node tests/browser.mjs`
Expected: `PASS: mobile + desktop overflow, login gate, ...` 且截图写进 `runtime/screenshots`

如果这台机器上没有测试用的 Chrome，如实说明"未能在本机验证"，不要把这一步勾掉当没发生。

- [ ] **Step 8: 提交**

```bash
git add tests/browser.mjs
git commit -m "端到端脚本适配登录流程，并加被顶掉与草稿抢救的断言"
```


### Task 10: 清理与文档

**Files:**
- Delete: `public/server.mjs`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `package.json`（只改 `test` 脚本，不动依赖）

- [ ] **Step 1: 确认 `public/server.mjs` 确实是死代码再删**

Run: `grep -rn "server.mjs" --include=*.mjs --include=*.html --include=*.json --include=*.ps1 --include=*.md . | grep -v node_modules | grep -v "^./server.mjs"`
Expected: 除了 `tests/browser.mjs` 里的 `'../server.mjs'`（那是根目录那个）之外，没有别处引用 `public/server.mjs`。
确认后再跑：

```bash
git rm public/server.mjs
```

- [ ] **Step 2: 更新 `.env.example`**

在 `PORT=3210` 之后加：

```dotenv
# 账号与互动数据的 SQLite 文件。留空则用 runtime/app.db（该目录已在 .gitignore 中）。
# 这个文件里存着所有人的账号和聊天记录，不要提交、不要外发。
DB_PATH=
```

- [ ] **Step 3: 更新 `README.md`**

在"启动"一节之后插入新的一节，并改掉原来"三点务必先知道"里的第 1 条（那条说 `/api/*` 没有鉴权，现在已经有了）：

```markdown
## 账号

第一次打开会进入登录页。注册一个账号即可开始，用户名 3–20 位字母、数字或下划线，密码至少 8 位。账号和全部互动数据都存在服务端的 SQLite 里（默认 `runtime/app.db`），换设备登录同一账号能看到自己的记录。

**一个账号同时只能在一台设备上登录。** 在第二台设备登录会顶掉第一台 —— 原设备下一次点击时会提示"你的账号已在另一台设备登录"并退回登录页。

## 已知限制

这是一个课程作业，以下都**没有**做，不要在真实环境里这样用：

- **令牌在局域网内是明文传输的。** 服务跑在 HTTP 上，所以会话 cookie 没有加 `Secure` 标记 —— 加了浏览器就不会回传，登录会直接失效。上线必须换 HTTPS 并把 `Secure` 加回去。
- **没有找回密码。** 忘记密码只能直接改数据库里的 `users` 表。
- **会话固定 30 天过期**，不滑动续期。
- **被顶掉的设备不会实时收到通知**，要等它下一次操作时才发现。
- **聊天对象仍是三个 AI 模拟人物**，不是真实用户，也没有真人匹配。
- 没有邮箱验证、验证码、设备指纹。
```

并把原来那节的第 1 条改成：

```markdown
1. **`/api/*` 现在需要登录。** 登录门槛之外还保留了原有的 Host、Origin、`Sec-Fetch-Site` 与 `ALLOW_IPS` 检查。但会话令牌在局域网内是明文传输的（见"已知限制"），只在你信任的网络里开，用完把 `ALLOW_LAN` 改回 0 并重启。
```

同时把第 2 条"数据不共享…存在各设备自己的浏览器 localStorage"改掉：

```markdown
2. **数据在服务端，按账号隔离。** 同一账号换设备登录能看到自己的记录；不同账号互相看不到对方的数据。
```

- [ ] **Step 4: 更新 `package.json` 的测试脚本**

`tests/browser.mjs` 需要手动跑，别让它影响 `npm test`。当前 glob 是 `tests/*.test.mjs`，它本来就不在内，**不用改**。只确认一遍：

Run: `npm test`
Expected: 全部 PASS，且输出里**没有** `browser.mjs`

- [ ] **Step 5: 跑一次全量测试**

Run: `npm test`
Expected: `db` `state` `auth` `actions` `core` `server` 全部通过，0 失败

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "删除重复文件、补充 DB_PATH 配置与已知限制说明"
```

---

## 收尾检查

全部任务完成后，逐条确认：

- [ ] `npm test` 全绿
- [ ] `public/core.mjs` 的 git diff 为空
- [ ] `package.json` 没有新增依赖字段
- [ ] 手动走一遍：注册 → 递纸条 → AI 回复 → 刷新数据还在 → 换浏览器登录被顶掉 → 登出 → 重新登录
- [ ] 浏览器控制台无 CSP 报错
