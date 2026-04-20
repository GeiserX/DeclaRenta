/**
 * DeclaRenta Service Worker — network-first caching.
 *
 * Strategy:
 * - Static assets (HTML, CSS, JS): network-first, cache fallback for offline
 * - ECB API calls: network-first with cache fallback (stale rates better than none)
 *
 * This ensures users always get the latest deploy while still working offline.
 */

const CACHE_NAME = "declarenta-cache";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) =>
          cached ?? new Response("Offline", { status: 503, statusText: "Service Unavailable" })
        )
      )
  );
});
