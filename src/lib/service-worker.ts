export type ServiceWorkerRegistrationResult =
  | { ok: true; registration: ServiceWorkerRegistration }
  | { ok: false; reason: "unsupported" | "insecure-context" | "registration-failed" };

const inFlight = new WeakMap<ServiceWorkerContainer, Promise<ServiceWorkerRegistrationResult>>();

export function isLocalServiceWorkerHost(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export async function ensureServiceWorkerRegistration(
  container?: ServiceWorkerContainer,
): Promise<ServiceWorkerRegistrationResult> {
  const serviceWorker = container ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (!serviceWorker) return { ok: false, reason: "unsupported" };
  if (!globalThis.isSecureContext) return { ok: false, reason: "insecure-context" };

  const pending = inFlight.get(serviceWorker);
  if (pending) return pending;

  const attempt = (async (): Promise<ServiceWorkerRegistrationResult> => {
    try {
      const existing = await serviceWorker.getRegistration();
      const workers = [existing?.active, existing?.waiting, existing?.installing];
      const registration = existing && workers.some((worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js")
        ? existing
        : await serviceWorker.register("/sw.js");
      return { ok: true, registration };
    } catch {
      return { ok: false, reason: "registration-failed" };
    }
  })();
  inFlight.set(serviceWorker, attempt);
  try {
    return await attempt;
  } finally {
    inFlight.delete(serviceWorker);
  }
}
