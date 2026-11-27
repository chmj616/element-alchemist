// 원소 연금술사 자동 점검 — 배포 전에 `npm test` (Windows 엣지/크롬 헤드리스로 index.html을 열어 확인)
// 사용: node tests/run.mjs [steps.json]   (기본: tests/smoke.json)
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browsers = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = process.env.BROWSER || browsers.find(p => existsSync(p));
if (!exe) { console.error('브라우저(엣지/크롬)를 찾지 못했어요. BROWSER 환경 변수로 경로를 알려 주세요.'); process.exit(2); }

const stepsFile = resolve(process.argv[2] || join(here, 'smoke.json'));
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const prof = mkdtempSync(join(tmpdir(), 'ea-test-'));
const port = 9400 + Math.floor(Math.random() * 400);
const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--window-size=1400,900', 'about:blank']);
const wait = ms => new Promise(r => setTimeout(r, ms));
await wait(2500);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pend = {}, errs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console: ' + d.params.args.map(a => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'exception');
  return r.result.result.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: pathToFileURL(resolve(here, '..', 'index.html')).href });
await wait(3000);

let fail = 0, pass = 0;
for (const s of steps) {
  if (s.wait) { await wait(s.wait); continue; }
  if (s.vp) { await send('Emulation.setDeviceMetricsOverride', { width: s.vp[0], height: s.vp[1], deviceScaleFactor: 1, mobile: !!s.vp[2] }); continue; }
  try {
    const v = await ev((s.file ? readFileSync(resolve(here, s.file), 'utf8') + ';\n' : '') + s.js);
    const ok = s.expect === undefined || JSON.stringify(v) === JSON.stringify(s.expect);
    if (ok) { pass++; console.log('✅', s.name || s.js.slice(0, 60)); }
    else { fail++; console.log('❌', s.name || s.js.slice(0, 60), '→', JSON.stringify(v), '(기대:', JSON.stringify(s.expect) + ')'); }
  } catch (e) { fail++; console.log('❌', s.name || s.js.slice(0, 60), '→', e.message.split('\n')[0]); }
}
if (errs.length) { fail++; console.log('❌ 페이지 오류:', errs.join(' | ')); }
console.log(`\n${pass}개 통과 · ${fail}개 실패`);
ws.close(); br.kill();
try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* 브라우저가 아직 잡고 있을 수 있음 */ }
process.exit(fail ? 1 : 0);
