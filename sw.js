/* 오프라인에서도 열리게 앱 파일을 저장해 둔다. 인터넷이 되면 항상 새 파일을 먼저 받는다. */
var CACHE = "word-practice-v16";
var FILES = ["./", "index.html", "css/app.css", "fonts/jua.woff2", "fonts/nunito-800.woff2", "js/util.js", "js/word.js", "js/chunk.js", "js/store.js", "js/fun.js", "js/kbd.js", "js/sync.js", "js/quiz.js", "js/solve.js", "js/study.js", "js/app.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", function (e) {
  // GitHub Pages 는 파일에 max-age=600 을 붙이므로, 브라우저 임시 저장분 대신 서버에 새 것이 있는지 확인해서 받는다.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
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
  // cache: "no-cache" 는 매번 서버에 바뀐 것이 있는지 물어본다(바뀐 것이 없으면 304 로 가볍게 끝남). 새로 올린 앱이 10분 늦게 반영되는 일을 막는다.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(function (r) {
    var copy = r.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return r;
  }).catch(function () { return caches.match(e.request); }));
});
