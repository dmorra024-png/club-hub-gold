/* global self, caches */
// Only public installation resources. No member data, photos, application HTML,
// auth tokens, APIs or server-function results enter the cache.
const CACHE = "clubhub-public-v4";
const PUBLIC = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/snoop-commercial.svg",
  "/icons/app-192.png",
  "/icons/app-512.png",
  "/icons/app-maskable-512.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PUBLIC.map(async (path) => {
          const response = await fetch(path, { credentials: "omit", cache: "reload" });
          const target = new URL(response.url);
          if (
            !response.ok ||
            target.origin !== self.location.origin ||
            (target.pathname !== path &&
              !(path === "/offline.html" && target.pathname === "/offline"))
          )
            throw new Error("Invalid public installation resource");
          // Workers Static Assets can canonicalize offline.html to /offline. A cached
          // redirected Response cannot satisfy an offline navigation's manual mode.
          await cache.put(
            path,
            new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
          );
        }),
      ),
    ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("clubhub-public-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("authorization")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  } else if (!url.search && PUBLIC.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

// Apply an update only after the user has finished the current form.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
