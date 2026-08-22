const CACHE_NAME = 'zhiwu-os-shell-v1'
const APP_SHELL = ['./', './index.html', './favicon.svg', './manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  // Only cache files served by this GitHub Pages site. CRM and mail API data are never cached.
  if (url.origin !== self.location.origin) return
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const cacheable = response.ok && ['document', 'script', 'style', 'image', 'font'].includes(event.request.destination)
        if (cacheable) void caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
        return response
      })
      .catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  )
})
