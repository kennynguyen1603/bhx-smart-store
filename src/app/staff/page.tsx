import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { StaffApp } from "@/components/staff-app";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = { title: "Staff Task PWA" };

export default async function StaffPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/staff");
  return <StaffApp user={session.user} />;
}
