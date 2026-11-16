"use client";

import { Bell, Check, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { disableDevicePush, getDevicePushState, prepareDevicePush, setupDevicePush, type PreparedDevicePush, type PushDisableResult, type PushSetupResult } from "@/lib/push-client";

export type StaffNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  taskId: string | null;
};

export function StaffNotificationCenter({ notifications, storeId, onRead }: {
  notifications: StaffNotification[];
  storeId: string;
  onRead(ids: string[]): Promise<boolean>;
}) {
  const [pushResult, setPushResult] = useState<PushSetupResult | PushDisableResult | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushChecking, setPushChecking] = useState(false);
  const [pushPending, setPushPending] = useState(false);
  const [permissionReady, setPermissionReady] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [readMessage, setReadMessage] = useState("");
  const pushGuard = useRef(false);
  const preparedPushRef = useRef<PreparedDevicePush | null>(null);
  const readGuard = useRef(false);
  const unread = notifications.filter((notification) => !notification.readAt).length;

  async function checkPush() {
    if (pushGuard.current) return;
    pushGuard.current = true;
    setPushChecking(true);
    try {
      const state = await getDevicePushState();
      if (typeof state === "string") { setPushEnabled(state === "enabled"); setPushResult({ status: state }); }
      else { setPushResult(state); if (state.retry === "disable") setPushEnabled(true); }
    } finally { pushGuard.current = false; setPushChecking(false); }
  }

  async function togglePush() {
    if (pushEnabled) {
      if (pushGuard.current) return;
      pushGuard.current = true; setPushPending(true);
      try {
        const result = await disableDevicePush(); setPushResult(result);
        if (result.status === "disabled") setPushEnabled(false);
      } finally { pushGuard.current = false; setPushPending(false); }
      return;
    }
    await enablePush();
  }

  function applySetupResult(result: PushSetupResult) {
    setPushResult(result);
    if (result.status === "enabled") setPushEnabled(true);
  }

  async function enablePush() {
    if (pushGuard.current) return;
    pushGuard.current = true;
    setPushPending(true);
    try {
      if (preparedPushRef.current) {
        const prepared = preparedPushRef.current;
        preparedPushRef.current = null;
        setPermissionReady(false);
        // setupDevicePush requests permission synchronously from this fresh click.
        applySetupResult(await setupDevicePush(prepared));
      } else {
        const preparation = await prepareDevicePush();
        if (preparation.status !== "ready") { setPushResult(preparation); return; }
        if (Notification.permission === "granted") applySetupResult(await setupDevicePush(preparation.prepared));
        else {
          preparedPushRef.current = preparation.prepared;
          setPermissionReady(true);
          setPushResult(null);
        }
      }
    }
    finally { pushGuard.current = false; setPushPending(false); }
  }

  async function markRead(ids: string[]) {
    if (readGuard.current || !ids.length || !storeId) return;
    readGuard.current = true;
    setReadPending(true);
    setReadMessage("");
    try {
      setReadMessage(await onRead(ids) ? "Đã đánh dấu đã đọc." : "Không thể đánh dấu đã đọc. Hãy thử lại.");
    } catch {
      setReadMessage("Không thể đánh dấu đã đọc. Hãy thử lại.");
    } finally { readGuard.current = false; setReadPending(false); }
  }

  return <Dialog onOpenChange={(open) => { if (open) void checkPush(); }}>
    <DialogTrigger asChild>
      <button className="icon-button notification-button" aria-label={unread ? `Thông báo, ${unread} chưa đọc` : "Thông báo"}>
        <Bell aria-hidden="true" />{unread > 0 && <span aria-hidden="true">{unread}</span>}
      </button>
    </DialogTrigger>
    <DialogContent className="staff-notification-center">
      <DialogHeader>
        <DialogTitle>Thông báo</DialogTitle>
        <DialogDescription>{unread ? `${unread} thông báo chưa đọc` : "Bạn đã xem hết thông báo mới."}</DialogDescription>
      </DialogHeader>
      <section className="notification-device" aria-label="Thông báo trên thiết bị">
        <p role="status" className={`notification-status ${pushResult && !["enabled", "disabled"].includes(pushResult.status) ? "warning" : ""}`}>
          {pushChecking ? "Đang kiểm tra thông báo trên thiết bị…" : pushPending ? "Đang cập nhật thông báo trên thiết bị…" : permissionReady ? "Thiết bị đã sẵn sàng. Nhấn cho phép để trình duyệt hỏi quyền nhận thông báo." : pushResult?.status === "enabled" ? "Đã bật Web Push cho thiết bị này." : pushResult?.status === "disabled" ? "Đã tắt Web Push cho thiết bị này. Bạn vẫn nhận thông báo trong ứng dụng." : (pushResult && "message" in pushResult ? pushResult.message : null) || "Bật để nhận thông báo khi không mở ứng dụng."}
        </p>
        <Button variant="outline" disabled={pushPending || pushChecking} onClick={() => void togglePush()}>
          {pushPending && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          {pushPending ? (pushEnabled ? "Đang tắt thông báo" : "Đang bật thông báo") : pushEnabled ? "Tắt thông báo trên thiết bị" : permissionReady ? "Cho phép thông báo trên thiết bị" : "Bật thông báo trên thiết bị"}
        </Button>
      </section>
      <div className="notification-read-action">
        <Button variant="secondary" disabled={readPending || !unread || !storeId} onClick={() => void markRead(notifications.filter(item => !item.readAt).map(item => item.id))}>
          {readPending && <LoaderCircle className="spin" size={16} aria-hidden="true" />}Đánh dấu tất cả đã đọc
        </Button>
        {readMessage && <p role="status" className="notification-status">{readMessage}</p>}
      </div>
      {notifications.length ? <ul className="notification-list" aria-label="Thông báo gần đây">
        {notifications.map((notification) => <li key={notification.id} className={`notification-row ${notification.readAt ? "" : "unread"}`}>
          <div className="notification-row-heading"><strong>{notification.title}</strong><span>{notification.readAt ? "Đã đọc" : "Chưa đọc"}</span>{!notification.readAt && <button className="icon-button notification-read-one" aria-label="Đánh dấu đã đọc" disabled={readPending || !storeId} onClick={() => void markRead([notification.id])}><Check size={16} aria-hidden="true" /></button>}</div>
          <p>{notification.body}</p>
          <time dateTime={notification.createdAt}>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(notification.createdAt))}</time>
        </li>)}
      </ul> : <div className="notification-empty"><Bell aria-hidden="true" /><strong>Chưa có thông báo</strong><p>Thông báo mới của cửa hàng sẽ xuất hiện tại đây.</p></div>}
    </DialogContent>
  </Dialog>;
}
