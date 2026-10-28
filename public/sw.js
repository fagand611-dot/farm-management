// Service worker: lets the app open with no signal.
// The app's own files are fetched fresh when online (so updates arrive straight away)
// and served from the cache when offline. Firestore handles the data's offline copy itself.
const CACHE = "farm-shell-v1";
const FIREBASE_VERSION = "12.17.0";
const SHELL = [
  "./", "./index.html", "./app.js", "./firebase.js", "./config.js", "./style.css", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png",
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`,
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`,
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function networkFirst(req) {
  return fetch(req).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())));
}

function cacheFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never touch Firebase's own sign-in pages or any API traffic.
  if (url.pathname.startsWith("/__/")) return;
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) { e.respondWith(cacheFirst(req)); return; }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(cacheFirst(req)); return; }
});
