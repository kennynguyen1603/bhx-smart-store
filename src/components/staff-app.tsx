"use client";

import { AlertTriangle, Bell, CalendarClock, CheckCircle2, ClipboardList, Clock3, History, LogOut, PackagePlus, RefreshCw, ScanLine, Store, Wifi, WifiOff, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "next-auth";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { Logo } from "@/components/logo";
import { cacheStaffPayload, enqueueMutation, flushOfflineMutations, getCachedStaffPayload, offlineQueueCount } from "@/lib/offline";

type StoreOption = { id: string; code: string; name: string; address: string };
type Inventory = { id: string; onShelf: number; backroom: number; capacity: number; lowThreshold: number; version: number; product: { id: string; name: string; emoji: string }; shelf: { id: string; code: string; label: string } };
type Task = {
  id: string; type: "RESTOCK" | "FEFO" | "QUARANTINE"; status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED"; priority: "NORMAL" | "MEDIUM" | "HIGH";
  title: string; note: string | null; createdAt: string; product: { id: string; name: string; emoji: string; basePriceVnd: number }; shelf: { id: string; code: string; label: string; esls: { code: string }[] };
  lot: null | { batchCode: string; expiryDate: string; quantity: number; origin: string; markdownPercent: number | null; supplier: { name: string } }; inventory: Inventory | null;
};
type Payload = { stores: StoreOption[]; selectedStoreId: string; tasks: Task[]; inventories: Inventory[]; notifications: { id: string }[]; recentEvents: { id: string; type: string; note: string; createdAt: string; actor: { name: string } | null; task: { product: { name: string }; shelf: { label: string } } }[]; metrics: { openTasks: number; highPriority: number; lowShelves: number; fefoTasks: number; completionRate: number } };

function uuid() { return crypto.randomUUID(); }
function time(value: string) { return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function StaffApp({ user }: { user: Session["user"] }) {
  const [data, setData] = useState<Payload | null>(null);
  const [storeId, setStoreId] = useState(user.defaultStoreId || "");
  const [tab, setTab] = useState<"overview" | "tasks" | "history">("overview");
  const [filter, setFilter] = useState("ACTIVE");
  const [selected, setSelected] = useState<Task | null>(null);
  const [scanned, setScanned] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [online, setOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  const notify = useCallback((message: string, error = false) => { setToast({ message, error }); window.setTimeout(() => setToast(null), 4200); }, []);
  const load = useCallback(async () => {
    if (!storeId) return;
    try {
      const response = await fetch(`/api/staff/tasks?storeId=${storeId}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as Payload;
      setData(payload); await cacheStaffPayload(storeId, payload); setOnline(true);
    } catch {
      const cached = await getCachedStaffPayload<Payload>(storeId);
      if (cached) { setData(cached); setOnline(false); }
      else notify("Không thể tải nhiệm vụ. Kiểm tra kết nối mạng.", true);
    } finally { setLoading(false); }
  }, [storeId, notify]);

  useEffect(() => { const initialLoad = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 15_000); return () => { clearTimeout(initialLoad); clearInterval(timer); }; }, [load]);
  useEffect(() => {
    const sync = async () => { setOnline(navigator.onLine); if (navigator.onLine) { const result = await flushOfflineMutations(); setQueueCount(result.remaining); if (result.conflicts.length) notify("Một cập nhật offline bị xung đột. Hãy kiểm đếm lại.", true); await load(); } };
    window.addEventListener("online", sync); window.addEventListener("offline", sync); document.addEventListener("visibilitychange", sync);
    offlineQueueCount().then(setQueueCount);
    const initialNetworkState = window.setTimeout(() => setOnline(navigator.onLine), 0);
    return () => { clearTimeout(initialNetworkState); window.removeEventListener("online", sync); window.removeEventListener("offline", sync); document.removeEventListener("visibilitychange", sync); };
  }, [load, notify]);

  const activeTasks = useMemo(() => data?.tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status)) || [], [data]);
  const visibleTasks = useMemo(() => {
    const tasks = data?.tasks || [];
    if (filter === "ACTIVE") return tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status));
    if (filter === "COMPLETED") return tasks.filter((task) => task.status === "COMPLETED");
    return tasks.filter((task) => task.type === filter);
  }, [data, filter]);

  async function mutation(url: string, body: Record<string, unknown>, success: string) {
    const id = String(body.clientMutationId || uuid());
    const payload = { ...body, clientMutationId: id };
    if (!navigator.onLine) {
      await enqueueMutation({ id, url, method: "POST", body: payload, createdAt: new Date().getTime() }); setQueueCount((count) => count + 1); notify("Đã lưu thao tác offline. Hệ thống sẽ tự đồng bộ."); return true;
    }
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { const result = await response.json().catch(() => null); notify(result?.error?.message || "Không thể cập nhật", true); return false; }
    notify(success); await load(); return true;
  }

  async function verifyEsl() {
    const response = await fetch(`/api/esl/${encodeURIComponent(scanCode.trim())}`);
    if (!response.ok) { notify("Mã ESL không tồn tại hoặc thuộc cửa hàng khác.", true); return; }
    const result = await response.json();
    if (result.esl.productId !== selected?.product.id || result.esl.shelfId !== selected?.shelf.id) { notify("ESL không khớp sản phẩm/kệ của nhiệm vụ.", true); return; }
    setScanned(true); notify("Đã xác minh đúng ESL.");
  }

  async function completeTask() {
    if (!selected) return;
    let ok = false;
    if (selected.type === "RESTOCK") {
      if (!scanned || !selected.inventory) { notify("Hãy quét và xác minh ESL trước.", true); return; }
      ok = await mutation(`/api/staff/tasks/${selected.id}/restock`, { quantity, expectedVersion: selected.inventory.version, clientMutationId: uuid() }, "Đã cập nhật tồn kệ và tắt LED.");
    } else ok = await mutation(`/api/staff/tasks/${selected.id}/fefo`, { clientMutationId: uuid() }, selected.type === "QUARANTINE" ? "Đã cách ly lô hết hạn." : "Đã áp dụng nhãn FEFO.");
    if (ok) { setSelected(null); setScanned(false); setScanCode(""); }
  }

  async function enablePush() {
    try {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) { notify("Chưa cấu hình VAPID key trên môi trường này.", true); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { notify("Bạn chưa cho phép nhận thông báo.", true); return; }
      const registration = await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await fetch("/api/push/subscriptions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      notify("Đã bật Web Push cho thiết bị này.");
    } catch { notify("Không thể bật Web Push trên trình duyệt này.", true); }
  }

  async function openTask(task: Task) { setSelected(task); setScanned(false); setScanCode(task.shelf.esls[0]?.code || ""); setQuantity(Math.min(Math.max(task.inventory ? task.inventory.capacity - task.inventory.onShelf : 1, 1), task.inventory?.backroom || 1)); if(["OPEN","BLOCKED"].includes(task.status)) await mutation(`/api/staff/tasks/${task.id}/start`,{clientMutationId:uuid()},"Đã bắt đầu nhiệm vụ."); }
  const nav = [{ id: "overview", label: "Tổng quan", icon: Store }, { id: "tasks", label: "Nhiệm vụ", icon: ClipboardList }, { id: "history", label: "Lịch sử", icon: History }] as const;

  return (
    <main className="app-shell">
      <aside className="sidebar"><Logo inverse /><div className="store-selector"><label>ĐANG LÀM VIỆC TẠI</label><select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{data?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div><nav className="side-nav">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon /><span className="nav-label">{label}</span>{id === "tasks" && <span className="count" aria-label={`${activeTasks.length} nhiệm vụ đang mở`}>{activeTasks.length}</span>}</button>)}<button onClick={() => { setTab("tasks"); setFilter("ACTIVE"); }}><ScanLine /><span className="nav-label">Quét ESL</span></button></nav><div className="user-card"><span className="user-avatar">{user.name?.split(" ").slice(-2).map((v) => v[0]).join("")}</span><span><strong>{user.name}</strong><small>{user.role}</small></span><button onClick={() => signOut({ callbackUrl: "/" })} aria-label="Đăng xuất"><LogOut /></button></div></aside>
      <section className="workspace">
        <header className="workspace-header"><div><span className="section-label">{new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase()}</span><h1>Chào buổi sáng, {user.name?.split(" ").at(-1)} 👋</h1><p>{data?.stores.find((store) => store.id === storeId)?.address}</p></div><div className="header-actions"><span className={`connection-pill ${online ? "" : "offline"}`}>{online ? <Wifi /> : <WifiOff />}{online ? "Đã đồng bộ" : `Offline · ${queueCount} chờ`}</span><button className="icon-button notification-button" onClick={enablePush} aria-label="Bật thông báo"><Bell />{!!data?.notifications.length&&<span>{data.notifications.length}</span>}</button><button className="icon-button" onClick={() => load()} aria-label="Tải lại"><RefreshCw className={loading ? "spin" : ""} /></button></div></header>
        {data && <div className="metric-grid"><Metric icon={ClipboardList} label="Nhiệm vụ mở" value={data.metrics.openTasks} helper={`${data.metrics.highPriority} khẩn cấp`} /><Metric icon={AlertTriangle} label="Kệ sắp hết" value={data.metrics.lowShelves} helper="Theo dữ liệu POS" alert /><Metric icon={CalendarClock} label="FEFO hôm nay" value={data.metrics.fefoTasks} helper="Nhãn/cách ly" /><Metric icon={CheckCircle2} label="Hoàn thành" value={`${data.metrics.completionRate}%`} helper="Trong ca hiện tại" /></div>}
        {tab === "overview" && <div className="dashboard-grid"><section className="panel"><PanelTitle label="CẦN XỬ LÝ" title="Nhiệm vụ ưu tiên" /><div className="task-list">{activeTasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} onClick={() => openTask(task)} />)}{!activeTasks.length && <div className="empty-state">Bạn đã xử lý hết nhiệm vụ đang mở.</div>}</div></section><section className="panel"><PanelTitle label="LIVE DATA" title="Tình trạng kệ" /><div className="stock-list">{data?.inventories.slice(0, 6).map((item) => <div className="stock-row" key={item.id}><div className="stock-head"><strong>{item.product.name}</strong><span>{item.onShelf}/{item.capacity}</span></div><div className="stock-bar"><i className={item.onShelf <= item.lowThreshold ? "low" : ""} style={{ width: `${Math.min(100, item.onShelf / item.capacity * 100)}%` }} /></div></div>)}</div></section></div>}
        {tab === "tasks" && <section className="panel"><PanelTitle label="CÔNG VIỆC TRONG CA" title="Tất cả nhiệm vụ" /><div className="filter-row">{[["ACTIVE","Đang mở"],["RESTOCK","Bổ sung"],["FEFO","FEFO"],["QUARANTINE","Cách ly"],["COMPLETED","Hoàn thành"]].map(([id,label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="task-list">{visibleTasks.map((task) => <TaskRow key={task.id} task={task} onClick={() => openTask(task)} />)}{!visibleTasks.length && <div className="empty-state">Không có nhiệm vụ phù hợp bộ lọc.</div>}</div></section>}
        {tab === "history" && <section className="panel"><PanelTitle label="NHẬT KÝ THAO TÁC" title="Hoạt động gần đây" /><div className="log-list">{data?.recentEvents.map((event) => <div className="log-row" key={event.id}><code>{event.type}</code><span><strong>{event.task.product.name}</strong><br />{event.note || event.task.shelf.label}</span><time>{time(event.createdAt)}</time></div>)}</div></section>}
      </section>
      {selected && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}><section className="modal staff-task-modal"><button className="icon-button modal-close" onClick={() => setSelected(null)} aria-label="Đóng nhiệm vụ"><X /></button><header className="modal-head"><span className="section-label">{selected.type} · {selected.priority}</span><h2>{selected.title}</h2><p>{selected.note}</p></header><div className="modal-body"><div className="product-summary"><span>{selected.product.emoji}</span><span><small>{selected.shelf.label}</small><strong>{selected.product.name}</strong><small>{selected.shelf.code}</small></span><span className={`badge ${selected.status.toLowerCase()}`}>{selected.status}</span></div>{selected.type === "RESTOCK" ? <><div className="detail-grid"><div className="detail-box"><span>Tồn trên kệ</span><strong>{selected.inventory?.onShelf}/{selected.inventory?.capacity}</strong></div><div className="detail-box"><span>Tồn kho sau</span><strong>{selected.inventory?.backroom}</strong></div></div><div className="esl-verification"><BarcodeScanner onDetected={(value) => { setScanCode(value); setScanned(false); }} label="Quét mã ESL" /><div className="manual-scan-label"><span>HOẶC NHẬP MÃ THIẾT BỊ</span><small>Mã được in ở cạnh dưới của nhãn điện tử</small></div><div className="manual-scan"><input className="form-control" value={scanCode} onChange={(e) => { setScanCode(e.target.value); setScanned(false); }} placeholder="Ví dụ: ESL-NT-Q5-L-02" aria-label="Mã ESL" /><button className="button" onClick={verifyEsl}>Xác minh</button></div>{scanned && <div className="alert-box scan-success">✓ ESL khớp đúng sản phẩm và vị trí kệ.</div>}</div><label className="muted quantity-label">Số lượng bổ sung<div className="number-control"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Giảm số lượng">−</button><input className="form-control" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /><button onClick={() => setQuantity(quantity + 1)} aria-label="Tăng số lượng">+</button></div></label></> : <><div className="detail-grid"><div className="detail-box"><span>Mã lô</span><strong>{selected.lot?.batchCode}</strong></div><div className="detail-box"><span>Hạn sử dụng</span><strong>{selected.lot && new Intl.DateTimeFormat("vi-VN").format(new Date(selected.lot.expiryDate))}</strong></div><div className="detail-box"><span>Nhà cung cấp</span><strong>{selected.lot?.supplier.name}</strong></div><div className="detail-box"><span>Xuất xứ</span><strong>{selected.lot?.origin}</strong></div></div><div className={`alert-box ${selected.type === "QUARANTINE" ? "danger" : ""}`}>{selected.type === "QUARANTINE" ? "Lô đã hết hạn. Di chuyển khỏi khu vực bán và xác nhận cách ly." : "Kiểm tra đúng lô, dán nhãn giảm giá và ưu tiên bán trước."}</div></>}</div><footer className="modal-actions"><button className="button" onClick={() => setSelected(null)}>Để sau</button><button className="button primary" onClick={completeTask}>{selected.type === "RESTOCK" ? "Xác nhận bổ sung" : selected.type === "QUARANTINE" ? "Xác nhận cách ly" : "Xác nhận đã dán nhãn"}</button></footer></section></div>}
      {toast && <div className="toast-stack"><div className={`toast ${toast.error ? "error" : ""}`}><strong>{toast.error ? "Có lỗi" : "Đã cập nhật"}</strong>{toast.message}</div></div>}
    </main>
  );
}

function Metric({ icon: Icon, label, value, helper, alert }: { icon: typeof Store; label: string; value: string | number; helper: string; alert?: boolean }) { return <article className={`metric ${alert ? "alert" : ""}`}><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{value}</strong><small>{helper}</small></span></article>; }
function PanelTitle({ label, title }: { label: string; title: string }) { return <header className="panel-header"><div><span className="section-label">{label}</span><h2>{title}</h2></div></header>; }
function TaskRow({ task, onClick }: { task: Task; onClick(): void }) { const Icon = task.type === "RESTOCK" ? PackagePlus : task.type === "QUARANTINE" ? AlertTriangle : Clock3; return <button className="task-row" onClick={onClick}><span className={`task-icon ${task.type !== "RESTOCK" ? "fefo" : ""} ${task.priority === "HIGH" ? "high" : ""}`}><Icon /></span><span className="task-copy"><strong>{task.title}</strong><span>{task.product.name} · {task.shelf.label}</span></span><span className="task-meta"><span className={`badge ${task.status === "BLOCKED" ? "blocked" : task.status === "COMPLETED" ? "completed" : task.priority.toLowerCase()}`}>{task.status === "BLOCKED" ? "Bị chặn" : task.priority}</span><time>{time(task.createdAt)}</time></span></button>; }
