// SQLite storage (Node's built-in node:sqlite). File: data/app.db
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'app.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, pass_hash TEXT, salt TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, lat REAL, lon REAL, address TEXT,
  observed_at TEXT, description TEXT, created_at TEXT, is_demo INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, created_at TEXT, phone TEXT, type TEXT, lat REAL, lon REAL,
  address TEXT, report_count INTEGER, message TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS geocode_cache (key TEXT PRIMARY KEY, address TEXT);
`);

// Reports removed by users (e.g. problem resolved) are kept for history but hidden from everyone.
for (const col of ['resolved_at TEXT', 'resolved_by INTEGER']) {
  try { db.exec(`ALTER TABLE reports ADD COLUMN ${col}`); } catch { /* column already exists */ }
}

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Seed demo users from data/demo-users.json (passwords stored hashed).
function seedUsers() {
  const users = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'demo-users.json'), 'utf8'));
  const upsert = db.prepare(`INSERT INTO users(username, pass_hash, salt) VALUES (?,?,?)
    ON CONFLICT(username) DO UPDATE SET pass_hash=excluded.pass_hash, salt=excluded.salt`);
  for (const u of users) {
    const salt = crypto.randomBytes(16).toString('hex');
    upsert.run(u.username, hash(u.password, salt), salt);
  }
  return users.length;
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!u) return null;
  const a = Buffer.from(hash(String(password || ''), u.salt), 'hex');
  if (!crypto.timingSafeEqual(a, Buffer.from(u.pass_hash, 'hex'))) return null;
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, u.id, new Date().toISOString());
  return { token, user: { id: u.id, username: u.username } };
}

function userForToken(token) {
  if (!token) return null;
  return db.prepare(`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token) || null;
}

function logout(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

module.exports = { db, seedUsers, login, logout, userForToken };
