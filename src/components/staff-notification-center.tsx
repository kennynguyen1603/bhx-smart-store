"use client";

import { Bell, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { setupDevicePush, type PushSetupResult } from "@/lib/push-client";

export type StaffNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  taskId: string | null;
};

export function StaffNotificationCenter({ notifications, storeId, onReadAll }: {
  notifications: StaffNotification[];
  storeId: string;
  onReadAll(): Promise<boolean>;
}) {
  const [pushResult, setPushResult] = useState<PushSetupResult | null>(null);
  const [pushPending, setPushPending] = useState(false);
  const [readPending, setReadPending] = useState(false);
  const [readMessage, setReadMessage] = useState("");
  const pushGuard = useRef(false);
  const readGuard = useRef(false);
  const unread = notifications.filter((notification) => !notification.readAt).length;

  async function enablePush() {
    if (pushGuard.current) return;
    pushGuard.current = true;
    setPushPending(true);
    try { setPushResult(await setupDevicePush()); }
    finally { pushGuard.current = false; setPushPending(false); }
  }

  async function markAllRead() {
    if (readGuard.current || !unread || !storeId) return;
    readGuard.current = true;
    setReadPending(true);
    setReadMessage("");
    try {
      setReadMessage(await onReadAll() ? "Đã đánh dấu tất cả đã đọc." : "Không thể đánh dấu đã đọc. Hãy thử lại.");
    } catch {
      setReadMessage("Không thể đánh dấu đã đọc. Hãy thử lại.");
    } finally { readGuard.current = false; setReadPending(false); }
  }

  return <Dialog>
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
        <p role="status" className={`notification-status ${pushResult && pushResult.status !== "enabled" ? "warning" : ""}`}>
          {pushPending ? "Đang thiết lập thông báo trên thiết bị…" : pushResult?.status === "enabled" ? "Đã bật Web Push cho thiết bị này." : pushResult?.message || "Bật để nhận thông báo khi không mở ứng dụng."}
        </p>
        <Button variant="outline" disabled={pushPending || pushResult?.status === "enabled"} onClick={() => void enablePush()}>
          {pushPending && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
          {pushPending ? "Đang bật thông báo" : "Bật thông báo trên thiết bị"}
        </Button>
      </section>
      <div className="notification-read-action">
        <Button variant="secondary" disabled={readPending || !unread || !storeId} onClick={() => void markAllRead()}>
          {readPending && <LoaderCircle className="spin" size={16} aria-hidden="true" />}Đánh dấu tất cả đã đọc
        </Button>
        {readMessage && <p role="status" className="notification-status">{readMessage}</p>}
      </div>
      {notifications.length ? <ul className="notification-list" aria-label="Thông báo gần đây">
        {notifications.map((notification) => <li key={notification.id} className={`notification-row ${notification.readAt ? "" : "unread"}`}>
          <div className="notification-row-heading"><strong>{notification.title}</strong><span>{notification.readAt ? "Đã đọc" : "Chưa đọc"}</span></div>
          <p>{notification.body}</p>
          <time dateTime={notification.createdAt}>{new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(notification.createdAt))}</time>
        </li>)}
      </ul> : <div className="notification-empty"><Bell aria-hidden="true" /><strong>Chưa có thông báo</strong><p>Thông báo mới của cửa hàng sẽ xuất hiện tại đây.</p></div>}
    </DialogContent>
  </Dialog>;
}
