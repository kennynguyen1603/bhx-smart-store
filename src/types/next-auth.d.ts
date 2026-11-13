import type { DefaultSession } from "next-auth";
import type { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      storeIds: string[];
      defaultStoreId: string | null;
    };
  }

  interface User {
    role: Role;
    storeIds: string[];
    defaultStoreId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    storeIds: string[];
    defaultStoreId: string | null;
  }
}
