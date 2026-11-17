"use strict";

const CACHE_PREFIX = "super-over-smash:";
const CACHE_NAME = CACHE_PREFIX + "v1";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./game-logic.js", "./game.js", "./manifest.webmanifest"];
const SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  url.hash = "";
  const navigation = request.mode === "navigate";
  if (navigation) url.search = "";
  if (!SHELL_URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(url.href)) ?? fetch(request);
  })());
});
