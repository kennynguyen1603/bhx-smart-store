import { afterEach, describe, expect, it, vi } from "vitest";
import { createKioskDetailCache } from "@/lib/kiosk-detail-cache";

describe("kiosk detail cache", () => {
  afterEach(() => vi.useRealTimers());

  it("deduplicates concurrent requests for the same key", async () => {
    let resolve!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const cache = createKioskDetailCache<string>();

    const first = cache.get("NT-Q5:product-1", loader);
    const second = cache.get("NT-Q5:product-1", loader);
    resolve("detail");

    await expect(Promise.all([first, second])).resolves.toEqual(["detail", "detail"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reuses a fulfilled request for 60 seconds and reloads after expiry", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    const cache = createKioskDetailCache<string>();

    await expect(cache.get("NT-Q5:product-1", loader)).resolves.toBe("first");
    vi.advanceTimersByTime(59_999);
    await expect(cache.get("NT-Q5:product-1", loader)).resolves.toBe("first");
    vi.advanceTimersByTime(1);
    await expect(cache.get("NT-Q5:product-1", loader)).resolves.toBe("second");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected requests so retry can load again", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("recovered");
    const cache = createKioskDetailCache<string>();

    await expect(cache.prefetch("NT-Q5:product-1", loader)).rejects.toThrow("offline");
    await expect(cache.get("NT-Q5:product-1", loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps entries from different stores separate", async () => {
    const loader = vi.fn(async () => `value-${loader.mock.calls.length}`);
    const cache = createKioskDetailCache<string>();

    await expect(cache.get("NT-Q5:product-1", loader)).resolves.toBe("value-1");
    await expect(cache.get("LVV-TD:product-1", loader)).resolves.toBe("value-2");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("clearStore invalidates only keys belonging to that store", async () => {
    const cache = createKioskDetailCache<string>();
    const q5Loader = vi.fn().mockResolvedValueOnce("q5-old-detail").mockResolvedValueOnce("q5-old-map").mockResolvedValueOnce("q5-new");
    const tdLoader = vi.fn().mockResolvedValue("td");
    await cache.get("detail:NT-Q5:product-1", q5Loader);
    await cache.get("map:NT-Q5", q5Loader);
    await cache.get("detail:LVV-TD:product-1", tdLoader);

    cache.clearStore("NT-Q5");

    await expect(cache.get("detail:NT-Q5:product-1", q5Loader)).resolves.toBe("q5-new");
    await expect(cache.get("detail:LVV-TD:product-1", tdLoader)).resolves.toBe("td");
    expect(q5Loader).toHaveBeenCalledTimes(3);
    expect(tdLoader).toHaveBeenCalledTimes(1);
  });

  it("clear invalidates every entry in the kiosk session", async () => {
    const loader = vi.fn().mockResolvedValueOnce("old-detail").mockResolvedValueOnce("old-map").mockResolvedValueOnce("new-detail").mockResolvedValueOnce("new-map");
    const cache = createKioskDetailCache<string>();
    await cache.get("detail:NT-Q5:product-1", loader);
    await cache.get("map:NT-Q5", loader);

    cache.clear();

    await expect(cache.get("detail:NT-Q5:product-1", loader)).resolves.toBe("new-detail");
    await expect(cache.get("map:NT-Q5", loader)).resolves.toBe("new-map");
    expect(loader).toHaveBeenCalledTimes(4);
  });
});
