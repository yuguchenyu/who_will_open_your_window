import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {seedLegacyCollection} from './draw.mjs';

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
CREATE TABLE IF NOT EXISTS matching_profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  self_intro    TEXT NOT NULL,
  desired_intro TEXT NOT NULL,
  self_tags     TEXT NOT NULL DEFAULT '[]',
  desired_tags  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending',
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS draw_records (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('real','virtual')),
 person_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','liked','skipped')),
 created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS draw_one_pending ON draw_records(user_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS draw_collection (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('real','virtual')),
 person_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 added_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,kind,person_id)
);
CREATE TABLE IF NOT EXISTS draw_onboarding (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS draw_cooldowns (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('real','virtual')),
 person_id TEXT NOT NULL,
 until_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,kind,person_id)
);
CREATE TABLE IF NOT EXISTS user_media (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK(kind IN ('avatar','background')),
  mime       TEXT NOT NULL,
  bytes      BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, kind)
);
CREATE TABLE IF NOT EXISTS real_notes (
  id           TEXT PRIMARY KEY,
  sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')),
  created_at   INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX IF NOT EXISTS real_notes_recipient ON real_notes(recipient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS real_notes_sender ON real_notes(sender_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS real_notes_one_pending ON real_notes(sender_id,recipient_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS real_conversations (
  id         TEXT PRIMARY KEY,
  user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    TEXT NOT NULL UNIQUE REFERENCES real_notes(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_a,user_b)
);
CREATE TABLE IF NOT EXISTS real_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES real_conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS real_messages_recent ON real_messages(conversation_id,id DESC);
`;

export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec('BEGIN IMMEDIATE');
  try{
    // 测试阶段取消每日唯一约束；保留历史结果和未决定的抽卡。
    const drawSchema=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='draw_records'").get().sql;
    if(/UNIQUE\s*\(\s*user_id\s*,\s*day\s*\)/i.test(drawSchema)){
      db.exec(SCHEMA.match(/CREATE TABLE IF NOT EXISTS draw_records \([\s\S]*?\);/)[0].replace('IF NOT EXISTS draw_records','draw_records_unlimited'));
      db.exec(`INSERT INTO draw_records_unlimited SELECT * FROM draw_records;
        DROP TABLE draw_records;
        ALTER TABLE draw_records_unlimited RENAME TO draw_records;
        CREATE UNIQUE INDEX draw_one_pending ON draw_records(user_id) WHERE status='pending';`);
    }
    for(const {id} of db.prepare('SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM draw_onboarding)').all())seedLegacyCollection(db,id);
    db.exec('COMMIT');
  }
  catch(error){db.exec('ROLLBACK');db.close();throw error}
  return db;
}
