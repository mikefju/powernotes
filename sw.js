/* PowerNotes service worker: precache the app shell so it opens offline,
   refresh the shell in the background, and hand the page a "new version" signal. */
const VERSION = 'pn-v9';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/state.js',
  './js/idb.js',
  './js/model.js',
  './js/panes.js',
  './js/pane.js',
  './js/media.js',
  './js/shared.js',
  './js/palette.js',
  './js/disk.js',
  './js/vault.js',
  './js/files.js',
  './js/sidebar.js',
  './js/search.js',
  './js/tags.js',
  './js/daily.js',
  './js/attachments.js',
  './js/workspaces.js',
  './js/menus.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.disable(); } catch (err) {} }
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* Same-origin GETs only. The page and its scripts and styles are fetched network-first, so a deploy shows on the
   next load and the files always match each other, with the cached copy as the offline fallback; other assets
   are served from cache and refreshed in the background. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') {
      // Query strings (shortcuts, file launches) all resolve to the same shell.
      try {
        const res = await withTimeout(fetch(req), 3000);
        if (res && res.ok) { cache.put('./index.html', res.clone()); return res; }
      } catch (err) {}
      return (await cache.match('./index.html')) || Response.error();
    }
    if (/\.(js|css)$/.test(url.pathname)) {
      try {
        const res = await withTimeout(fetch(req), 3000);
        if (res && res.ok) { cache.put(req, res.clone()); return res; }
      } catch (err) {}
      const hit = await cache.match(req); if (hit) return hit;
    }
    const cached = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    return (await network) || Response.error();
  })());
});

function withTimeout(p, ms) {
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
}
