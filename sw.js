/* Mambemba Business — Service Worker
   Guarda o "esqueleto" da app para abrir rápido e funcionar o ecrã inicial offline.
   Os dados (Firestore/Auth) NÃO são guardados aqui: vão sempre à rede. */
var CACHE = "mb-shell-v1";
var SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./qrcode.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // SDK do Firebase (URL com versão fixa): cache primeiro.
  if (url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  // Tudo o resto fora do teu site (Firestore, Auth, etc.): direto à rede.
  if (url.origin !== self.location.origin) return;

  // Ficheiros do teu site: rede primeiro (apanha atualizações), cache se estiver offline.
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match("./index.html");
      });
    })
  );
});
