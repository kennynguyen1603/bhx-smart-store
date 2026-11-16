import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { LoginShell } from "@/components/login-role-choice";

export const metadata: Metadata = { title: "Đăng nhập nhân viên" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <LoginShell><LoginForm audience="staff" callbackUrl={typeof query.callbackUrl === "string" ? query.callbackUrl : undefined} /></LoginShell>;
}
