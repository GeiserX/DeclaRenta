/**
 * DeclaRenta Service Worker — offline-first caching.
 *
 * Strategy:
 * - Static assets (HTML, CSS, JS): cache-first with network fallback
 * - ECB API calls: network-first with cache fallback (stale rates are better than no rates)
 */

/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_VERSION = "declarenta-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Use SW scope as base — works for both local dev (/) and GitHub Pages (/DeclaRenta/)
const BASE = self.registration.scope;
const STATIC_URLS = [
  BASE,
  `${BASE}index.html`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ECB API: network-first with cache fallback
  if (url.hostname.includes("ecb.europa.eu")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r ?? new Response("", { status: 503 })))
    );
    return;
  }

  // Static assets: cache-first
  if (event.request.method === "GET" && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(fetch(event.request));
});
