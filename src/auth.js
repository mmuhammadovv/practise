// Пароли, сессии и cookie. Всё на Web Crypto, которое есть в Cloudflare Workers.

const PBKDF2_ITERATIONS = 100000; // максимум, который разрешает Workers
const SESSION_DAYS = 30;
const MAX_LOGIN_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Сравнение за одинаковое время, чтобы по скорости ответа нельзя было угадать хеш
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return { hash: toHex(bits), salt: saltHex };
}

export async function verifyPassword(password, hash, salt) {
  const res = await hashPassword(password, salt);
  return safeEqual(res.hash, hash);
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function createSession(db, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, expires)
    .run();
  return token;
}

export async function getSessionUser(db, request) {
  const token = readCookie(request, "sid");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.username, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .bind(await sha256Hex(token))
    .first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username };
}

export async function deleteSession(db, request) {
  const token = readCookie(request, "sid");
  if (token) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearCookie() {
  return "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

// --- Ограничение попыток входа ---

export async function isLoginBlocked(db, key) {
  const row = await db.prepare("SELECT count, reset_at FROM login_attempts WHERE key = ?").bind(key).first();
  return !!row && row.reset_at > Date.now() && row.count >= MAX_LOGIN_FAILS;
}

export async function recordLoginFail(db, key) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO login_attempts (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count    = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END`
    )
    .bind(key, now + LOGIN_WINDOW_MS, now)
    .run();
}

export async function clearLoginFails(db, key) {
  await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
}
