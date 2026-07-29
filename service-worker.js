const CACHE = 'bridgeaid-v16';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=16',
  './js/app.js?v=16',
  './js/localization.js?v=16',
  './data/resources.js?v=16',
  './assets/bridgeaid-icon.svg',
  './assets/bridgeaid-logo.svg',
  './manifest.webmanifest',
  './js/services/storage.js',
  './js/services/resource-service.js?v=16',
  './js/services/location-service.js?v=16',
  './js/services/schedule-service.js',
  './js/services/eligibility-service.js',
  './js/services/registration-service.js',
  './js/services/orchestrator.js',
  './js/services/html-service.js',
  './js/services/helper-plan-service.js',
  './js/services/situation-service.js',
  './js/services/eligibility-data-service.js',
  './js/services/grounded-assistant.js?v=16',
  './js/services/local-eligibility-service.js?v=16',
  './js/services/location-eligibility-service.js',
  './js/services/resource-quality-service.js',
  './js/services/correction-service.js',
  './js/services/schedule-verification-service.js',
  './js/services/places-enrichment-service.js',
  './js/services/performance-service.js',
  './js/services/route-service.js',
  './js/services/search-lifecycle-service.js',
  './js/services/local-search-workflow.js?v=16',
  './js/services/nationwide-eligibility-service.js?v=16',
  './data/nationwide-eligibility-research.js'
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
