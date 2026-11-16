import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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

function loadWorker(hostname: string) {
  const listeners: Record<string, (event: { waitUntil: (promise: Promise<unknown>) => void; request?: unknown; respondWith?: unknown }) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined) };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi.fn().mockResolvedValue(["bhx-smart-store-v1", "bhx-smart-store-v2", "other-app"]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const self = {
    location: { hostname, origin: `https://${hostname}` },
    addEventListener: (name: string, listener: typeof listeners[string]) => { listeners[name] = listener; },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, caches, URL, fetch: () => new Promise(() => {}) });
  return { listeners, caches, cache, self };
}

describe("worker caching", () => {
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

  it.each([["localhost", ["bhx-smart-store-v1", "bhx-smart-store-v2"]], ["store.example", ["bhx-smart-store-v1"]]])("cleans only obsolete BHX caches on %s", async (host, deleted) => {
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
    expect(worker.caches.open).toHaveBeenCalledWith("bhx-smart-store-v2");
    expect(worker.cache.addAll).toHaveBeenCalledWith(["/", "/login", "/staff", "/kiosk", "/manifest.webmanifest", "/icon.svg"]);
    // Keep the network pending: this test checks interception, without exercising a browser fetch.
    const respondWith = vi.fn();
    worker.caches.open.mockClear();
    worker.listeners.fetch({ waitUntil: vi.fn(), request: { method: "GET", url: "https://store.example/staff", mode: "navigate" }, respondWith });
    expect(respondWith).toHaveBeenCalledOnce();
  });
});
