import { expect, test as base, type Request } from "@playwright/test";
import nextEnv from "@next/env";
import type { AdminMapStore } from "../../src/components/admin/admin-map-editor";

type Shelf = AdminMapStore["shelves"][number];
type WithRestoredShelf = (store: AdminMapStore, action: (shelf: Shelf) => Promise<void>) => Promise<void>;
type Write = { id: string; allowed: boolean; sent: boolean; status?: number; outcome: "pending" | "acknowledged" | "neutralized" | "unknown"; done: Promise<void>; resolve(): void };
const SHELF_URL = /\/api\/admin\/shelves\/[^/?]+(?:\?.*)?$/;
const DRAIN_BUDGET_MS = 90_000;

async function withinDrainBudget(operation: Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Shelf writes did not settle within the independent teardown budget; originals are attached. No restoration verification is claimed.")), DRAIN_BUDGET_MS);
    })]);
  } finally { clearTimeout(timer!); }
}

export const test = base.extend<{ withRestoredShelf: WithRestoredShelf }>({
  // Playwright gives this fixture its own teardown timeout, separate from the test body.
  withRestoredShelf: [async ({ page, playwright }, provide, testInfo) => {
    nextEnv.loadEnvConfig(process.cwd());
    const { prisma } = await import("../../src/lib/db");
    let finish: (() => Promise<void>) | undefined;
    let forwarder: Awaited<ReturnType<typeof playwright.request.newContext>> | undefined;
    try {
      await provide(async (store, action) => {
        if (finish) throw new Error("Only one shelf restoration scope is allowed per test");
        const originals = await prisma.shelf.findMany({ where: { storeId: store.id }, select: { id: true, x: true, y: true }, orderBy: { id: "asc" } });
        const byId = new Map(originals.map((shelf) => [shelf.id, shelf]));
        const shelf = [...store.shelves].sort((a, b) => a.x - b.x || a.y - b.y)[0];
        const original = byId.get(shelf.id)!;
        await testInfo.attach("shelf-originals", { body: JSON.stringify(originals), contentType: "application/json" });
        // This transport survives browser request aborts and test-body timeouts. Never
        // infer backend completion from requestfailed/abort on the browser connection.
        forwarder = await playwright.request.newContext({ storageState: await page.context().storageState() });
        const writes = new Map<Request, Write>();
        let closing = false;
        function track(request: Request) {
          if (request.method() !== "PUT" || !SHELF_URL.test(request.url())) return;
          const existing = writes.get(request);
          if (existing) return existing;
          const id = decodeURIComponent(new URL(request.url()).pathname.split("/").at(-1)!);
          let resolve!: () => void;
          const done = new Promise<void>((complete) => { resolve = complete; });
          const write: Write = { id, allowed: !closing && byId.has(id), sent: false, outcome: "pending", done, resolve };
          writes.set(request, write);
          return write;
        }
        page.on("request", track);
        page.on("requestfailed", (request) => {
          const write = writes.get(request);
          // Unforwarded requests can be deterministically neutralized; a late route
          // handler will see this state and cannot send them to the live endpoint.
          if (write && !write.sent) { write.outcome = "neutralized"; write.resolve(); }
        });
        await page.context().route(SHELF_URL, async (route) => {
          const write = track(route.request());
          if (!write) return route.continue();
          if (!write.allowed || write.outcome === "neutralized") {
            write.outcome = "neutralized"; write.resolve();
            await route.abort().catch(() => {});
            return;
          }
          write.sent = true;
          try {
            // No browser/test timeout is allowed to cancel an accepted server write.
            const response = await forwarder!.fetch(route.request(), { timeout: 0, maxRedirects: 0 });
            await response.body();
            write.status = response.status();
            write.outcome = "acknowledged"; write.resolve();
            await route.fulfill({ response }).catch(() => {});
          } catch {
            // A transport error is not proof of a rollback or a completed server write.
            write.outcome = "unknown"; write.resolve();
          }
        });
        let cleanup: Promise<void> | undefined;
        finish = () => cleanup ??= (async () => {
          closing = true;
          await withinDrainBudget(Promise.all([...writes.values()].map((write) => write.done)).then(() => {}));
          if ([...writes.values()].some((write) => write.outcome === "unknown")) {
            throw new Error("Shelf write has unknown server outcome; refusing to claim verified restoration. Originals are attached.");
          }
          const touched = new Set([shelf.id, ...[...writes.values()].filter((write) => write.sent).map((write) => write.id)]);
          const expected = originals.filter((item) => touched.has(item.id));
          const beforeRestore = await prisma.shelf.findMany({ where: { id: { in: [...touched] } }, select: { id: true, x: true, y: true }, orderBy: { id: "asc" } });
          await prisma.$transaction(expected.map(({ id, x, y }) => prisma.shelf.update({ where: { id }, data: { x, y } })));
          const restored = await prisma.shelf.findMany({ where: { id: { in: [...touched] } }, select: { id: true, x: true, y: true }, orderBy: { id: "asc" } });
          expect(restored).toEqual(expected);
          const outcomes = [...writes.values()].map(({ id, outcome, status }) => ({ id, outcome, status }));
          const evidence = { original: expected, beforeRestore, restored, outcomes, drainBudgetMs: DRAIN_BUDGET_MS, fixtureBudgetMs: 120_000 };
          console.log(`Shelf restoration after write drain: ${JSON.stringify(evidence)}`);
          await testInfo.attach("shelf-restoration", { body: JSON.stringify(evidence), contentType: "application/json" });
          // Keep the closed route installed until Playwright closes the context:
          // late UI effects must never bypass the guard after restoration.
        })();
        try { await action({ ...shelf, ...original }); }
        finally { await finish(); }
      });
    } finally {
      // Runs even when an action never rejects (a real test-body timeout).
      try { await finish?.(); }
      finally { await forwarder?.dispose(); await prisma.$disconnect(); }
    }
  }, { timeout: 120_000 }],
});
