const CACHE_NAME = 'hgt-shell-v2';
const STATIC_ASSETS = [
  '/css/site.css',
  '/js/ui.js',
  '/js/pwa.js',
  '/js/room.js',
  '/js/feedback.js',
  '/favicon.svg',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();

    // 旧版 service worker 把首页 `/` cache-first 了。
    // 新版激活后主动刷新已打开页面，让浏览器立刻重新请求服务端 EJS。
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url && client.url.startsWith(self.location.origin)) {
        client.postMessage({ type: 'HGT_SW_UPDATED' });
      }
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isHtmlRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

function shouldAlwaysNetwork(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/rooms/') ||
    url.pathname.startsWith('/feedback/') ||
    url.pathname.startsWith('/admin/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/messages') ||
    url.pathname.startsWith('/my') ||
    url.pathname.startsWith('/soups/create')
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok && request.method === 'GET') {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面 HTML 一律 network-first，避免 EJS 模板更新后仍显示旧首页。
  if (isHtmlRequest(request)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  // 登录、房间、反馈、后台等动态页面/接口一律优先走网络。
  if (shouldAlwaysNetwork(url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  // 静态资源也使用 network-first：上线新 CSS/JS 后尽快生效；离线时再回退缓存。
  event.respondWith(networkFirst(request));
});
