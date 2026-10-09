/* #936: PWA service worker — installability plus resilient static assets.
 *
 * Scope is /static/ (this file is served from there), so it only ever sees
 * asset requests: navigations, API calls, and auth flows pass straight
 * through untouched. Network-first: normal loads behave exactly as today
 * (ETag revalidation still applies), and a cached copy covers flaky or
 * offline moments. Only successful GETs are cached; nothing else. */
const CACHE = "zimer-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/static/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});
