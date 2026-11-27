// /api/time · me · signup · login · logout · save · admin · release
const crypto = require('crypto');
const L = require('./_lib');

const ID_RE = /^[a-z0-9_]{3,16}$/;
const MAX_SAVE = 200000;

function credentials(body) {
  if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new L.HttpError(400, '아이디와 비밀번호를 입력해 주세요.');
  const username = body.username.trim().toLowerCase();
  if (!ID_RE.test(username)) throw new L.HttpError(400, '아이디는 영문·숫자·_ 3~16자예요.');
  if (body.password.length < 8 || body.password.length > 72) throw new L.HttpError(400, '비밀번호는 8~72자예요.');
  return { username, password: body.password };
}

async function cloudSave(userId) {
  const [row] = await L.db()`SELECT data, rev, updated_at FROM saves WHERE user_id = ${userId}`;
  return row ? { data: row.data, rev: row.rev, updatedAt: new Date(row.updated_at).getTime() } : null;
}

// 공개 단계: 관리자가 「일반 사이트에 배포」를 누르기 전까지 새 기능은 관리자 모드에서만 보임
// settings 테이블은 DB 소유자 계정으로 미리 만들어 두고 앱 계정(ea_app)에 SELECT·INSERT·UPDATE만 줘요
// (앱 계정은 public 스키마에 테이블을 만들 권한이 없어서, 요청 중에 CREATE TABLE을 하면 42501 오류가 나요)
async function getRelease() {
  try {
    const [row] = await L.db()`SELECT value FROM settings WHERE key = 'release'`;
    return row ? Number(row.value) || 0 : 0;
  } catch (e) {
    if (e.code === '42P01') return 0; // 아직 테이블이 없음
    throw e;
  }
}
function checkAdmin(body) {
  const want = process.env.ADMIN_PASSWORD;
  if (!want || typeof body.password !== 'string') throw new L.HttpError(400, '비밀번호를 입력해 주세요.');
  if (!crypto.timingSafeEqual(Buffer.from(L.sha(body.password)), Buffer.from(L.sha(want)))) throw new L.HttpError(401, '비밀번호가 틀렸어요.');
}

// 관리자 계정: 이 아이디로 로그인하면 플레이어 기록(진행 요약)을 볼 수 있어요
const ADMIN_USERS = new Set(['admin']);
const n0 = v => (typeof v === 'number' && isFinite(v) ? v : 0);
function playerSummary(d) {
  if (!d || typeof d !== 'object') return null;
  const b = d.battle || {}, p = d.prestige || {}, e = d.endings || {}, c = d.crunch || {}, a = d.alt && typeof d.alt === 'object' ? d.alt : null;
  const disc = Array.isArray(d.disc) ? d.disc.filter(Boolean).length : 0;
  const part = d.part === 2 ? 2 : 1;
  const side = x => x && { maxStage: n0(x.battle?.maxStage), rebirths: n0(x.prestige?.count), endings: x.endings || {} };
  return {
    part, maxStage: n0(b.maxStage), stage: n0(b.stage), rebirths: n0(p.count), seeds: n0(p.seeds), best: n0(p.best),
    endings: { e1: !!e.e1, e2: !!e.e2, e3: !!e.e3, e4: !!e.e4 }, disc, h: n0(Array.isArray(d.counts) ? d.counts[1] : 0), coins: n0(d.coins),
    playTime: n0(d.playTime), clicks: n0(d.totalClicks), kills: n0(d.kills), fusions: n0(d.totalFusions),
    voidDone: Math.max(0, Math.min(118, n0(d.void?.idx) - 1)), g2: d.g2?.unlocked ? n0(d.g2.k) + 1 : 0, rift: n0(d.rift),
    weapons: Array.isArray(d.weap) ? d.weap.filter(Boolean).length : 0, hs: d.hs ? Object.values(d.hs).reduce((s, v) => s + n0(v), 0) : 0,
    crunch: { clearAt: n0(c.clearAt), eventAt: n0(c.eventAt), gone: !!c.gone, fresh: !!c.fresh },
    other: a ? { part: a.part === 2 ? 2 : 1, ...side(a) } : null, lastSave: n0(d.lastSave),
    maxAt: typeof b.maxAt === 'number' ? b.maxAt : null, warn: saveWarnings(d),
  };
}
// 저장 이상 표시 (막지는 않고 관리자 기록에만): 숫자가 깨졌거나(NaN→null), 층 상한을 넘었거나, 상한 근처
const STAGE_CAPS = [300, 600, 1000, 1500, 2200, 3000, 4000, 5000];
function saveWarnings(d) {
  const w = [], c = Array.isArray(d.counts) ? d.counts : [];
  if (c[1] === null || d.coins === null || c.some(v => v === null)) w.push('숫자 깨짐(오버플로 피해 의심)');
  const cap = STAGE_CAPS[Math.min(7, n0(d.prestige?.count))], ms = n0(d.battle?.maxStage);
  if (ms > cap) w.push(`층 상한 초과(${ms} > ${cap})`);
  if (n0(c[1]) >= 1e299 || n0(d.coins) >= 1e299) w.push('수치 상한 근처');
  return w;
}

