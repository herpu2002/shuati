// 刷题助手 Service Worker：预缓存全部应用资源，改版本号即可全量更新
// 仅在 http(s) 环境注册（Android 壳走 file:// 不受影响）
'use strict';
var CACHE = 'sqt-v6.3-202609301831';
var ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/questions-data.js',
  'js/progress-map.js',
  'js/quotes-data.js',
  'js/analysis-data.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// 缓存优先；未命中则回源并把成功响应写入缓存（含运行期补充）
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        // 离线且未缓存时，导航请求回退到首页
        if (e.request.mode === 'navigate') return caches.match('./');
      });
    })
  );
});
