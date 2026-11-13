import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AdminApp } from "@/components/admin-app";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = { title: "Quản trị cửa hàng" };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/admin");
  if (!session.user || session.user.role === "STAFF") redirect("/staff");
  return <AdminApp user={session.user} />;
}
