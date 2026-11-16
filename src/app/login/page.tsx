import type { Metadata } from "next";
import { LoginRoleChoice, LoginShell } from "@/components/login-role-choice";

export const metadata: Metadata = { title: "Đăng nhập" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <LoginShell><LoginRoleChoice callbackUrl={typeof query.callbackUrl === "string" ? query.callbackUrl : undefined} /></LoginShell>;
}
