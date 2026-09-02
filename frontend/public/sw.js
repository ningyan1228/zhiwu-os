// This is a business workspace, not an offline-first content site.  Caching
// index.html or hashed JS/CSS bundles can leave a user with an old HTML shell
// that points at assets removed by the next GitHub Pages deployment.
const CACHE_NAME = 'zhiwu-os-static-v2'
const APP_SHELL = ['./favicon.svg', './manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  // Only cache files served by this GitHub Pages site. CRM and mail API data are never cached.
  if (url.origin !== self.location.origin) return
  // HTML, JavaScript and CSS must always come from the current deployment.
  // Only images/fonts may use a cache fallback while offline.
  const mayCache = ['image', 'font'].includes(event.request.destination)
  event.respondWith(fetch(event.request)
    .then(response => {
      if (mayCache && response.ok) void caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
      return response
    })
    .catch(async () => mayCache ? (await caches.match(event.request)) || Response.error() : Response.error()))
})
