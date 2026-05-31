const SHELL = [
  './',
  './index.html',
  './vessel-tracker.html',
  './Groupage Optimizer.html',
  './assets/css/vessel-tracker.css',
  './assets/js/vessel-tracker.js',
  './assets/css/groupage-optimizer.css',
  './assets/js/groupage-optimizer.js',
  './manifest.json',
  './manifest-groupage.json',
  './icon.svg',
  './icon-groupage.svg'
];
const shellFingerprint = (() => {
  const payload = SHELL.join('|');
  let hashA = 0;
  let hashB = 5381;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    hashA = ((hashA * 31) + ch) >>> 0;
    hashB = (((hashB << 5) + hashB) + ch) >>> 0;
  }
  return `${hashA.toString(36)}-${hashB.toString(36)}-${payload.length.toString(36)}`;
})();
const CACHE = `vt6-${shellFingerprint}`;
const RUNTIME = 'vt6-runtime-v1';
const RUNTIME_CDN = 'vt6-cdn-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(SHELL.map(u => c.add(u).catch(() => null)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![CACHE,RUNTIME,RUNTIME_CDN].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isBypass(url) {
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return true;
  const h = url.hostname;
  return h === 'stream.aisstream.io'
    || h === 'api.emailjs.com'
    || h === 'basemaps.cartocdn.com'
    || h === 'tile.openstreetmap.org'
    || h === 'server.arcgisonline.com';
}

function isCdnAsset(url) {
  const h = url.hostname;
  return h === 'cdnjs.cloudflare.com' || h === 'cdn.jsdelivr.net';
}

async function pruneCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const extras = keys.length - maxEntries;
  for (let i = 0; i < extras; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (isBypass(url)) return;

  if (isCdnAsset(url)) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CDN).then(c => c.put(e.request, copy)).then(() => pruneCache(RUNTIME_CDN, 80));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(e.request, copy)).then(() => pruneCache(RUNTIME, 120));
        }
        return res;
      }).catch(() => hit || caches.match('./vessel-tracker.html') || caches.match('./index.html'));
      return hit || fetchPromise;
    })
  );
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'notify' && self.registration && self.registration.showNotification) {
    self.registration.showNotification(d.title || 'Vessel Tracker', {
      body: d.body || '',
      tag: d.tag || 'vt',
      icon: './icon.svg',
      badge: './icon.svg',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { ts: Date.now() }
    });
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
