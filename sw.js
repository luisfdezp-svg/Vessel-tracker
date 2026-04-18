const CACHE = 'vt6-v2';
const SHELL = [
  './',
  './index.html',
  './vessel-tracker.html',
  './Groupage Optimizer.html',
  './manifest.json',
  './icon.svg',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js'
];

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isBypass(url) {
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return true;
  const h = url.hostname;
  return h.includes('aisstream')
    || h.includes('emailjs')
    || h.includes('basemaps.cartocdn')
    || h.includes('tile.openstreetmap')
    || h.includes('arcgisonline');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (isBypass(url)) return;

  e.respondWith(
    caches.match(e.request).then(hit => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
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
