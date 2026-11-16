import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), receipt: vi.fn(), transaction: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ prisma: { mutationReceipt: { findUnique: mocks.receipt }, $transaction: mocks.transaction } }));
import { completeFefoTask, completeRestock, startTask } from "@/lib/business";
import { POST as start } from "@/app/api/staff/tasks/[id]/start/route";
import { POST as restock } from "@/app/api/staff/tasks/[id]/restock/route";
import { POST as fefo } from "@/app/api/staff/tasks/[id]/fefo/route";

const manager = { id: "manager", role: "MANAGER" as const, storeIds: ["store"] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: manager });
  mocks.receipt.mockResolvedValue({ response: { task: { status: "COMPLETED" } } });
});
describe("task execution authorization", () => {
  it.each([
    ["start", () => startTask("task", manager, "receipt")],
    ["restock", () => completeRestock("task", manager, { clientMutationId: "receipt", quantity: 1, expectedVersion: 1 })],
    ["fefo", () => completeFefoTask("task", manager, "receipt")],
  ] as const)("forbids Manager %s before receipt lookup or any database work", async (_, command) => {
    await expect(command()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([["start", start], ["restock", restock], ["fefo", fefo]] as const)("rejects Manager at the %s HTTP boundary before even parsing a command", async (_, command) => {
    const response = await command(new Request("http://localhost/api/staff/tasks/task/start", { method: "POST", body: "invalid json" }), { params: Promise.resolve({ id: "task" }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([["start", start], ["restock", restock], ["fefo", fefo]] as const)("retains authenticated Staff/Admin receipt replay for %s", async (_, command) => {
    for (const role of ["STAFF", "ADMIN"]) {
      mocks.session.mockResolvedValue({ user: { ...manager, role } });
      const response = await command(new Request("http://localhost/api/staff/tasks/task/start", { method: "POST", body: JSON.stringify({ clientMutationId: "4be45867-f714-49be-b590-ed40d1a658f0", quantity: 1, expectedVersion: 1 }) }), { params: Promise.resolve({ id: "task" }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ task: { status: "COMPLETED" } });
    }
  });
});
