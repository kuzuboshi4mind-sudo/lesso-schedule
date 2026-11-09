// アプリの画面のファイルを端末に残しておく係(サービスワーカー。2026-11-09)
// 圏外でもホーム画面から開けるようにする。予定のデータは別(js/backend-cached.js が端末に写しを残す)。
// ・いつもは、まずネットから最新の版を取りにいく(更新したらすぐ新しい版が出るように)
// ・取れなかったとき(圏外・電波が弱くて8秒で返事がない)だけ、端末に残した版を使う
// 残すのは、このアプリのファイルと、jsDelivr の部品(Supabase など)だけ。予定のやりとり(Supabase)は残さない。

const CACHE = 'lesso-app-v1';
const NETWORK_TIMEOUT_MS = 8000;

// 最初に残しておくファイル(js を増やしたらここにも足す。足し忘れても、一度開けば自動で残る)
const CORE = [
  './', 'index.html', 'config.js', 'manifest.webmanifest', 'css/style.css',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'js/main.js', 'js/store.js', 'js/cloud.js', 'js/login.js',
  'js/backend-cached.js', 'js/backend-cloud.js', 'js/backend-local.js', 'js/backend-memory.js', 'js/device-copy.js',
  'js/calendar.js', 'js/day-memos.js', 'js/editor.js', 'js/export-xlsx.js', 'js/holidays.js', 'js/inline-edit.js',
  'js/line-share.js', 'js/memo-link.js', 'js/recurring.js', 'js/selection.js', 'js/settings.js', 'js/students.js',
  'js/summary.js', 'js/trash-backup.js', 'js/zoom.js', 'js/missing-students.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1つ取れなくても、ほかは残す
    await Promise.all(CORE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// 残す対象か(このアプリのファイルと jsDelivr の部品)
function cacheable(url) {
  return url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net';
}

// 開いた画面が読み込んだファイルを、まとめて残す(最初に開いたときは、まだこの係が動いていないため)
self.addEventListener('message', event => {
  if (event.data?.type !== 'cache-urls') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const href of event.data.urls || []) {
      let url;
      try { url = new URL(href, self.location.href); } catch { continue; }
      if (!cacheable(url) || url.pathname.endsWith('/sw.js')) continue;
      if (await cache.match(url.href)) continue;
      await cache.add(url.href).catch(() => {});
    }
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;   // Supabase とのやりとりなどは、そのままネットへ
  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then(res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      event.waitUntil(cache.put(req, copy).catch(() => {}));
    }
    return res;
  });
  network.catch(() => {});   // 残した版を返したあとに失敗しても、エラーを出さない
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? (await cache.match('./')) || (await cache.match('index.html')) : null);
    if (hit) return hit;
    return network;   // 残した版もなければ、ネットの結果を待つ(失敗ならそのままエラー)
  }
}
