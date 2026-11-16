"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Clock3, History, LogOut, PackagePlus, RefreshCw, ScanLine, Store, Wifi, WifiOff, X } from "lucide-react";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "next-auth";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { EslScannerModal, type TaskSummary } from "@/components/esl-scanner-modal";
import { Badge } from "@/components/ui/badge";
import { useStoreChangePolling } from "@/lib/use-store-change-polling";
import { TASK_STATUS_PRESENTATION } from "@/lib/task-status";
import { Logo } from "@/components/logo";
import { ROLE_LABELS } from "@/lib/demo-roles";
import { StaffNotificationCenter, type StaffNotification } from "@/components/staff-notification-center";
import { cacheStaffPayload, enqueueMutation, flushOfflineMutations, getCachedStaffPayload, markCachedStaffNotificationsRead, offlineQueueCount } from "@/lib/offline";

type TaskStatus = TaskSummary["status"];
export { TASK_STATUS_PRESENTATION } from "@/lib/task-status";

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { label, variant } = TASK_STATUS_PRESENTATION[status];
  return <Badge variant={variant}>{label}</Badge>;
}

type StoreOption = { id: string; code: string; name: string; address: string };
type Inventory = { id: string; onShelf: number; backroom: number; capacity: number; lowThreshold: number; version: number; product: { id: string; name: string; emoji: string }; shelf: { id: string; code: string; label: string } };
type Task = TaskSummary & { inventory: Inventory | null };
type Payload = { stores: StoreOption[]; selectedStoreId: string; tasks: Task[]; inventories: Inventory[]; notifications: StaffNotification[]; recentEvents: { id: string; type: string; note: string; createdAt: string; actor: { name: string } | null; task: { product: { name: string }; shelf: { label: string } } }[]; metrics: { openTasks: number; highPriority: number; lowShelves: number; fefoTasks: number; completionRate: number } };

function uuid() { return crypto.randomUUID(); }
function time(value: string) { return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }

