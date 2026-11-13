import * as webpush from "web-push";
import { prisma } from "@/lib/db";

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

export async function sendPushToStore(
  storeId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  if (!configureWebPush()) return { sent: 0, skipped: true };
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { user: { active: true, userStores: { some: { storeId } } } },
  });
  let sent = 0;
  await Promise.all(
    subscriptions.map(async (subscription) => {
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
    }),
  );
  return { sent, skipped: false };
}
