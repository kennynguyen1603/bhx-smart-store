import { ensureServiceWorkerRegistration } from "@/lib/service-worker";

export type PushSetupResult =
  | { status: "enabled" }
  | { status: "unsupported" | "denied" | "worker-unavailable" | "backend-unconfigured" | "failed"; message: string };

export type PushFailure = Exclude<PushSetupResult, { status: "enabled" }> & { retry?: "disable" };
export type PreparedDevicePush = { registration: ServiceWorkerRegistration; applicationServerKey: Uint8Array<ArrayBuffer> };
type PushPreparationResult = { status: "ready"; prepared: PreparedDevicePush } | PushFailure;
let preparationInFlight: Promise<PushPreparationResult> | null = null;
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

async function prepareSetup(): Promise<PushPreparationResult> {
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
    return { status: "ready", prepared: { registration: worker.registration, applicationServerKey } };
  } catch (error) {
    return error instanceof PushSetupFailure ? error.result : failure;
  }
}

export function prepareDevicePush(): Promise<PushPreparationResult> {
  if (!preparationInFlight) preparationInFlight = prepareSetup().finally(() => { preparationInFlight = null; });
  return preparationInFlight;
}

async function attemptSetup(prepared?: PreparedDevicePush): Promise<PushSetupResult> {
  let failure: PushFailure = { status: "failed", message: "Không thể bật thông báo trên thiết bị. Hãy thử lại." };
  try {
    if (!prepared) {
      const preparation = await prepareDevicePush();
      if (preparation.status !== "ready") return preparation;
      // Preparation may exhaust transient activation. A fresh UI click must supply
      // its prepared context before a permission prompt can be requested.
      if (Notification.permission !== "granted") return { status: "failed", message: "Thiết bị đã sẵn sàng. Hãy nhấn cho phép thông báo trên thiết bị." };
      prepared = preparation.prepared;
    }
    // Keep this call before any await when invoked with a prepared context.
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return { status: "denied", message: permission === "denied" ? "Bạn đã từ chối quyền nhận thông báo." : "Bạn chưa cho phép nhận thông báo." };

    failure = { status: "failed", message: "Không thể tạo đăng ký Web Push trên trình duyệt này." };
    const manager = prepared.registration.pushManager;
    const subscriptionTimeout: PushFailure = { status: "failed", message: "Quá thời gian tạo đăng ký Web Push. Hãy thử lại." };
    const existing = await bounded(manager.getSubscription(), 8_000, subscriptionTimeout);
    const subscription = existing || await bounded(manager.subscribe({ userVisibleOnly: true, applicationServerKey: prepared.applicationServerKey }), 8_000, subscriptionTimeout);

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

export function setupDevicePush(prepared?: PreparedDevicePush): Promise<PushSetupResult> {
  if (!inFlight) inFlight = attemptSetup(prepared).finally(() => { inFlight = null; });
  return inFlight;
}

export type PushDisableResult = { status: "disabled" } | PushFailure;
const pendingCleanup = new WeakMap<ServiceWorkerContainer, string>();
let disableInFlight: Promise<PushDisableResult> | null = null;
const deviceFailure: PushFailure = { status: "failed", message: "Không thể kiểm tra thông báo trên thiết bị. Hãy thử lại." };

// Inspect only: opening the center must not register a worker or prompt for permission.
export async function getDevicePushState(): Promise<"enabled" | "disabled" | PushFailure> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || typeof PushManager === "undefined") return "disabled";
    const worker = navigator.serviceWorker;
    if (pendingCleanup.has(worker)) return { status: "failed", retry: "disable", message: "Chưa hoàn tất tắt thông báo trên thiết bị. Nhấn tắt để thử lại." };
    const registration = await bounded(worker.getRegistration(), 5_000, deviceFailure);
    const subscription = registration?.pushManager && await bounded(registration.pushManager.getSubscription(), 8_000, deviceFailure);
    if (!subscription) return "disabled";
    const controller = new AbortController();
    const verification = await bounded((async () => {
      const response = await fetch(`/api/push/subscriptions?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Push verification unavailable");
      return await response.json() as { registered?: boolean; configured?: boolean };
    })(), 8_000, deviceFailure, () => controller.abort());
    return verification.registered === true && verification.configured === true ? "enabled" : "disabled";
  } catch (error) { return error instanceof PushSetupFailure ? error.result : deviceFailure; }
}

async function attemptDisable(): Promise<PushDisableResult> {
  const failure: PushFailure = { status: "failed", message: "Không thể tắt thông báo trên thiết bị. Hãy thử lại." };
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { status: "disabled" };
    const worker = navigator.serviceWorker;
    let endpoint = pendingCleanup.get(worker);
    const registration = await bounded(worker.getRegistration(), 5_000, failure);
    const subscription = registration?.pushManager && await bounded(registration.pushManager.getSubscription(), 8_000, failure);
    if (!endpoint && !subscription) return { status: "disabled" };
    if (subscription) {
      endpoint = subscription.endpoint;
      // Retain before unsubscribe: even a timeout can finish removing it locally.
      pendingCleanup.set(worker, endpoint);
      if (!await bounded(subscription.unsubscribe(), 8_000, failure)) return failure;
    }
    const controller = new AbortController();
    const response = await bounded(fetch("/api/push/subscriptions", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint }), signal: controller.signal,
    }), 8_000, failure, () => controller.abort());
    if (!response.ok) return failure;
    pendingCleanup.delete(worker);
    return { status: "disabled" };
  } catch (error) { return error instanceof PushSetupFailure ? error.result : failure; }
}

export function disableDevicePush(): Promise<PushDisableResult> {
  if (!disableInFlight) disableInFlight = attemptDisable().finally(() => { disableInFlight = null; });
  return disableInFlight;
}
