// 서버 공통: DB · 비밀번호 해시 · 세션 · 요청 제한
const crypto = require('crypto');
const { promisify } = require('util');
const { neon } = require('@neondatabase/serverless');

const scrypt = promisify(crypto.scrypt);
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
let client;
const db = () => client || (client = neon(process.env.DATABASE_URL));

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const N = 32768, R = 8, P = 3, MEM = 64 * 1024 * 1024;
async function hashPassword(password, salt = crypto.randomBytes(16)) {
  const key = await scrypt(password.normalize('NFKC'), salt, 32, { N, r: R, p: P, maxmem: MEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}
// 없는 아이디도 같은 시간만큼 계산해서 아이디 존재 여부가 응답 시간으로 드러나지 않게
const DUMMY = ['scrypt', N, R, P, 'A'.repeat(22), 'A'.repeat(43)].join('$');
async function checkPassword(password, stored) {
  const [, n, r, p, salt, hash] = (stored || DUMMY).split('$');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), 32, { N: +n, r: +r, p: +p, maxmem: MEM });
  return crypto.timingSafeEqual(key, Buffer.from(hash, 'base64url')) && !!stored;
}

async function limit(key, max, seconds) {
  const k = sha(key);
  const [row] = await db()`
    INSERT INTO rate_limits AS l (key, hits, reset_at) VALUES (${k}, 1, now() + make_interval(secs => ${seconds}))
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN l.reset_at < now() THEN 1 ELSE l.hits + 1 END,
      reset_at = CASE WHEN l.reset_at < now() THEN EXCLUDED.reset_at ELSE l.reset_at END
    RETURNING hits, reset_at`;
  if (row.hits > max) {
    const min = Math.max(1, Math.ceil((new Date(row.reset_at) - Date.now()) / 60000));
    throw new HttpError(429, `시도가 너무 많아요. ${min}분 뒤에 다시 해주세요.`);
  }
}

// Vercel이 덮어써 주는 헤더만 믿음
const clientIp = req => String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

const secure = () => !!process.env.VERCEL;
const cookieName = () => (secure() ? '__Host-ea_session' : 'ea_session');
const DAYS = 60;
function readToken(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === cookieName()) return part.slice(i + 1).trim();
  }
  return null;
}
function writeCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', `${cookieName()}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`);
}
async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db()`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (${sha(token)}, ${userId}, now() + make_interval(days => ${DAYS}))`;
  writeCookie(res, token, DAYS * 86400);
}
async function endSession(req, res) {
  const token = readToken(req);
  if (token) await db()`DELETE FROM sessions WHERE token_hash = ${sha(token)}`;
  writeCookie(res, '', 0);
}
async function currentUser(req) {
  const token = readToken(req);
  if (!token) return null; // 게스트는 DB를 깨우지 않음
  const [user] = await db()`SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ${sha(token)} AND s.expires_at > now()`;
  return user || null;
}

module.exports = { db, sha, HttpError, hashPassword, checkPassword, limit, clientIp, startSession, endSession, currentUser };
