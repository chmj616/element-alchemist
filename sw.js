// 원소 연금술사 서비스 워커: 네트워크 우선(항상 최신 버전), 오프라인일 때만 캐시 사용
const CACHE = 'element-alchemist-v4';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // 새 버전이 설치되면(예전 캐시가 있었으면) 열려 있는 화면을 새로 열어 최신 버전으로 — 설치한 앱도 자동 업데이트
    if (old.length) for (const c of await self.clients.matchAll({ type: 'window' })) { try { await c.navigate(c.url); } catch (err) { /* 다음에 열 때 적용 */ } }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // 계정·저장은 캐시 금지
  e.respondWith(
    fetch(req)
      .then(async res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        } else if (res.status >= 500) {
          const good = await caches.match(req);
          if (good) return good; // 서버 오류 때는 마지막 정상 화면
        }
        return res;
      })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
  );
});
