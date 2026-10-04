/*
  行軍表の Service Worker。
  Chromeがアプリとしてインストールできるようにするためのもの。
  通信できるときは必ずネットから最新を取る(新しい版がすぐ反映される)。
  通信できないときだけ、前に開いたときの画面を出す。
  GitHubのAPIなど、よそのサイトへの通信には触れない。
*/
const CACHE = "roadmap-shell-v1";
const SHELL = ["./", "./index.html", "./engine.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;   // GitHubのAPIなどはそのまま通す
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
  );
});
