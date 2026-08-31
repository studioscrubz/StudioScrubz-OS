const CACHE_NAME = "studioscrubz-static-v1";
const STATIC_ASSETS = [
  "/offline.html",
  "/branding/studioscrubz-logo.png",
  "/branding/icon-192.png",
  "/branding/icon-512.png",
  "/branding/icon-maskable-512.png",
  "/branding/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("studioscrubz-static-") && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try { payload = event.data.json(); }
    catch { payload = { body: event.data.text() }; }
  }
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "StudioScrubz OS";
  const body = typeof payload.body === "string" ? payload.body : "";
  const url = typeof payload.url === "string" && payload.url.trim() ? payload.url : "/attention";
  const tag = typeof payload.tag === "string" && payload.tag.trim() ? payload.tag : undefined;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    icon: "/branding/icon-192.png",
    badge: "/branding/icon-192.png",
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url : "/attention";
  let targetUrl;
  try { targetUrl = new URL(requestedUrl, self.location.origin); }
  catch { targetUrl = new URL("/attention", self.location.origin); }
  if (targetUrl.origin !== self.location.origin) targetUrl = new URL("/attention", self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const exact = windows.find((client) => client.url === targetUrl.href);
    const available = exact || windows[0];
    if (available) return available.focus().then(() => available.navigate(targetUrl.href));
    return self.clients.openWindow(targetUrl.href);
  }));
});
