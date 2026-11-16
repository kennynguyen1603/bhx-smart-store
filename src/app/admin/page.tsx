import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { AdminApp } from "@/components/admin-app";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = { title: "Quản trị cửa hàng" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requestedStore = typeof query.storeId === "string" ? query.storeId : undefined;
  const requestedTask = typeof query.task === "string" ? query.task : undefined;
  const destination = new URLSearchParams({ ...(requestedStore ? { storeId: requestedStore } : {}), ...(requestedTask ? { task: requestedTask } : {}) });
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/admin${destination.size ? `?${destination}` : ""}`)}`);
  if (!session.user || session.user.role === "STAFF") redirect("/staff");
  const authorized = !requestedStore || session.user.role === "ADMIN" || session.user.storeIds.includes(requestedStore);
  return <AdminApp key={`${session.user.id}:${destination}`} user={session.user} initialStoreId={authorized ? requestedStore : undefined} initialTaskId={authorized ? requestedTask : undefined} />;
}
