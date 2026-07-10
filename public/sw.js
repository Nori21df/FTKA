// Service worker FTKA (PWA) — chiến lược AN TOÀN tối thiểu:
//  - /static/* : cache-first (asset có thể cache lâu; đổi CACHE_VERSION khi cần xả).
//  - còn lại   : network-only (HTML server-render + API không được cache để tránh stale).
// Được serve từ /sw.js (route riêng) để scope phủ toàn origin.
// KHÔNG precache style.css/JS: template link chúng kèm ?v=<mtime> (asset_v) — mỗi lần đổi file
// là URL mới → cache-first tự miss → luôn tươi. Precache bản KHÔNG query từng làm CSS đóng băng
// vĩnh viễn (bug đã gặp). Chỉ precache asset thật sự bất biến (icon, manifest).
const CACHE_VERSION = "ftka-static-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(["/static/manifest.webmanifest", "/static/icons/icon-192.png", "/static/icons/icon-512.png"])
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/static/")) return; // network-only cho phần còn lại
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
