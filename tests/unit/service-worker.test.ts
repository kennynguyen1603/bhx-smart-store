import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginRoleChoice } from "@/components/login-role-choice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureServiceWorkerRegistration, isLocalServiceWorkerHost } from "@/lib/service-worker";

function registration(script = "https://store.example/sw.js") {
  return { active: { scriptURL: script }, installing: null, waiting: null } as unknown as ServiceWorkerRegistration;
}

function container(existing?: ServiceWorkerRegistration) {
  return {
    getRegistration: vi.fn().mockResolvedValue(existing),
    register: vi.fn().mockResolvedValue(registration()),
    get ready() { throw new Error("Must not wait for ready"); },
  };
}

describe("service-worker registration", () => {
  beforeEach(() => vi.stubGlobal("isSecureContext", true));
  afterEach(() => vi.unstubAllGlobals());

  it("returns unsupported without a browser", async () => {
    vi.stubGlobal("navigator", undefined);
    await expect(ensureServiceWorkerRegistration()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("returns unsupported when the browser lacks service workers", async () => {
    vi.stubGlobal("navigator", {});
    await expect(ensureServiceWorkerRegistration()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("returns a structured failure when the serviceWorker getter throws SecurityError", async () => {
    vi.stubGlobal("navigator", {
      get serviceWorker() {
        throw new DOMException("Service workers are blocked in this sandbox", "SecurityError");
      },
    });
    await expect(ensureServiceWorkerRegistration()).resolves.toEqual({ ok: false, reason: "registration-failed" });
  });

  it("rejects insecure contexts before contacting the container", async () => {
    vi.stubGlobal("isSecureContext", false);
    const sw = container();
    await expect(ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer)).resolves.toEqual({ ok: false, reason: "insecure-context" });
    expect(sw.getRegistration).not.toHaveBeenCalled();
    expect(sw.register).not.toHaveBeenCalled();
  });

  it.each(["active", "waiting", "installing"] as const)("reuses an existing /sw.js registration with a %s worker", async (state) => {
    const existing = { active: null, waiting: null, installing: null, [state]: { scriptURL: "https://store.example/sw.js" } } as unknown as ServiceWorkerRegistration;
    const sw = container(existing);
    await expect(ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer)).resolves.toEqual({ ok: true, registration: existing });
    expect(sw.register).not.toHaveBeenCalled();
  });

  it("registers /sw.js once when absent using the browser container", async () => {
    const sw = container();
    vi.stubGlobal("navigator", { serviceWorker: sw });
    const result = await ensureServiceWorkerRegistration();
    expect(result).toEqual({ ok: true, registration: await sw.register.mock.results[0].value });
    expect(sw.register).toHaveBeenCalledExactlyOnceWith("/sw.js");
  });

  it("replaces a registration for another worker", async () => {
    const sw = container(registration("https://store.example/other.js"));
    expect((await ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer)).ok).toBe(true);
    expect(sw.register).toHaveBeenCalledExactlyOnceWith("/sw.js");
  });

  it("shares one registration across concurrent calls without reading ready", async () => {
    const sw = container();
    let finish!: (value: ServiceWorkerRegistration) => void;
    sw.register.mockImplementation(() => new Promise<ServiceWorkerRegistration>((resolve) => { finish = resolve; }));
    const first = ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer);
    const second = ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer);
    await vi.waitFor(() => expect(sw.register).toHaveBeenCalledTimes(1));
    const created = registration();
    finish(created);
    expect(await Promise.all([first, second])).toEqual([{ ok: true, registration: created }, { ok: true, registration: created }]);
    expect(sw.getRegistration).toHaveBeenCalledTimes(1);
  });

  it.each(["getRegistration", "register"] as const)("turns %s rejection into a structured failure and allows retry", async (method) => {
    const sw = container();
    sw[method].mockRejectedValueOnce(new Error("Browser failure"));
    await expect(ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer)).resolves.toEqual({ ok: false, reason: "registration-failed" });
    expect((await ensureServiceWorkerRegistration(sw as unknown as ServiceWorkerContainer)).ok).toBe(true);
  });
});

const hosts = [
  ["localhost", true], ["demo.localhost", true], ["127.0.0.1", true],
  ["::1", true], ["[::1]", true], ["store.example", false],
  ["localhost.example", false], ["192.168.1.10", false],
] as const;

describe("local service-worker hosts", () => {
  it.each(hosts)("classifies %s as local=%s", (host, local) => {
    expect(isLocalServiceWorkerHost(host)).toBe(local);
  });
});

function loadWorker(hostname: string, windows: unknown[] = []) {
  const listeners: Record<string, (event: { waitUntil: (promise: Promise<unknown>) => void; request?: unknown; respondWith?: unknown; notification?: unknown }) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["bhx-smart-store-v1", "bhx-smart-store-v2", "bhx-smart-store-v3", "other-app"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const self = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue(windows), openWindow: vi.fn().mockResolvedValue(undefined) },
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, clients: self.clients, caches, URL, fetch: () => new Promise(() => {}) });
  return { listeners, caches, cache, self };
}

