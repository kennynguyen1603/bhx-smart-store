// Demo presentation and default navigation only. Route/API guards enforce permissions.
export const DEMO_ACCOUNTS = [
  { label: "Nhân viên", description: "thực hiện nhiệm vụ", email: "staff@demo.bhx", role: "STAFF", destination: "/staff" },
  { label: "Quản lý", description: "giám sát cửa hàng", email: "manager@demo.bhx", role: "MANAGER", destination: "/staff" },
  { label: "Quản trị", description: "cấu hình hệ thống", email: "admin@demo.bhx", role: "ADMIN", destination: "/admin" },
] as const;

export function demoDestinationForEmail(email: string): "/staff" | "/admin" {
  return DEMO_ACCOUNTS.find((account) => account.email === email.trim().toLowerCase())?.destination ?? "/staff";
}
