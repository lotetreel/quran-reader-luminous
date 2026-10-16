/* Offline support.
   The app shell (page, script, styles) is network-first so a deploy shows
   up on the next load; when offline it falls back to the last copy.
   Fonts and surah data are cache-first and refreshed in the background.
   On install every surah and font is fetched once, so the whole Qur'an is
   readable offline after the first visit. Bump VERSION to drop old caches. */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const SHELL_FILES = ["./", "index.html", "app.js", "styles.css", "fonts/fonts.css", "manifest.webmanifest", "data/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" })));
    // everything else is best-effort: a failed file is fetched again when it is read
    const data = await caches.open(DATA);
    const extra = [];
    try {
      const manifest = await (await shell.match("data/manifest.json")).json();
      for (const c of manifest.chapters) extra.push(c.file);
      const css = await (await shell.match("fonts/fonts.css")).text();
      for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) extra.push("fonts/" + m[1].replace(/^\.\//, ""));
    } catch { /* fall through with what we have */ }
    await Promise.allSettled(extra.map((u) => data.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL && key !== DATA) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, SHELL, "index.html"));
    return;
  }
  const path = url.pathname;
  if (path.startsWith("/data/surahs/") || path.startsWith("/fonts/") || path.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req, DATA));
    return;
  }
  event.respondWith(networkFirst(req, SHELL));
});

// On flaky Wi-Fi a request can hang rather than fail, so after a few
// seconds a cached copy wins; the network reply still refreshes the cache.
const NETWORK_WAIT_MS = 3500;

async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  const key = stripSearch(req);
  const network = fetch(req, { cache: "no-cache" }).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  const cached = async () => (await cache.match(key)) || (fallback && (await cache.match(fallback)));
  try {
    const res = await Promise.race([
      network,
      new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS)),
    ]);
    if (res) return res;
    const hit = await cached();
    if (hit) { network.catch(() => {}); return hit; }
    return await network;
  } catch {
    const hit = await cached();
    if (hit) return hit;
    throw new Error("offline");
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const key = stripSearch(req);
  const hit = await cache.match(key);
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  if (hit) {
    refresh.catch(() => {});
    return hit;
  }
  return refresh;
}

function stripSearch(req) {
  const url = new URL(req.url);
  url.search = "";
  url.hash = "";
  return url.href;
}
