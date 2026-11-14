import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma/client";
import { assertTaskClaimable, taskVisibilityWhere } from "@/lib/task-access";

describe("task access", () => {
  it("limits Staff visibility to unassigned tasks and their own assignments", () => {
    expect(taskVisibilityWhere({ id: "staff-1", role: Role.STAFF }, "store-1")).toEqual({
      storeId: "store-1",
      OR: [{ assigneeId: null }, { assigneeId: "staff-1" }],
    });
  });

  it.each([Role.MANAGER, Role.ADMIN])("gives %s store-wide task visibility", (role) => {
    expect(taskVisibilityWhere({ id: "oversight-user", role }, "store-1")).toEqual({ storeId: "store-1" });
  });

  it("rejects Staff mutation of another Staff member's task", () => {
    expect(() => assertTaskClaimable({ assigneeId: "staff-1" }, { id: "staff-2", role: Role.STAFF }))
      .toThrow(expect.objectContaining({ status: 409, code: "TASK_ALREADY_ASSIGNED" }));
  });

  it("allows Staff to claim unassigned tasks or continue their own task", () => {
    expect(() => assertTaskClaimable({ assigneeId: null }, { id: "staff-1", role: Role.STAFF })).not.toThrow();
    expect(() => assertTaskClaimable({ assigneeId: "staff-1" }, { id: "staff-1", role: Role.STAFF })).not.toThrow();
  });

  it.each([Role.MANAGER, Role.ADMIN])("allows %s to pass assignment authorization", (role) => {
    expect(() => assertTaskClaimable({ assigneeId: "staff-1" }, { id: "oversight-user", role })).not.toThrow();
  });
});
