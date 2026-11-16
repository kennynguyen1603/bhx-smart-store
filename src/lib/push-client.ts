import { ensureServiceWorkerRegistration } from "@/lib/service-worker";

export type PushSetupResult =
  | { status: "enabled" }
  | { status: "unsupported" | "denied" | "worker-unavailable" | "backend-unconfigured" | "failed"; message: string };

type PushFailure = Exclude<PushSetupResult, { status: "enabled" }>;
let inFlight: Promise<PushSetupResult> | null = null;

class PushSetupFailure extends Error {
  constructor(readonly result: PushFailure) { super(result.message); }
}

function bounded<T>(operation: Promise<T>, milliseconds: number, failure: PushFailure, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout?.(); reject(new PushSetupFailure(failure)); }, milliseconds);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

function waitForActivation(registration: ServiceWorkerRegistration): Promise<void> {
  if (registration.active?.state === "activated") return Promise.resolve();
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) return Promise.reject(new Error("No worker available"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(false), 5_000);
    function finish(activated: boolean) {
      clearTimeout(timer);
      worker!.removeEventListener("statechange", check);
      if (activated) resolve(); else reject(new Error("Worker activation unavailable"));
    }
    function check() {
      if (worker!.state === "activated") finish(true);
      else if (worker!.state === "redundant") finish(false);
    }
    worker.addEventListener("statechange", check);
    check();
  });
}

async function attemptSetup(): Promise<PushSetupResult> {
  let failure: PushFailure = { status: "failed", message: "Không thể bật thông báo trên thiết bị. Hãy thử lại." };
  try {
    if (typeof navigator === "undefined" || typeof Notification === "undefined" || typeof PushManager === "undefined" || !("serviceWorker" in navigator)) {
      return { status: "unsupported", message: "Trình duyệt này không hỗ trợ Web Push." };
    }
    if (Notification.permission === "denied") return { status: "denied", message: "Bạn đã từ chối quyền nhận thông báo." };

    failure = { status: "failed", message: "Không thể kiểm tra thông báo trên thiết bị. Hãy thử lại." };
    const readinessController = new AbortController();
    const readiness = await bounded((async () => {
      const response = await fetch("/api/push/subscriptions", { cache: "no-store", signal: readinessController.signal });
      if (!response.ok) throw new Error("Readiness unavailable");
      return await response.json() as { configured: boolean; publicKey: string | null };
    })(), 8_000, failure, () => readinessController.abort());
    if (!readiness.configured || !readiness.publicKey) {
      return { status: "backend-unconfigured", message: "Thông báo trên thiết bị chưa được cấu hình. Bạn vẫn có thể xem thông báo tại đây." };
    }
    // Decode before prompting: invalid configuration must not consume a permission decision.
    const key = readiness.publicKey.replace(/-/g, "+").replace(/_/g, "/");
    const applicationServerKey = Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4, "=")), (char) => char.charCodeAt(0));

    failure = { status: "worker-unavailable", message: "Không thể khởi tạo thông báo trên thiết bị. Hãy thử lại." };
    const worker = await bounded(ensureServiceWorkerRegistration(), 5_000, failure);
    if (!worker.ok) return failure;
    if (!worker.registration.pushManager) return { status: "unsupported", message: "Trình duyệt này không hỗ trợ Web Push." };
    await waitForActivation(worker.registration);

    failure = { status: "failed", message: "Không thể bật thông báo trên thiết bị. Hãy thử lại." };
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return { status: "denied", message: permission === "denied" ? "Bạn đã từ chối quyền nhận thông báo." : "Bạn chưa cho phép nhận thông báo." };

    failure = { status: "failed", message: "Không thể tạo đăng ký Web Push trên trình duyệt này." };
    const manager = worker.registration.pushManager;
    const subscriptionTimeout: PushFailure = { status: "failed", message: "Quá thời gian tạo đăng ký Web Push. Hãy thử lại." };
    const existing = await bounded(manager.getSubscription(), 8_000, subscriptionTimeout);
    const subscription = existing || await bounded(manager.subscribe({ userVisibleOnly: true, applicationServerKey }), 8_000, subscriptionTimeout);

    failure = { status: "failed", message: "Không thể lưu đăng ký Web Push. Hãy thử lại." };
    const controller = new AbortController();
    const response = await bounded(fetch("/api/push/subscriptions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()), signal: controller.signal,
    }), 8_000, { status: "failed", message: "Quá thời gian lưu đăng ký Web Push. Hãy thử lại." }, () => controller.abort());
    return response.ok ? { status: "enabled" } : failure;
  } catch (error) {
    return error instanceof PushSetupFailure ? error.result : failure;
  }
}

export function setupDevicePush(): Promise<PushSetupResult> {
  if (!inFlight) inFlight = attemptSetup().finally(() => { inFlight = null; });
  return inFlight;
}
