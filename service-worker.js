const CACHE = 'bridgeaid-v12';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=12',
  './js/app.js?v=12',
  './js/localization.js?v=12',
  './data/resources.js?v=12',
  './manifest.webmanifest',
  './js/services/storage.js',
  './js/services/resource-service.js?v=12',
  './js/services/location-service.js?v=12',
  './js/services/schedule-service.js',
  './js/services/eligibility-service.js',
  './js/services/registration-service.js',
  './js/services/orchestrator.js',
  './js/services/html-service.js',
  './js/services/helper-plan-service.js',
  './js/services/decision-plan-service.js',
  './js/services/situation-service.js',
  './js/services/eligibility-data-service.js',
  './js/services/grounded-assistant.js?v=12',
  './js/services/local-eligibility-service.js?v=12',
  './js/services/correction-service.js',
  './js/services/schedule-verification-service.js',
  './js/services/places-enrichment-service.js',
  './js/services/performance-service.js'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline asset unavailable');
      })
  );
});
