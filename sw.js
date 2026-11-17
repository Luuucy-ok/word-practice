/* 오프라인에서도 열리게 앱 파일을 저장해 둔다. 인터넷이 되면 항상 새 파일을 먼저 받는다. */
var CACHE = "word-practice-v2";
var FILES = ["./", "index.html", "css/app.css", "js/util.js", "js/word.js", "js/chunk.js", "js/store.js", "js/sync.js", "js/app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // 다른 사이트(부모님 데이터를 받는 api.github.com 등)는 가로채거나 저장하지 않는다. 비공개 교재 데이터와 열쇠가 캐시에 남지 않게 한다.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request); }));
});
