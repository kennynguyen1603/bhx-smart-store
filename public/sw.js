const CACHE = "bhx-smart-store-v1";
const APP_SHELL = ["/", "/login", "/staff", "/kiosk", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/staff/tasks")) {
    event.respondWith(fetch(request).then((response) => { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, clone)); return response; }).catch(() => caches.match(request)));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, clone)); return response; }).catch(async () => (await caches.match(request)) || caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response.ok && ["script", "style", "image", "font"].includes(request.destination)) { const clone = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, clone)); } return response; })));
});

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : { title: "BHX Smart Store", body: "Bạn có nhiệm vụ mới" };
  event.waitUntil(self.registration.showNotification(payload.title, { body: payload.body, icon: "/icon.svg", badge: "/icon.svg", tag: payload.tag || "bhx-task", data: { url: payload.url || "/staff" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => { const url = event.notification.data?.url || "/staff"; const existing = windows.find((client) => new URL(client.url).pathname === new URL(url, self.location.origin).pathname); return existing ? existing.focus() : clients.openWindow(url); }));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bhx-smart-store", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queuedMutations() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("mutations", "readonly");
    const request = transaction.objectStore("mutations").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

async function removeMutation(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("mutations", "readwrite");
    const request = transaction.objectStore("mutations").delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener("sync", (event) => {
  if (event.tag !== "bhx-sync") return;
  event.waitUntil((async () => {
    const mutations = await queuedMutations();
    for (const item of mutations) {
      const response = await fetch(item.url, { method: item.method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(item.body) });
      if (response.ok || (response.status >= 400 && response.status < 500)) await removeMutation(item.id);
      else throw new Error("Retry later");
    }
  })());
});
