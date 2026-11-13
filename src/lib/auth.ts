import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { prisma } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 10 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Tài khoản BHX Demo",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mật khẩu", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: { userStores: { orderBy: { isDefault: "desc" } } },
        });
        if (!user?.active || !(await compare(parsed.data.password, user.passwordHash))) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          storeIds: user.userStores.map((item) => item.storeId),
          defaultStoreId: user.userStores[0]?.storeId ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.storeIds = user.storeIds;
        token.defaultStoreId = user.defaultStoreId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.storeIds = token.storeIds;
      session.user.defaultStoreId = token.defaultStoreId;
      return session;
    },
  },
};
