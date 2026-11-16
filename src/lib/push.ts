import * as webpush from "web-push";
import { prisma } from "@/lib/db";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };
export type PushDeliveryResult = { sent: number; skipped: boolean };
let configured = false;

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  if (!configured) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }
  return true;
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<PushDeliveryResult> {
  try {
    if (!userIds.length || !configureWebPush()) return { sent: 0, skipped: true };
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: { in: [...new Set(userIds)] }, user: { active: true } },
    });
    let sent = 0;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        } else {
          console.error("Push delivery failed", error);
        }
      }
    }));
    return { sent, skipped: false };
  } catch (error) {
    console.error("Push delivery failed", error);
    return { sent: 0, skipped: true };
  }
}

export async function sendPushToStore(storeId: string, payload: PushPayload): Promise<PushDeliveryResult> {
  try {
    if (!configureWebPush()) return { sent: 0, skipped: true };
    const recipients = await prisma.userStore.findMany({ where: { storeId, user: { active: true } }, select: { userId: true } });
    return await sendPushToUsers(recipients.map(({ userId }) => userId), payload);
  } catch (error) {
    console.error("Push delivery failed", error);
    return { sent: 0, skipped: true };
  }
}
