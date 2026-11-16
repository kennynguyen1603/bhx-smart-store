import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { StaffApp } from "@/components/staff-app";
import { authOptions } from "@/lib/auth";
import { isRoleAllowedForAudience } from "@/lib/demo-roles";

export const metadata: Metadata = { title: "Staff Task PWA" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requestedStore = typeof query.storeId === "string" ? query.storeId : undefined;
  const requestedTask = typeof query.task === "string" ? query.task : undefined;
  const destination = new URLSearchParams({ ...(requestedStore ? { storeId: requestedStore } : {}), ...(requestedTask ? { task: requestedTask } : {}) });
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/staff/login?callbackUrl=${encodeURIComponent(`/staff${destination.size ? `?${destination}` : ""}`)}`);
  if (!isRoleAllowedForAudience(session.user.role, "staff")) redirect(`/admin${destination.size ? `?${destination}` : ""}`);
  const authorized = !requestedStore || session.user.role === "ADMIN" || session.user.storeIds.includes(requestedStore);
  return <StaffApp key={`${session.user.id}:${destination}`} user={session.user} initialStoreId={authorized ? requestedStore : undefined} initialTaskId={authorized ? requestedTask : undefined} />;
}