describe("worker caching", () => {
  it("upgrades production caches, evicts credential-bearing v2 HTML and obsolete scripts, and serves clean public login offline", async () => {
    const origin = "https://store.example";
    const legacyScript = "/_next/static/chunks/obsolete-login.js";
    const credentials = ["staff@demo.bhx", "manager@demo.bhx", "admin@demo.bhx", "Demo@123"];
    const stores = new Map<string, Map<string, Response>>([
      ["bhx-smart-store-v2", new Map([
        [`${origin}/login`, new Response(`<html>${credentials.join(" ")}<script src="${legacyScript}"></script></html>`)],
        [`${origin}${legacyScript}`, new Response(`window.accounts = ${JSON.stringify(credentials)}`)],
      ])],
      ["other-app", new Map()],
    ]);
    const key = (request: string | { url: string }) => new URL(typeof request === "string" ? request : request.url, origin).href;
    let online = true;
    const cleanLogin = renderToStaticMarkup(createElement(LoginRoleChoice));
    const network = async (request: string | { url: string }) => {
      if (!online) throw new Error("offline");
      return new Response(key(request) === `${origin}/login` ? cleanLogin : "clean app shell");
    };
    const caches = {
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (request: string | { url: string }) => {
        for (const store of stores.values()) { const response = store.get(key(request)); if (response) return response.clone(); }
      },
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
          addAll: async (requests: string[]) => { for (const request of requests) store.set(key(request), await network(request)); },
          put: async (request: string | { url: string }, response: Response) => { store.set(key(request), response); },
        };
      },
    };
    type WorkerEvent = { waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void; request?: unknown };
    const listeners: Record<string, (event: WorkerEvent) => void> = {};
    const self = { location: { hostname: "store.example", origin }, addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
    runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, caches, URL, fetch: network });
    for (const lifecycle of ["install", "activate"]) {
      let pending!: Promise<unknown>;
      listeners[lifecycle]({ waitUntil: promise => { pending = promise; } }); await pending;
    }
    expect([...stores.keys()]).toEqual(["other-app", "bhx-smart-store-v3"]);
    expect(await caches.match(legacyScript)).toBeUndefined();
    online = false;
    let response!: Promise<Response>;
    listeners.fetch({ request: { method: "GET", mode: "navigate", url: `${origin}/login` }, respondWith: promise => { response = promise; } });
    const html = await (await response).text();
    expect(html).toContain("Tôi là quản trị");
    expect(html).toContain("/staff/login");
    for (const credential of credentials) expect(html).not.toContain(credential);
    for (const store of stores.values()) for (const cached of store.values()) {
      const body = await cached.clone().text();
      for (const credential of credentials) expect(body).not.toContain(credential);
    }
  });

  it.each(hosts.filter(([, local]) => local))("does not populate or intercept caches on %s", async (host) => {
    const worker = loadWorker(host);
    let pending!: Promise<unknown>;
    worker.listeners.install({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(worker.caches.open).not.toHaveBeenCalled();
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    const respondWith = vi.fn();
    worker.listeners.fetch({ waitUntil: vi.fn(), request: { method: "GET", url: `https://${host}/staff`, mode: "navigate" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(Object.keys(worker.listeners)).toEqual(expect.arrayContaining(["push", "notificationclick", "sync"]));
  });

  it.each([["localhost", ["bhx-smart-store-v1", "bhx-smart-store-v2", "bhx-smart-store-v3"]], ["store.example", ["bhx-smart-store-v1", "bhx-smart-store-v2"]]])("cleans only obsolete BHX caches on %s", async (host, deleted) => {
    const worker = loadWorker(host as string);
    let pending!: Promise<unknown>;
    worker.listeners.activate({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(worker.caches.delete.mock.calls.map(([key]) => key)).toEqual(deleted);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });

  it("preserves production app-shell caching and GET interception", async () => {
    const worker = loadWorker("store.example");
    let pending!: Promise<unknown>;
    worker.listeners.install({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    expect(worker.caches.open).toHaveBeenCalledWith("bhx-smart-store-v3");
    expect(worker.cache.addAll).toHaveBeenCalledWith(["/", "/login", "/staff", "/kiosk", "/manifest.webmanifest", "/icon.svg"]);
    // Keep the network pending: this test checks interception, without exercising a browser fetch.
    const respondWith = vi.fn();
    worker.caches.open.mockClear();
    worker.listeners.fetch({ waitUntil: vi.fn(), request: { method: "GET", url: "https://store.example/staff", mode: "navigate" }, respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
  });
});

it.each(["https://store.example/admin?storeId=old&task=old", "https://store.example/admin?storeId=other&task=task-2"])("navigates an existing window at %s to select the complete push destination before focusing", async currentUrl => {
  const client = { url: currentUrl, navigate: vi.fn().mockResolvedValue(undefined), focus: vi.fn().mockResolvedValue(undefined) };
  const worker = loadWorker("store.example", [client]);
  let pending!: Promise<unknown>;
  worker.listeners.notificationclick({ waitUntil: promise => { pending = promise; }, notification: { close: vi.fn(), data: { url: "/admin?storeId=other&task=task-2" } } });
  await pending;
  expect(client.navigate).toHaveBeenCalledExactlyOnceWith("https://store.example/admin?storeId=other&task=task-2");
  expect(client.focus).toHaveBeenCalledOnce(); expect(worker.self.clients.openWindow).not.toHaveBeenCalled();
});
