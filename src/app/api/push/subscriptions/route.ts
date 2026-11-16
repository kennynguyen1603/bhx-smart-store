import { z } from "zod";
import { apiErrorResponse, requireUser } from "@/lib/api-auth";
import { pushSubscriptionSchema } from "@/lib/contracts";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await requireUser();
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
    const configured = Boolean(publicKey && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
    return Response.json({ configured, publicKey });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = pushSubscriptionSchema.parse(await request.json());
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      update: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: request.headers.get("user-agent") },
      create: { userId: user.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: request.headers.get("user-agent") },
    });
    return Response.json({ id: subscription.id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(await request.json());
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