export function StaffApp({ user, initialStoreId, initialTaskId }: { user: Session["user"]; initialStoreId?: string; initialTaskId?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [storeId, setStoreId] = useState(initialStoreId || user.defaultStoreId || "");
  const [tab, setTab] = useState<"overview" | "tasks" | "history" | "scanner">("overview");
  const [filter, setFilter] = useState("ACTIVE");
  const [selected, setSelected] = useState<Task | null>(null);
  const [starting, setStarting] = useState(false);
  const startPendingRef = useRef(false);
  const [scanned, setScanned] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [online, setOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const readPendingRef = useRef<{ storeId: string; previous: StaffNotification[]; readAt: string } | null>(null);
  const readVersionsRef = useRef(new Map<string, number>());
  const confirmedReadsRef = useRef(new Map<string, Map<string, string>>());
  const loadGenerationRef = useRef(0);
  const loadStoreIdRef = useRef<string | null>(storeId);
  const activeLoadRef = useRef<{ controller: AbortController; promise: Promise<boolean>; followup?: Promise<boolean> } | null>(null);
  const queueSyncRef = useRef<Promise<void> | null>(null);
  const managerOversight = user.role === "MANAGER";
  const destinationOpenedRef = useRef(false);

  const openTask = useCallback((task: Task) => {
    setSelected(task);
    setScanned(false);
    setScanCode(task.shelf.esls[0]?.code || "");
    setQuantity(Math.min(Math.max(task.inventory ? task.inventory.capacity - task.inventory.onShelf : 1, 1), task.inventory?.backroom || 1));
  }, []);
  useEffect(() => {
    if (destinationOpenedRef.current || data?.selectedStoreId !== storeId) return;
    const task = data?.tasks.find(task => task.id === initialTaskId);
    if (!task) return;
    const timer = window.setTimeout(() => {
      destinationOpenedRef.current = true;
      setTab("tasks");
      openTask(task);
    }, 0);
    return () => clearTimeout(timer);
  }, [data, storeId, initialTaskId, openTask]);

  const mergeConfirmedReads = useCallback((payload: Payload): Payload => {
    const confirmed = confirmedReadsRef.current.get(payload.selectedStoreId);
    return confirmed ? { ...payload, notifications: payload.notifications.map((item) => {
      const readAt = confirmed.get(item.id);
      return !item.readAt && readAt ? { ...item, readAt } : item;
    }) } : payload;
  }, []);

  const notify = useCallback((message: string, error = false) => { setToast({ message, error }); window.setTimeout(() => setToast(null), 4200); }, []);
  const load = useCallback(async function loadStore(refreshAfterPending = false, requireVisible = false): Promise<boolean> {
    if (!storeId || storeId !== loadStoreIdRef.current || (requireVisible && document.visibilityState !== "visible")) return false;
    const generation = loadGenerationRef.current;
    const active = activeLoadRef.current;
    if (active) {
      if (!refreshAfterPending) return active.promise;
      // A change detected during an older GET must not be consumed by that snapshot.
      active.followup ??= active.promise.then(() => {
        return generation === loadGenerationRef.current ? loadStore(false, requireVisible) : false;
      });
      return active.followup;
    }
    const controller = new AbortController();
    const readVersion = readVersionsRef.current.get(storeId) || 0;
    const isCurrent = () => !controller.signal.aborted && generation === loadGenerationRef.current;
    const isCurrentReadVersion = () => isCurrent() && readVersion === (readVersionsRef.current.get(storeId) || 0);
    const promise = (async () => {
      try {
        const response = await fetch(`/api/staff/tasks?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const payload = mergeConfirmedReads(await response.json() as Payload);
        if (!isCurrentReadVersion()) return false;
        const pendingRead = readPendingRef.current;
        const pendingIds = new Set(pendingRead?.previous.filter((item) => !item.readAt).map((item) => item.id));
        setData(pendingRead?.storeId === storeId ? {
          ...payload,
          notifications: payload.notifications.map((item) => !item.readAt && pendingIds.has(item.id) ? { ...item, readAt: pendingRead.readAt } : item),
        } : payload);
        await cacheStaffPayload(storeId, payload).catch(() => undefined);
        if (!isCurrentReadVersion()) return false;
        setOnline(true);
        return true;
      } catch {
        if (!isCurrent()) return false;
        const cached = await getCachedStaffPayload<Payload>(storeId);
        if (!isCurrentReadVersion()) return false;
        if (cached) { setData(mergeConfirmedReads(cached)); setOnline(false); }
        else notify("Không thể tải nhiệm vụ. Kiểm tra kết nối mạng.", true);
        return false;
      } finally {
        if (isCurrent()) setLoading(false);
        if (activeLoadRef.current?.controller === controller) activeLoadRef.current = null;
      }
    })();
    activeLoadRef.current = { controller, promise };
    return promise;
  }, [storeId, notify, mergeConfirmedReads]);

  useEffect(() => {
    loadStoreIdRef.current = storeId;
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(initialLoad);
      loadStoreIdRef.current = null;
      loadGenerationRef.current += 1;
      activeLoadRef.current?.controller.abort();
      activeLoadRef.current = null;
    };
  }, [load, storeId]);
  useStoreChangePolling({ storeId, onChange: async () => {
    if (!await load(true, true)) throw new Error("Store refresh was not acknowledged");
  } });
  useEffect(() => {
    let disposed = false;
    let retryPending = false;
    const sync = (event?: Event) => {
      if (disposed) return;
      setOnline(navigator.onLine);
      if (!navigator.onLine || document.visibilityState !== "visible") return;
      if (queueSyncRef.current) {
        if (!retryPending) {
          retryPending = true;
          void queueSyncRef.current.then(() => { retryPending = false; if (!disposed) sync(); });
        }
        return;
      }
      const operation = (async () => {
        const queued = await offlineQueueCount();
        if (disposed || document.visibilityState !== "visible") return;
        setQueueCount(queued);
        if (queued > 0) {
          const result = await flushOfflineMutations();
          if (disposed) return;
          setQueueCount(result.remaining);
          if (result.conflicts.length) notify("Một cập nhật offline bị xung đột. Hãy kiểm đếm lại.", true);
        }
        if ((queued > 0 || event?.type === "online") && document.visibilityState === "visible") await load(true, true);
      })().catch(() => undefined).finally(() => {
        if (queueSyncRef.current === operation) queueSyncRef.current = null;
      });
      queueSyncRef.current = operation;
    };
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    offlineQueueCount().then(count => { if (!disposed) setQueueCount(count); }).catch(() => undefined);
    const initialNetworkState = window.setTimeout(sync, 0);
    return () => {
      disposed = true;
      clearTimeout(initialNetworkState);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
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
      await enqueueMutation({ id, url, method: "POST", body: payload, createdAt: new Date().getTime() }); setQueueCount((count) => count + 1); notify("Đã lưu thao tác offline. Hệ thống sẽ tự đồng bộ."); return "queued" as const;
    }
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) { const result = await response.json().catch(() => null); notify(result?.error?.message || "Không thể cập nhật", true); return false; }
    notify(success); await load(true); return true;
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
    let ok: boolean | "queued" = false;
    if (selected.type === "RESTOCK") {
      if (!scanned || !selected.inventory) { notify("Hãy quét và xác minh ESL trước.", true); return; }
      ok = await mutation(`/api/staff/tasks/${selected.id}/restock`, { quantity, expectedVersion: selected.inventory.version, clientMutationId: uuid() }, "Đã cập nhật tồn kệ và tắt LED.");
    } else ok = await mutation(`/api/staff/tasks/${selected.id}/fefo`, { clientMutationId: uuid() }, selected.type === "QUARANTINE" ? "Đã cách ly lô hết hạn." : "Đã áp dụng nhãn FEFO.");
    if (ok) { setSelected(null); setScanned(false); setScanCode(""); }
  }

  async function markNotificationsRead(requestedIds: string[]): Promise<boolean> {
    if (!data || data.selectedStoreId !== storeId || readPendingRef.current) return false;
    const requested = new Set(requestedIds);
    const previous = data.notifications.filter((item) => !item.readAt && requested.has(item.id));
    const ids = previous.map((item) => item.id);
    const displayedIds = new Set(ids);
    const readAt = new Date().toISOString();
    readVersionsRef.current.set(storeId, (readVersionsRef.current.get(storeId) || 0) + 1);
    readPendingRef.current = { storeId, previous, readAt };
    setData((current) => current?.selectedStoreId === storeId ? { ...current, notifications: current.notifications.map((item) => !item.readAt && displayedIds.has(item.id) ? { ...item, readAt } : item) } : current);
    try {
      const response = await fetch("/api/staff/notifications", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ storeId, ids }),
      });
      if (!response.ok) throw new Error("Read update failed");
      const result = await response.json() as { readAt: string };
      const confirmed = confirmedReadsRef.current.get(storeId) || new Map<string, string>();
      for (const id of ids) confirmed.set(id, result.readAt);
      confirmedReadsRef.current.set(storeId, confirmed);
      // Invalidate pre-confirmation GETs before awaiting the cache transaction.
      readVersionsRef.current.set(storeId, (readVersionsRef.current.get(storeId) || 0) + 1);
      setData((current) => current?.selectedStoreId === storeId ? {
        ...current, notifications: current.notifications.map((item) => displayedIds.has(item.id) && item.readAt === readAt ? { ...item, readAt: result.readAt } : item),
      } : current);
      // Storage failure must not roll back a successful server acknowledgement.
      // The in-memory confirmations still protect fallback for this session.
      await markCachedStaffNotificationsRead(storeId, ids, result.readAt).catch(() => undefined);
      return true;
    } catch {
      const previousById = new Map(previous.map((item) => [item.id, item]));
      setData((current) => current?.selectedStoreId === storeId ? {
        ...current,
        notifications: current.notifications.map((item) => item.readAt === readAt ? previousById.get(item.id) || item : item),
      } : current);
      return false;
    } finally {
      // A response started before completion may still contain pre-PATCH unread rows.
      readVersionsRef.current.set(storeId, (readVersionsRef.current.get(storeId) || 0) + 1);
      readPendingRef.current = null;
    }
  }

  async function startSelectedTask(): Promise<void> {
    if (!selected || user.role !== "STAFF" || !["OPEN", "BLOCKED"].includes(selected.status) || startPendingRef.current) return;
    const taskId = selected.id;
    startPendingRef.current = true;
    setStarting(true);
    try {
      const ok = await mutation(`/api/staff/tasks/${taskId}/start`, { clientMutationId: uuid() }, "Đã bắt đầu nhiệm vụ.");
      if (ok === true) {
        setSelected((current) => current?.id === taskId ? { ...current, status: "IN_PROGRESS" } : current);
        setData((current) => current ? { ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, status: "IN_PROGRESS" } : task) } : current);
      }
    } catch {
      notify("Không thể bắt đầu nhiệm vụ. Hãy thử lại.", true);
    } finally {
      startPendingRef.current = false;
      setStarting(false);
    }
  }
  function selectScannedTask(taskSummary: TaskSummary) {
    const task = taskSummary as Task;
    setData((current) => current ? { ...current, tasks: [...current.tasks.filter((item) => item.id !== task.id), task] } : current);
    setTab("tasks");
    void openTask(task);
  }
  const nav = [{ id: "overview", label: "Tổng quan", icon: Store }, { id: "tasks", label: "Nhiệm vụ", icon: ClipboardList }, { id: "history", label: "Lịch sử", icon: History }] as const;

  return (
    <main className="app-shell">
      <aside className="sidebar"><Logo inverse /><div className="store-selector"><label>Cửa hàng làm việc</label><select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{data?.stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div><nav className="side-nav">{nav.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon /><span className="nav-label">{label}</span>{id === "tasks" && <span className="count" aria-label={`${activeTasks.length} nhiệm vụ đang mở`}>{activeTasks.length}</span>}</button>)}<button className={tab === "scanner" ? "active" : ""} onClick={() => setTab("scanner")}><ScanLine /><span className="nav-label">Quét ESL</span></button></nav><div className="user-card"><span className="user-avatar">{user.name?.split(" ").slice(-2).map((v) => v[0]).join("")}</span><span><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></span><button onClick={() => signOut({ callbackUrl: "/" })} aria-label="Đăng xuất"><LogOut /></button></div></aside>
      <section className="workspace">
        <header className="workspace-header"><div><span className="section-label">{new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span><h1>Chào buổi sáng, {user.name?.split(" ").at(-1)} 👋</h1><p>{data?.stores.find((store) => store.id === storeId)?.address}</p></div><div className="header-actions"><span className={`connection-pill ${online ? "" : "offline"}`}>{online ? <Wifi /> : <WifiOff />}{online ? "Đã đồng bộ" : `Offline · ${queueCount} chờ`}</span><StaffNotificationCenter key={storeId} storeId={storeId} notifications={data?.selectedStoreId === storeId ? data.notifications : []} onRead={markNotificationsRead} /><button className="icon-button" onClick={() => load()} aria-label="Tải lại"><RefreshCw className={loading ? "spin" : ""} /></button><button className="icon-button mobile-logout" onClick={() => signOut({ callbackUrl: "/" })} aria-label="Đăng xuất"><LogOut /></button></div></header>
        {data && <div className="metric-grid"><Metric icon={ClipboardList} label="Nhiệm vụ mở" value={data.metrics.openTasks} helper={`${data.metrics.highPriority} khẩn cấp`} /><Metric icon={AlertTriangle} label="Kệ sắp hết" value={data.metrics.lowShelves} helper="Theo dữ liệu POS" alert /><Metric icon={CalendarClock} label="FEFO hôm nay" value={data.metrics.fefoTasks} helper="Nhãn/cách ly" /><Metric icon={CheckCircle2} label="Hoàn thành" value={`${data.metrics.completionRate}%`} helper="Trong ca hiện tại" /></div>}
        {tab === "overview" && <div className="dashboard-grid"><section className="panel"><PanelTitle title="Nhiệm vụ ưu tiên" /><div className="task-list">{activeTasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} managerOversight={managerOversight} onClick={() => openTask(task)} />)}{!activeTasks.length && <div className="empty-state">Bạn đã xử lý hết nhiệm vụ đang mở.</div>}</div></section><section className="panel"><PanelTitle title="Tình trạng kệ" /><div className="stock-list">{data?.inventories.slice(0, 6).map((item) => <div className="stock-row" key={item.id}><div className="stock-head"><strong>{item.product.name}</strong><span>{item.onShelf}/{item.capacity}</span></div><div className="stock-bar"><i className={item.onShelf <= item.lowThreshold ? "low" : ""} style={{ width: `${Math.min(100, item.onShelf / item.capacity * 100)}%` }} /></div></div>)}</div></section></div>}
        {tab === "tasks" && <section className="panel"><PanelTitle title="Tất cả nhiệm vụ" /><div className="filter-row">{[["ACTIVE","Đang mở"],["RESTOCK","Bổ sung"],["FEFO","FEFO"],["QUARANTINE","Cách ly"],["COMPLETED","Hoàn thành"]].map(([id,label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}</button>)}</div><div className="task-list">{visibleTasks.map((task) => <TaskRow key={task.id} task={task} managerOversight={managerOversight} onClick={() => openTask(task)} />)}{!visibleTasks.length && <div className="empty-state">Không có nhiệm vụ phù hợp bộ lọc.</div>}</div></section>}
        {tab === "history" && <section className="panel"><PanelTitle title="Hoạt động gần đây" /><div className="log-list">{data?.recentEvents.map((event) => <div className="log-row" key={event.id}><code>{event.type}</code><span><strong>{event.task.product.name}</strong><br />{event.note || event.task.shelf.label}</span><time>{time(event.createdAt)}</time></div>)}</div></section>}
      </section>
      {tab === "scanner" && storeId && <EslScannerModal storeId={storeId} onSelectTask={selectScannedTask} onClose={() => setTab("overview")} />}
      {selected && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}><section className="modal staff-task-modal"><button className="icon-button modal-close" onClick={() => setSelected(null)} aria-label="Đóng nhiệm vụ"><X /></button><header className="modal-head"><span className="section-label">{selected.type} · {selected.priority}</span><h2>{selected.title}</h2><p>{selected.note}</p></header><div className="modal-body"><div className="product-summary"><span>{selected.product.emoji}</span><span><small>{selected.shelf.label}</small><strong>{selected.product.name}</strong><small>{selected.shelf.code}</small></span><TaskStatusBadge status={selected.status} /></div>{managerOversight && <div className="alert-box">Chế độ chỉ xem. Quản lý không thể bắt đầu hoặc hoàn thành nhiệm vụ.</div>}{selected.type === "RESTOCK" ? <><div className="detail-grid"><div className="detail-box"><span>Tồn trên kệ</span><strong>{selected.inventory?.onShelf}/{selected.inventory?.capacity}</strong></div><div className="detail-box"><span>Tồn kho sau</span><strong>{selected.inventory?.backroom}</strong></div></div>{!managerOversight && <><div className="esl-verification"><BarcodeScanner onDetected={(value) => { setScanCode(value); setScanned(false); }} label="Quét mã ESL" /><div className="manual-scan-label"><span>Hoặc nhập mã thiết bị</span><small>Mã được in ở cạnh dưới của nhãn điện tử</small></div><div className="manual-scan"><input className="form-control" value={scanCode} onChange={(e) => { setScanCode(e.target.value); setScanned(false); }} placeholder="Ví dụ: ESL-NT-Q5-L-02" aria-label="Mã ESL" /><button className="button" onClick={verifyEsl}>Xác minh</button></div>{scanned && <div className="alert-box scan-success">✓ ESL khớp đúng sản phẩm và vị trí kệ.</div>}</div><label className="muted quantity-label">Số lượng bổ sung<div className="number-control"><button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Giảm số lượng">−</button><input className="form-control" type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /><button onClick={() => setQuantity(quantity + 1)} aria-label="Tăng số lượng">+</button></div></label></>}</> : <><div className="detail-grid"><div className="detail-box"><span>Mã lô</span><strong>{selected.lot?.batchCode}</strong></div><div className="detail-box"><span>Hạn sử dụng</span><strong>{selected.lot && new Intl.DateTimeFormat("vi-VN").format(new Date(selected.lot.expiryDate))}</strong></div><div className="detail-box"><span>Nhà cung cấp</span><strong>{selected.lot?.supplier.name}</strong></div><div className="detail-box"><span>Xuất xứ</span><strong>{selected.lot?.origin}</strong></div></div>{!managerOversight && <div className={`alert-box ${selected.type === "QUARANTINE" ? "danger" : ""}`}>{selected.type === "QUARANTINE" ? "Lô đã hết hạn. Di chuyển khỏi khu vực bán và xác nhận cách ly." : "Kiểm tra đúng lô, dán nhãn giảm giá và ưu tiên bán trước."}</div>}</>}</div>{!managerOversight && <footer className="modal-actions"><button className="button" onClick={() => setSelected(null)}>Để sau</button>{user.role === "STAFF" && ["OPEN", "BLOCKED"].includes(selected.status) && <button className="button primary" onClick={startSelectedTask} disabled={starting}>{starting ? "Đang bắt đầu…" : "Bắt đầu"}</button>}<button className="button primary" onClick={completeTask} disabled={starting}>{selected.type === "RESTOCK" ? "Xác nhận bổ sung" : selected.type === "QUARANTINE" ? "Xác nhận cách ly" : "Xác nhận đã dán nhãn"}</button></footer>}</section></div>}
      {toast && <div className="toast-stack"><div className={`toast ${toast.error ? "error" : ""}`}><strong>{toast.error ? "Có lỗi" : "Đã cập nhật"}</strong>{toast.message}</div></div>}
    </main>
  );
}

function Metric({ icon: Icon, label, value, helper, alert }: { icon: typeof Store; label: string; value: string | number; helper: string; alert?: boolean }) { return <article className={`metric ${alert ? "alert" : ""}`}><span className="metric-icon"><Icon /></span><span><small>{label}</small><strong>{value}</strong><small>{helper}</small></span></article>; }
function PanelTitle({ title }: { title: string }) { return <header className="panel-header"><h2>{title}</h2></header>; }
function TaskRow({ task, onClick, managerOversight }: { task: Task; onClick(): void; managerOversight: boolean }) { const Icon = task.type === "RESTOCK" ? PackagePlus : task.type === "QUARANTINE" ? AlertTriangle : Clock3; return <button className="task-row" onClick={onClick}><span className={`task-icon ${task.type !== "RESTOCK" ? "fefo" : ""} ${task.priority === "HIGH" ? "high" : ""}`}><Icon /></span><span className="task-copy"><strong>{task.title}</strong><span>{task.product.name} · {task.shelf.label}{managerOversight && ` · ${task.assignee?.name || "Chưa nhận"}`}</span></span><span className="task-meta"><TaskStatusBadge status={task.status} /><span className={`badge ${task.priority.toLowerCase()}`}>{task.priority}</span><time>{time(task.status === "COMPLETED" && task.completedAt ? task.completedAt : task.createdAt)}</time></span></button>; }