const routes = {
  'GET players': async req => {
    const user = await L.currentUser(req);
    if (!user || !ADMIN_USERS.has(user.username)) throw new L.HttpError(403, '관리자 계정만 볼 수 있어요.');
    await L.limit('players:' + user.id, 30, 600);
    const rows = await L.db()`SELECT u.username, u.created_at, s.data, s.rev, s.updated_at,
      (SELECT max(created_at) FROM sessions WHERE user_id = u.id) AS last_login
      FROM users u LEFT JOIN saves s ON s.user_id = u.id ORDER BY s.updated_at DESC NULLS LAST, u.created_at DESC LIMIT 500`;
    return {
      players: rows.map(r => {
        let sum = null;
        try { sum = r.data ? playerSummary(JSON.parse(r.data)) : null; } catch (e) { sum = null; }
        const t = v => (v ? new Date(v).getTime() : 0);
        return { user: r.username, created: t(r.created_at), saved: t(r.updated_at), lastLogin: t(r.last_login), rev: r.rev || 0, size: r.data ? r.data.length : 0, s: sum };
      }),
    };
  },

  'GET time': async () => ({}),

  'GET release': async () => ({ release: await getRelease() }),

  'POST release': async (req, res, body) => {
    await L.limit('release:' + L.clientIp(req), 10, 900);
    checkAdmin(body);
    const v = body.release;
    if (!Number.isInteger(v) || v < 0 || v > 1000) throw new L.HttpError(400, '공개 단계가 잘못됐어요.');
    try {
      await L.db()`INSERT INTO settings (key, value) VALUES ('release', ${String(v)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    } catch (e) {
      if (e.code === '42P01' || e.code === '42501') throw new L.HttpError(503, '공개 단계를 저장할 settings 테이블이 없거나 권한이 없어요. DB에 settings 테이블을 만들어 주세요.');
      throw e;
    }
    return { release: v };
  },

  'GET me': async req => {
    const user = await L.currentUser(req);
    return user ? { user: user.username, save: await cloudSave(user.id) } : { user: null };
  },

  'POST signup': async (req, res, body) => {
    const { username, password } = credentials(body);
    if (body.password2 !== password) throw new L.HttpError(400, '비밀번호 확인이 달라요.');
    if (password.toLowerCase() === username) throw new L.HttpError(400, '비밀번호를 아이디와 다르게 정해 주세요.');
    await L.limit('signup:' + L.clientIp(req), 10, 3600);
    const hash = await L.hashPassword(password);
    const [user] = await L.db()`INSERT INTO users (username, pass_hash) VALUES (${username}, ${hash}) ON CONFLICT (username) DO NOTHING RETURNING id`;
    if (!user) throw new L.HttpError(409, '이미 사용 중인 아이디예요.');
    await L.startSession(res, user.id);
    return { user: username, save: null };
  },

  'POST login': async (req, res, body) => {
    const { username, password } = credentials(body), ip = L.clientIp(req);
    await L.limit('login-ip:' + ip, 50, 900);
    await L.limit(`login:${ip}:${username}`, 10, 900);
    await L.limit('login-id:' + username, 100, 900);
    const [user] = await L.db()`SELECT id, pass_hash FROM users WHERE username = ${username}`;
    if (!(await L.checkPassword(password, user?.pass_hash))) throw new L.HttpError(401, '아이디 또는 비밀번호가 맞지 않아요.');
    await L.endSession(req, res);
    await L.startSession(res, user.id);
    await L.db()`DELETE FROM sessions WHERE expires_at < now()`;
    await L.db()`DELETE FROM rate_limits WHERE reset_at < now()`;
    return { user: username, save: await cloudSave(user.id) };
  },

  'POST logout': async (req, res) => {
    await L.endSession(req, res);
    return { user: null };
  },

  'POST save': async (req, res, body) => {
    const user = await L.currentUser(req);
    if (!user) throw new L.HttpError(401, '로그인이 만료됐어요.');
    // 다른 탭에서 계정이 바뀌었을 때 남의 계정에 저장되지 않게
    if (body.user !== user.username) throw new L.HttpError(403, '로그인한 계정이 바뀌었어요.');
    const { data, rev } = body;
    if (typeof data !== 'string' || !Number.isInteger(rev) || rev < 0 || rev > 2147483646) throw new L.HttpError(400, '저장 형식이 잘못됐어요.');
    if (Buffer.byteLength(data) > MAX_SAVE) throw new L.HttpError(413, '저장 데이터가 너무 커요.');
    let parsed = null;
    try { parsed = JSON.parse(data); } catch (e) { /* 아래에서 거부 */ }
    if (!Array.isArray(parsed?.counts) || parsed.counts.length !== 119 || data.includes('\u0000')) throw new L.HttpError(400, '저장 형식이 잘못됐어요.');
    await L.limit('save:' + user.id, 120, 600);
    const [row] = rev === 0
      ? await L.db()`INSERT INTO saves (user_id, data) VALUES (${user.id}, ${data}) ON CONFLICT (user_id) DO NOTHING RETURNING rev, updated_at`
      : await L.db()`UPDATE saves SET data = ${data}, rev = rev + 1, updated_at = now() WHERE user_id = ${user.id} AND rev = ${rev} RETURNING rev, updated_at`;
    if (!row) throw new L.HttpError(409, '다른 기기의 저장이 있어요.', { save: await cloudSave(user.id) });
    return { rev: row.rev, updatedAt: new Date(row.updated_at).getTime() };
  },

  'POST admin': async (req, res, body) => {
    await L.limit('admin:' + L.clientIp(req), 5, 900);
    checkAdmin(body);
    return { ok: true, release: await getRelease() };
  },
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const action = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '').split('/').pop();
    const key = `${req.method} ${action}`, route = Object.hasOwn(routes, key) ? routes[key] : null;
    if (!route) throw new L.HttpError(404, '없는 주소예요.');
    let body = {};
    if (req.method === 'POST') {
      // 다른 사이트에서 보낸 요청 거부 (SameSite 쿠키와 이중 방어)
      let origin = '';
      try { origin = new URL(req.headers.origin).host; } catch (e) { /* 아래에서 거부 */ }
      if (!origin || origin !== req.headers.host) throw new L.HttpError(403, '허용되지 않은 요청이에요.');
      if (!String(req.headers['content-type']).startsWith('application/json')) throw new L.HttpError(415, 'JSON 요청만 받아요.');
      try { body = req.body; } catch (e) { throw new L.HttpError(400, '요청 형식이 잘못됐어요.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new L.HttpError(400, '요청 형식이 잘못됐어요.');
    }
    const out = await route(req, res, body);
    res.status(200).json({ ...out, now: Date.now() });
  } catch (e) {
    if (e instanceof L.HttpError) return res.status(e.status).json({ error: e.message, ...e.extra, now: Date.now() });
    console.error('api error', e.code || '', e.message); // 요청 내용·비밀번호는 기록하지 않음
    res.status(500).json({ error: '서버 오류예요. 잠시 후 다시 해주세요.' });
  }
};
