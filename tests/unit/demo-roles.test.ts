import { describe, expect, it } from "vitest";
import { DEMO_ACCOUNTS, demoDestinationForEmail } from "@/lib/demo-roles";

describe("demo role presentation", () => {
  it("retains three distinct Vietnamese role descriptors and primary destinations", () => {
    expect(DEMO_ACCOUNTS).toEqual([
      { label: "Nhân viên", description: "thực hiện nhiệm vụ", email: "staff@demo.bhx", role: "STAFF", destination: "/staff" },
      { label: "Quản lý", description: "giám sát cửa hàng", email: "manager@demo.bhx", role: "MANAGER", destination: "/staff" },
      { label: "Quản trị", description: "cấu hình hệ thống", email: "admin@demo.bhx", role: "ADMIN", destination: "/admin" },
    ]);
    expect(new Set(DEMO_ACCOUNTS.map((account) => account.description)).size).toBe(3);
  });

  it.each([
    ["staff@demo.bhx", "/staff"], ["manager@demo.bhx", "/staff"], ["admin@demo.bhx", "/admin"],
    [" ADMIN@DEMO.BHX ", "/admin"], ["admin-other@example.com", "/staff"], ["", "/staff"],
  ])("defaults %s to %s without inferring authorization", (email, destination) => {
    expect(demoDestinationForEmail(email)).toBe(destination);
  });
});
