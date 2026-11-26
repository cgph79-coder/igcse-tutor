/*
 * Service worker: makes the tutor installable and lets it open without a connection.
 * - Pages: network first (so a new deploy shows up straight away), saved copy if offline.
 * - Built files in assets/ have hashed names, so a saved copy is always correct: cache first.
 * - version.json is never cached (the update check needs the live one).
 * - Calls to the tutor Worker are on another origin and are never touched or cached.
 */
const CACHE = "igcse-tutor-v1";
const SCOPE = new URL(self.registration.scope).pathname; // e.g. /igcse-tutor/
const MAX_ASSETS = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith(`${SCOPE}assets/`));
  // Oldest first: drop files from old deploys once there are too many.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const key = request.url.split("?")[0];
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) ?? (await cache.match(SCOPE)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    trimAssets(cache);
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit ?? Response.error());
  return hit ?? fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.endsWith("/version.json")) return; // always live

  if (request.mode === "navigate") event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith(`${SCOPE}assets/`)) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(request));
});

// Tapping a timer notification brings the app back to the front.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).pathname.startsWith(SCOPE));
      return open ? open.focus() : self.clients.openWindow(SCOPE);
    }),
  );
});
