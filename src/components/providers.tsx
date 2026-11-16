"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";
import { ensureServiceWorkerRegistration } from "@/lib/service-worker";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void ensureServiceWorkerRegistration();
  }, []);
  return <SessionProvider>{children}</SessionProvider>;
}
