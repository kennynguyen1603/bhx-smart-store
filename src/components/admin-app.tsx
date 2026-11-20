"use client";

import { Activity, ArrowRight, Ban, ClipboardList, Boxes, Database, EyeOff, LayoutGrid, Link2Off, LoaderCircle, Lock, LogOut, MapPin, PackageSearch, PackageX, Pencil, Plus, RefreshCw, Settings2, ShieldCheck, Store, Trash2, Users, X } from "lucide-react";
import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StaffNotificationCenter, type StaffNotification } from "@/components/staff-notification-center";
import { TaskForm, type TaskReferences } from "@/components/admin/forms/task-form";
import { AdminTaskPanel, type AdminTask } from "@/components/admin/admin-task-panel";
import { StoreForm } from "@/components/admin/forms/store-form";
import { InventoryForm } from "@/components/admin/forms/inventory-form";
import { ProductForm } from "@/components/admin/forms/product-form";
import { SupplierForm } from "@/components/admin/forms/supplier-form";
import { LotForm } from "@/components/admin/forms/lot-form";
import { ZoneForm } from "@/components/admin/forms/zone-form";
import { ShelfForm } from "@/components/admin/forms/shelf-form";
import { EslForm } from "@/components/admin/forms/esl-form";
import { FefoRuleForm } from "@/components/admin/forms/fefo-rule-form";
import { UserForm } from "@/components/admin/forms/user-form";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { AdminMapEditor } from "@/components/admin/admin-map-editor";
import type { AdminConfirmDescriptor, AdminDialogDescriptor, ApiMutationResult } from "@/components/admin/admin-types";
import { toast, Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/logo";
import { ROLE_LABELS } from "@/lib/demo-roles";
import { useStoreChangePolling } from "@/lib/use-store-change-polling";
import { formatVnd } from "@/lib/normalize";

type StoreData = { id: string; code: string; name: string; address: string; mapWidth: number; mapHeight: number; active: boolean; zones: { id: string; name: string; color: string; x: number; y: number; width: number; height: number }[]; shelves: Shelf[]; kiosks: { id: string; name: string; x: number; y: number }[] };
type Esl = { id: string; code: string; storeId: string; shelfId: string; productId: string; ledOn: boolean; product: { name: string } };
type Shelf = { id: string; storeId: string; zoneId: string | null; code: string; label: string; x: number; y: number; width: number; height: number; zone: { name: string } | null; esls: Esl[] };
type Product = { id: string; sku: string; barcode: string; name: string; category: string; unit: string; basePriceVnd: number; emoji: string; active: boolean };
type Inventory = { id: string; onShelf: number; backroom: number; capacity: number; lowThreshold: number; version: number; product: Product; shelf: Shelf; store: { name: string } };
type Overview = { notifications: StaffNotification[]; tasks: AdminTask[]; taskReferences: TaskReferences; generatedAt: string; selectedStoreId: string; stores: StoreData[]; users: { id: string; name: string; email: string; role: "STAFF" | "MANAGER" | "ADMIN"; active: boolean; userStores: { storeId: string; isDefault: boolean; store: { id: string; name: string } }[] }[]; products: Product[]; suppliers: { id: string; code: string; name: string; country: string; certificate: string | null; active: boolean }[]; lots: { id: string; storeId: string; productId: string; supplierId: string; receivedAt: string; batchCode: string; origin: string; expiryDate: string; quantity: number; status: string; markdownPercent: number | null; product: Product; supplier: { name: string }; store: { name: string } }[]; inventories: Inventory[]; integrations: { id: string; externalEventId: string; type: string; status: string; error: string | null; createdAt: string }[]; audits: { id: string; action: string; entityType: string; actor: { name: string } | null; createdAt: string }[]; rules: { id: string; storeId: string; daysRemaining: number; discountPercent: number; quarantine: boolean; active: boolean }[] };
const resources = { store: "stores", inventory: "inventories", product: "products", supplier: "suppliers", lot: "lots", zone: "zones", shelf: "shelves", esl: "esls", "fefo-rule": "fefo-rules", user: "users", task: "tasks" } as const;
const destructiveActions = {
  store: { action: "deactivate", title: "Vô hiệu hoá cửa hàng", description: "Cửa hàng sẽ ngừng hoạt động.", confirmLabel: "Vô hiệu hoá" },
  product: { action: "hide", title: "Ẩn sản phẩm", description: "Sản phẩm sẽ ngừng hiển thị.", confirmLabel: "Ẩn sản phẩm" },
  supplier: { action: "deactivate", title: "Vô hiệu hoá nhà cung cấp", description: "Nhà cung cấp sẽ ngừng hoạt động.", confirmLabel: "Vô hiệu hoá" },
  lot: { action: "close", title: "Đóng lô hàng", description: "Số lượng lô sẽ về 0 và trạng thái chuyển thành đã hết.", confirmLabel: "Đóng lô" },
  zone: { action: "delete", title: "Xoá khu vực", description: "Khu vực sẽ bị xoá khỏi sơ đồ cửa hàng.", confirmLabel: "Xoá khu vực" },
  shelf: { action: "delete", title: "Xoá kệ", description: "Chỉ có thể xoá kệ trống. Hãy di chuyển hoặc xoá các dữ liệu phụ thuộc trước.", confirmLabel: "Xoá kệ" },
  esl: { action: "detach", title: "Gỡ ESL khỏi kệ", description: "Liên kết thiết bị ESL với kệ và sản phẩm sẽ bị xoá.", confirmLabel: "Gỡ ESL" },
  "fefo-rule": { action: "delete", title: "Xoá quy tắc FEFO", description: "Quy tắc giảm giá hoặc cách ly này sẽ bị xoá.", confirmLabel: "Xoá quy tắc" },
  user: { action: "lock", title: "Khoá tài khoản", description: "Tài khoản sẽ bị vô hiệu hoá và không thể đăng nhập.", confirmLabel: "Khoá tài khoản" },
} as const satisfies Record<Exclude<AdminDialogDescriptor["kind"], "inventory" | "task">, Omit<AdminConfirmDescriptor, "kind" | "id">>;
type Tab = "tasks" | "overview" | "inventory" | "catalog" | "map" | "fefo" | "users" | "integrations";
type OverviewView = "inventory" | "integrations";
type CatalogView = "products" | "lots" | "suppliers";
type SubTab<T extends string> = { id: T; label: string; short?: string };
const OVERVIEW_VIEWS: SubTab<OverviewView>[] = [{ id: "inventory", label: "Tồn kho gần đây", short: "Tồn kho" }, { id: "integrations", label: "Luồng tích hợp", short: "Tích hợp" }];
const CATALOG_VIEWS: SubTab<CatalogView>[] = [{ id: "products", label: "Sản phẩm" }, { id: "lots", label: "Lô hàng" }, { id: "suppliers", label: "Nhà cung cấp", short: "NCC" }];
type IntegrationMode = "POS" | "WMS" | "SUPPLIER" | "FEFO";
const ADMIN_REQUEST_TIMEOUT_MS = 10_000;
type TaskOverview = Overview & { focusedTask?: AdminTask | null };

class AdminRequestTimeoutError extends Error {}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, controller: AbortController) {
  let timeout = 0;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = window.setTimeout(() => {
      controller.abort();
      reject(new AdminRequestTimeoutError());
    }, ADMIN_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetch(input, { ...init, signal: controller.signal }), timeoutPromise]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function AdminApp({ user, initialStoreId, initialTaskId }: { user: Session["user"]; initialStoreId?: string; initialTaskId?: string }) {
  const [data, setData] = useState<TaskOverview | null>(null);
  const [storeId, setStoreId] = useState(initialStoreId || user.defaultStoreId || "");
  const [tab, setTab] = useState<Tab>(initialTaskId ? "tasks" : "overview");
  const [overviewView, setOverviewView] = useState<OverviewView>("inventory");
  const [catalogView, setCatalogView] = useState<CatalogView>("products");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<AdminDialogDescriptor | null>(null);
  const [confirmation, setConfirmation] = useState<AdminConfirmDescriptor | null>(null);
  const [integrationPending, setIntegrationPending] = useState<IntegrationMode | null>(null);
  const integrationPendingLock = useRef<IntegrationMode | null>(null);
  const integrationGeneration = useRef(0);
  const integrationOperationIds = useRef<Partial<Record<IntegrationMode, string>>>({});
  const requestControllers = useRef(new Set<AbortController>());
  const mountedRef = useRef(true);
  const loadGenerationRef = useRef(0);
  const loadStoreIdRef = useRef<string | null>(storeId);
  const activeLoadRef = useRef<{ controller: AbortController; promise: Promise<boolean>; followup?: Promise<boolean> } | null>(null);
  const readPendingRef = useRef<{ storeId: string; previous: StaffNotification[]; readAt: string } | null>(null);
  const readVersionsRef = useRef(new Map<string, number>());
  const confirmedReadsRef = useRef(new Map<string, Map<string, string>>());
  const canAdmin = user.role === "ADMIN";
  const notify = useCallback((message: string, error = false) => { if (error) toast.error(message); else toast.success(message); }, []);
  const load = useCallback(async function loadStore(afterWrite = false, refreshAfterPending = false, requireVisible = false): Promise<boolean> {
    if (storeId !== loadStoreIdRef.current || (requireVisible && document.visibilityState !== "visible")) return false;
    const generation = loadGenerationRef.current;
    const readVersion = readVersionsRef.current.get(storeId) || 0;
    const active = activeLoadRef.current;
    if (active) {
      if (!afterWrite && !refreshAfterPending) return active.promise;
      active.followup ??= active.promise.then(() => generation === loadGenerationRef.current ? loadStore(afterWrite, false, requireVisible) : false);
      return active.followup;
    }
    if (mountedRef.current) setLoading(true);
    const controller = new AbortController();
    const isCurrent = () => mountedRef.current && !controller.signal.aborted && generation === loadGenerationRef.current;
    requestControllers.current.add(controller);
    const promise = (async () => {
      try {
        const query = new URLSearchParams({ ...(storeId ? { storeId } : {}), ...(initialTaskId ? { taskId: initialTaskId } : {}) });
        const response = await fetchWithTimeout(`/api/admin/overview${query.size ? `?${query}` : ""}`, { cache: "no-store" }, controller);
        if (!response.ok) throw new Error("Overview refresh failed");
        const result: TaskOverview = await response.json();
        if (!isCurrent() || readVersion !== (readVersionsRef.current.get(storeId) || 0)) return false;
        const confirmed = confirmedReadsRef.current.get(result.selectedStoreId);
        const pending = readPendingRef.current?.storeId === result.selectedStoreId ? readPendingRef.current : null;
        const pendingIds = new Set(pending?.previous.map(item => item.id));
        result.notifications = (result.notifications || []).map(item => {
          const readAt = confirmed?.get(item.id) || (pendingIds.has(item.id) ? pending?.readAt : null);
          return !item.readAt && readAt ? { ...item, readAt } : item;
        });
        setData(result);
        if (!storeId && result.selectedStoreId) setStoreId(result.selectedStoreId);
        return true;
      } catch (error) {
        if (mountedRef.current && generation === loadGenerationRef.current && (!controller.signal.aborted || error instanceof AdminRequestTimeoutError)) notify(afterWrite
          ? error instanceof AdminRequestTimeoutError ? "Đã lưu thay đổi nhưng quá thời gian tải lại dữ liệu. Vui lòng tải lại dữ liệu." : "Đã lưu thay đổi nhưng không thể tải lại dữ liệu. Vui lòng tải lại dữ liệu."
          : error instanceof AdminRequestTimeoutError ? "Quá thời gian tải dữ liệu quản trị. Vui lòng thử lại." : "Không thể tải dữ liệu quản trị. Vui lòng thử lại.", true);
        return false;
      } finally {
        requestControllers.current.delete(controller);
        if (mountedRef.current && generation === loadGenerationRef.current) setLoading(false);
        if (activeLoadRef.current?.controller === controller) activeLoadRef.current = null;
      }
    })();
    activeLoadRef.current = { controller, promise };
    return promise;
  }, [storeId, notify, initialTaskId]);
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
    if (!await load(false, true, true)) throw new Error("Store refresh was not acknowledged");
  } });
  useEffect(() => {
    mountedRef.current = true;
    const controllers = requestControllers.current;
    return () => {
      mountedRef.current = false;
      integrationGeneration.current += 1;
      integrationPendingLock.current = null;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);
  const store = data?.stores.find((item) => item.id === storeId) || data?.stores[0];
  const tasks = data?.focusedTask && !data.tasks.some(task => task.id === data.focusedTask!.id) ? [data.focusedTask, ...data.tasks] : data?.tasks || [];
  const lowCount = data?.inventories.filter((item) => item.onShelf <= item.lowThreshold).length || 0;
  const referenceTime = data ? new Date(data.generatedAt).getTime() : 0;
  const expiring = data?.lots.filter((lot) => (new Date(lot.expiryDate).getTime() - referenceTime) / 86400000 <= 3).length || 0;

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
      // Invalidate responses that started before the confirmed read.
      readVersionsRef.current.set(storeId, (readVersionsRef.current.get(storeId) || 0) + 1);
      setData((current) => current?.selectedStoreId === storeId ? {
        ...current, notifications: current.notifications.map((item) => displayedIds.has(item.id) && item.readAt === readAt ? { ...item, readAt: result.readAt } : item),
      } : current);
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

  async function api(url: string, method: string, body?: unknown, feedback: "toast" | "dialog" = "toast"): Promise<ApiMutationResult> {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      const message = "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại.";
      if (feedback === "toast") notify(message, true);
      return { ok: false, message };
    }
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const message = result?.error?.message || "Cập nhật thất bại";
      if (feedback === "toast") notify(message, true);
      return { ok: false, message };
    }
    notify("Đã cập nhật dữ liệu.");
    // Dialog forms close on the confirmed write; refresh feedback has its own lifecycle.
    // Other callers still await refresh (including the simulator's pending span).
    if (feedback === "dialog") void load(true);
    else await load(true);
    return { ok: true, data: result };
  }
  function editInventory(item: Inventory) {
    setDialog({ kind: "inventory", mode: "edit", id: item.id, defaultValues: { onShelf: item.onShelf, backroom: item.backroom, capacity: item.capacity, lowThreshold: item.lowThreshold } });
  }
  function closeDialog(open: boolean) { if (!open) setDialog(null); }
  function submitEntity(body: unknown) {
    if (!dialog) return Promise.resolve<ApiMutationResult>({ ok: false, message: "Không tìm thấy biểu mẫu." });
    const resource = resources[dialog.kind];
    return api(`/api/admin/${resource}${dialog.mode === "edit" ? `/${dialog.id}` : ""}`, dialog.mode === "edit" ? "PUT" : "POST", body, "dialog");
  }
  async function simulate(mode: IntegrationMode) {
    if (integrationPendingLock.current) return;
    const inventory = data?.inventories[0];
    if (mode !== "FEFO" && !inventory) return;
    const generation = ++integrationGeneration.current;
    const operationId = integrationOperationIds.current[mode] || crypto.randomUUID();
    integrationOperationIds.current[mode] = operationId;
    integrationPendingLock.current = mode;
    setIntegrationPending(mode);
    const controller = new AbortController();
    requestControllers.current.add(controller);
    try {
      const response = await fetchWithTimeout("/api/admin/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, inventoryId: inventory?.id, quantity: mode === "POS" ? 2 : 10, operationId }) }, controller);
      const result = await response.json().catch(() => null);
      if (generation !== integrationGeneration.current || !mountedRef.current) return;
      if (!response.ok) {
        const inProgress = result?.error?.code === "OPERATION_IN_PROGRESS";
        if (!inProgress) delete integrationOperationIds.current[mode];
        notify(result?.error?.message || "Mô phỏng thất bại", true);
        return;
      }
      delete integrationOperationIds.current[mode];
      notify("Đã cập nhật dữ liệu.");
      await load(true);
    } catch (error) {
      if (generation === integrationGeneration.current && mountedRef.current) notify(error instanceof AdminRequestTimeoutError
        ? "Không xác định được kết quả mô phỏng do quá thời gian. Hãy thử lại để kiểm tra cùng thao tác."
        : "Không thể kết nối đến máy chủ. Không xác định được kết quả mô phỏng; hãy thử lại để kiểm tra cùng thao tác.", true);
    } finally {
      requestControllers.current.delete(controller);
      if (generation === integrationGeneration.current) {
        integrationPendingLock.current = null;
        if (mountedRef.current) setIntegrationPending(null);
      }
    }
  }
  function createStore() { setDialog({ kind: "store", mode: "create", defaultValues: {} }); }
  function editStore() {
    if (!store) return;
    setDialog({ kind: "store", mode: "edit", id: store.id, readOnlyValues: { code: store.code }, defaultValues: { name: store.name, address: store.address, mapWidth: store.mapWidth, mapHeight: store.mapHeight, active: store.active } });
  }
  function editProduct(product: Product) {
    setDialog({ kind: "product", mode: "edit", id: product.id, readOnlyValues: { sku: product.sku, barcode: product.barcode }, defaultValues: { name: product.name, category: product.category, unit: product.unit, basePriceVnd: product.basePriceVnd, emoji: product.emoji } });
  }
  function createSupplier() { setDialog({ kind: "supplier", mode: "create", defaultValues: {} }); }
  function editSupplier(supplier: Overview["suppliers"][number]) {
    setDialog({ kind: "supplier", mode: "edit", id: supplier.id, readOnlyValues: { code: supplier.code }, defaultValues: { name: supplier.name, country: supplier.country, certificate: supplier.certificate, active: supplier.active } });
  }
  function createLot() {
    if (store && data?.products.length && data.suppliers.length) setDialog({ kind: "lot", mode: "create", defaultValues: { storeId: store.id } });
  }
  function editLot(lot: Overview["lots"][number]) {
    setDialog({ kind: "lot", mode: "edit", id: lot.id, readOnlyValues: { storeId: lot.storeId, productId: lot.productId, supplierId: lot.supplierId, batchCode: lot.batchCode, receivedAt: lot.receivedAt }, defaultValues: { origin: lot.origin, expiryDate: lot.expiryDate.slice(0, 10), quantity: lot.quantity } });
  }
  function createZone() { if (store) setDialog({ kind: "zone", mode: "create", defaultValues: { storeId: store.id } }); }
  function editZone(zone: StoreData["zones"][number]) {
    if (store) setDialog({ kind: "zone", mode: "edit", id: zone.id, readOnlyValues: { storeId: store.id }, defaultValues: { name: zone.name, color: zone.color, x: zone.x, y: zone.y, width: zone.width, height: zone.height } });
  }
  function createShelf() { if (store) setDialog({ kind: "shelf", mode: "create", defaultValues: { storeId: store.id } }); }
  function editShelf(shelf: Shelf) {
    setDialog({ kind: "shelf", mode: "edit", id: shelf.id, readOnlyValues: { storeId: shelf.storeId, code: shelf.code }, defaultValues: { label: shelf.label, zoneId: shelf.zoneId, x: shelf.x, y: shelf.y, width: shelf.width, height: shelf.height } });
  }
  function createEsl() {
    if (store?.shelves.length && data?.products.length) setDialog({ kind: "esl", mode: "create", defaultValues: { storeId: store.id } });
  }
  function editEsl(esl: Esl) {
    setDialog({ kind: "esl", mode: "edit", id: esl.id, readOnlyValues: { code: esl.code, storeId: esl.storeId }, defaultValues: { shelfId: esl.shelfId, productId: esl.productId, ledOn: esl.ledOn } });
  }
  function createRule() { if (store) setDialog({ kind: "fefo-rule", mode: "create", defaultValues: { storeId: store.id } }); }
  function editRule(rule: Overview["rules"][number]) {
    setDialog({ kind: "fefo-rule", mode: "edit", id: rule.id, readOnlyValues: { storeId: rule.storeId }, defaultValues: { daysRemaining: rule.daysRemaining, discountPercent: rule.discountPercent, quarantine: rule.quarantine, active: rule.active } });
  }
  function editUser(account: Overview["users"][number]) {
    const memberships = account.userStores;
    const ordered = [...memberships.filter(item => item.isDefault), ...memberships.filter(item => !item.isDefault)];
    setDialog({ kind: "user", mode: "edit", id: account.id, readOnlyValues: { email: account.email }, defaultValues: { name: account.name, role: account.role, active: account.active, password: "", storeIds: ordered.map(item => item.storeId) } });
  }
  function requestRemoval(kind: keyof typeof destructiveActions, id: string, name: string) {
    const copy = destructiveActions[kind];
    setConfirmation({ kind, id, ...copy, description: `${name}: ${copy.description}` });
  }
  async function submitRemoval() {
    if (!confirmation) return false;
    const result = await api(`/api/admin/${resources[confirmation.kind]}/${confirmation.id}`, "DELETE", undefined, "dialog");
    return result.ok ? true : { ok: false as const, error: result.message };
  }
  const nav = [{ id:"overview",label:"Tổng quan",icon:LayoutGrid },{ id:"tasks",label:"Nhiệm vụ",icon:ClipboardList },{ id:"inventory",label:"Tồn kho",icon:Boxes },{ id:"catalog",label:"Danh mục",icon:PackageSearch },{ id:"map",label:"Sơ đồ & ESL",icon:Store },{ id:"fefo",label:"FEFO",icon:Settings2 },{ id:"users",label:"Người dùng",icon:Users },{ id:"integrations",label:"Tích hợp",icon:Database }] as const;
  return <main className="app-shell admin-shell"><aside className="sidebar"><Logo inverse /><div className="store-selector"><label>Cửa hàng quản trị</label><select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{data?.stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><nav className="side-nav">{nav.map(({id,label,icon:Icon}) => <button key={id} className={tab===id?"active":""} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav><div className="user-card"><span className="user-avatar">AD</span><span title={user.name ?? undefined}><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></span><button className="admin-logout" aria-label="Đăng xuất" title="Đăng xuất" onClick={() => signOut({callbackUrl:"/admin/login"})}><LogOut aria-hidden="true"/><span className="sr-only">Đăng xuất</span></button></div></aside><section className="workspace"><header className="workspace-header"><div className="workspace-title"><h1>{nav.find((item)=>item.id===tab)?.label}</h1><p className="workspace-meta">{store?.code&&<span className="section-label">{store.code}</span>}{store?.address&&<span className="meta-item meta-address"><MapPin aria-hidden="true"/>{store.address}</span>}</p></div><div className="header-actions" role="toolbar" aria-label="Thao tác nhanh"><StaffNotificationCenter key={storeId} storeId={storeId} notifications={data?.selectedStoreId === storeId ? data.notifications : []} onRead={markNotificationsRead} /><button className="icon-button" aria-label="Tải lại dữ liệu" data-admin-dialog-fallback disabled={loading} onClick={() => void load()}><RefreshCw className={loading?"spin":""}/></button><button className="icon-button mobile-logout" aria-label="Đăng xuất" onClick={() => signOut({callbackUrl:"/admin/login"})}><LogOut /><span>Đăng xuất</span></button></div></header>
  {tab==="overview"&&<><div className="metric-grid"><AdminMetric icon={Store} label="Cửa hàng" value={data?.stores.length||0}/><AdminMetric icon={Boxes} label="SKU tại cửa hàng" value={data?.inventories.length||0}/><AdminMetric icon={Activity} label="Kệ sắp hết" value={lowCount} alert={lowCount>0}/><AdminMetric icon={ShieldCheck} label="Lô cần FEFO" value={expiring}/></div>{canAdmin&&<div className="store-toolbar" role="group" aria-label="Quản lý cửa hàng"><button className="button" aria-label="Thêm cửa hàng" onClick={createStore}><Plus aria-hidden="true"/><span>Thêm<span className="label-suffix"> cửa hàng</span></span></button><button className="button" aria-label="Sửa cửa hàng" disabled={!store} onClick={editStore}><Pencil aria-hidden="true"/><span>Sửa<span className="label-suffix"> cửa hàng</span></span></button>{store&&<button className="button danger" onClick={()=>requestRemoval("store",store.id,store.name)}><Ban aria-hidden="true"/>Vô hiệu hoá</button>}</div>}<section className="panel"><TabbedPanel<OverviewView> id="overview-view" label="Dữ liệu gần đây" items={OVERVIEW_VIEWS} value={overviewView} onChange={setOverviewView} actions={<button className="button view-all" aria-label="Xem tất cả" title={overviewView==="inventory"?"Xem tất cả tồn kho":"Xem tất cả luồng tích hợp"} onClick={()=>setTab(overviewView)}><span className="view-all-label">Xem tất cả</span><ArrowRight aria-hidden="true"/></button>}>{overviewView==="inventory"?<InventoryTable items={data?.inventories.slice(0,6)||[]} onEdit={editInventory}/>:<div className="log-list">{data?.integrations.slice(0,8).map((event)=><div className="log-row" key={event.id}><code>{event.type}</code><span className="log-main">{event.externalEventId}</span><span className={`badge ${event.status==="PROCESSED"?"open":"blocked"}`}>{event.status}</span></div>)}</div>}</TabbedPanel></section></>}
  {tab==="tasks"&&<AdminTaskPanel key={store?.id || "no-store"} selectedTaskId={initialTaskId} tasks={tasks} assignees={data?.taskReferences?.assignees || []} canCreate={Boolean(store && data?.taskReferences?.products.length)} onCreate={() => { if (store) setDialog({ kind: "task", mode: "create", defaultValues: { storeId: store.id } }); }} />}
  {tab==="inventory"&&<section className="panel"><Panel title="Tồn kệ và kho sau"/><InventoryTable items={data?.inventories||[]} onEdit={editInventory}/></section>}
  {tab==="catalog"&&<section className="panel"><TabbedPanel<CatalogView> id="catalog-view" label="Danh mục" wide items={CATALOG_VIEWS} value={catalogView} onChange={setCatalogView} actions={canAdmin&&(catalogView==="products"?<button className="button" onClick={() => setDialog({ kind: "product", mode: "create", defaultValues: {} })}><Plus/>Thêm sản phẩm</button>:catalogView==="lots"?<button className="button" disabled={!store || !data?.products.length || !data?.suppliers.length} onClick={createLot}><Plus/>Thêm lô</button>:<button className="button" onClick={createSupplier}><Plus/>Thêm nhà cung cấp</button>)}>{catalogView==="products"&&<div className="table-scroll"><table className="data-table"><thead><tr><th>SKU</th><th>Sản phẩm</th><th>Giá</th><th>Trạng thái</th><th></th></tr></thead><tbody>{data?.products.map((product)=><tr key={product.id}><td><code title={product.sku}>{product.sku}</code></td><td className="cell-main">{product.emoji} {product.name}<br/><small>{product.category}</small></td><td data-label="Giá">{formatVnd(product.basePriceVnd)}</td><td data-label="Trạng thái"><span className={`badge ${product.active?"open":"completed"}`}>{product.active?"Active":"Ẩn"}</span></td><td className="cell-actions">{canAdmin&&<span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa sản phẩm" onClick={()=>editProduct(product)}><Pencil aria-hidden="true"/></button><button type="button" className="button danger icon-action" aria-label="Ẩn" title="Ẩn sản phẩm" onClick={()=>requestRemoval("product",product.id,product.name)}><EyeOff aria-hidden="true"/></button></span>}</td></tr>)}</tbody></table></div>}{catalogView==="lots"&&<>{canAdmin&&(!store || !data?.products.length || !data?.suppliers.length)&&<p className="panel-description sub-tab-note">Cần cửa hàng, sản phẩm và nhà cung cấp để thêm lô.</p>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Lô</th><th>Sản phẩm</th><th>Nhà cung cấp</th><th>HSD</th><th></th></tr></thead><tbody>{data?.lots.map((lot)=><tr key={lot.id}><td><code title={lot.batchCode}>{lot.batchCode}</code></td><td className="cell-main">{lot.product.name}</td><td data-label="Nhà cung cấp">{lot.supplier.name}<br/><small>{lot.origin}</small></td><td data-label="HSD">{new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}<br/><span className={`badge ${lot.status==="QUARANTINED"?"blocked":"open"}`}>{lot.status}</span></td><td className="cell-actions">{canAdmin&&<span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa lô hàng" onClick={()=>editLot(lot)}><Pencil aria-hidden="true"/></button><button type="button" className="button danger icon-action" aria-label="Đóng" title="Đóng lô hàng" onClick={()=>requestRemoval("lot",lot.id,lot.batchCode)}><PackageX aria-hidden="true"/></button></span>}</td></tr>)}</tbody></table></div></>}{catalogView==="suppliers"&&<div className="log-list supplier-list">{data?.suppliers.map((supplier)=><div className="log-row" key={supplier.id}><code title={supplier.code}>{supplier.code}</code><span className="log-main"><strong>{supplier.name}</strong><small>{[supplier.country,supplier.certificate].filter(Boolean).join(" · ")}</small></span>{canAdmin&&<span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa nhà cung cấp" onClick={()=>editSupplier(supplier)}><Pencil aria-hidden="true"/></button><button type="button" className="button danger icon-action" aria-label="Ẩn" title="Ẩn nhà cung cấp" onClick={()=>requestRemoval("supplier",supplier.id,supplier.name)}><EyeOff aria-hidden="true"/></button></span>}</div>)}</div>}</TabbedPanel></section>}
  {tab==="map"&&!store&&<section className="panel map-panel"><Panel title="Sơ đồ cửa hàng" description="Cần cửa hàng để quản lý sơ đồ và ESL." actions={<><button className="button" disabled>Thêm zone</button><button className="button" disabled>Thêm kệ</button><button className="button" disabled>Gắn ESL</button></>}/></section>}
  {tab==="map"&&store&&<div className="admin-stack"><section className="panel map-panel"><Panel title="Sơ đồ cửa hàng" description={canAdmin&&(!store.shelves.length||!data?.products.length)?"Cần cửa hàng, kệ và sản phẩm để gắn ESL.":"Kéo kệ đến ô mới để cập nhật vị trí."} actions={<><button className="button" disabled={!canAdmin || !store} onClick={createZone}><Plus/>Thêm zone</button><button className="button" disabled={!canAdmin || !store} onClick={createShelf}><Plus/>Thêm kệ</button><button className="button primary" disabled={!canAdmin || !store.shelves.length || !data?.products.length} onClick={createEsl}><Plus/>Gắn ESL</button></>}/>{store.zones.length>0&&<div className="zone-list" aria-label="Khu vực">{store.zones.map(zone=><span className="zone-chip" key={zone.id}><button type="button" className="zone-chip-edit" title={`Sửa khu vực ${zone.name}`} onClick={()=>editZone(zone)}><i aria-hidden="true" style={{background:zone.color}}/><span>{zone.name}</span></button>{canAdmin&&<button type="button" className="zone-chip-remove" aria-label={`Xoá khu vực ${zone.name}`} title={`Xoá khu vực ${zone.name}`} onClick={()=>requestRemoval("zone",zone.id,zone.name)}><X aria-hidden="true"/></button>}</span>)}</div>}<AdminMapEditor key={store.id} store={store} canEdit={canAdmin} onMove={(shelfId,x,y)=>api(`/api/admin/shelves/${shelfId}`, "PUT", {x,y})}/></section><section className="panel"><Panel title="ESL đã gắn" description={`${store.shelves.length} kệ · ${store.shelves.reduce((sum,shelf)=>sum+shelf.esls.length,0)} ESL`}/><div className="shelf-card-grid">{store.shelves.map((shelf)=><section className="admin-shelf-row" key={shelf.id}><header className="admin-shelf-head"><code>{shelf.code}</code><span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label={`Sửa kệ ${shelf.code}`} title={`Sửa kệ ${shelf.code}`} onClick={()=>editShelf(shelf)}><Pencil aria-hidden="true"/></button>{canAdmin&&<button type="button" className="button danger icon-action" aria-label={`Xoá kệ ${shelf.code}`} title={`Xoá kệ ${shelf.code}`} onClick={()=>requestRemoval("shelf",shelf.id,shelf.code)}><Trash2 aria-hidden="true"/></button>}</span></header>{shelf.esls.length?shelf.esls.map(esl=><div className="admin-esl-row" key={esl.id}><span><code title={esl.code}>{esl.code}</code><small>{esl.product.name}</small></span><span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label={`Sửa ESL ${esl.code}`} title={`Sửa ESL ${esl.code}`} onClick={()=>editEsl(esl)}><Pencil aria-hidden="true"/></button>{canAdmin&&<button type="button" className="button danger icon-action" aria-label={`Gỡ ESL ${esl.code}`} title={`Gỡ ESL ${esl.code}`} onClick={()=>requestRemoval("esl",esl.id,esl.code)}><Link2Off aria-hidden="true"/></button>}</span></div>):<p className="muted">Chưa gắn ESL</p>}</section>)}</div></section></div>}
  {tab==="fefo"&&<div className="admin-stack"><section className="panel"><Panel title="Quy tắc giảm giá" description={canAdmin&&!store?"Cần cửa hàng để thêm quy tắc FEFO.":"FEFO chạy cho tất cả cửa hàng đang hoạt động."} actions={<><button className="button" disabled={!canAdmin || !store} onClick={createRule}><Plus/>Thêm quy tắc</button><button className="button primary" aria-busy={integrationPending==="FEFO"} disabled={integrationPending!==null} onClick={()=>simulate("FEFO")}>{integrationPending==="FEFO"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Activity/>Chạy FEFO ngay</>}</button></>}/><div className="table-scroll"><table className="data-table"><thead><tr><th>Còn lại</th><th>Xử lý</th><th>Trạng thái</th><th></th></tr></thead><tbody>{data?.rules.map((rule)=><tr key={rule.id}><td>≤ {rule.daysRemaining} ngày</td><td data-label="Xử lý">{rule.quarantine?"Cách ly":`Giảm ${rule.discountPercent}%`}</td><td data-label="Trạng thái"><span className="badge open">{rule.active?"Active":"Tắt"}</span></td><td className="cell-actions"><span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa quy tắc" onClick={()=>editRule(rule)}><Pencil aria-hidden="true"/></button><button type="button" className="button danger icon-action" aria-label="Xoá" title="Xoá quy tắc" disabled={!canAdmin} onClick={()=>requestRemoval("fefo-rule",rule.id,`≤ ${rule.daysRemaining} ngày · ${rule.discountPercent}%`)}><Trash2 aria-hidden="true"/></button></span></td></tr>)}</tbody></table></div></section><section className="panel"><Panel title="Lô sắp hết hạn"/><div className="log-list">{data?.lots.filter((lot)=>(new Date(lot.expiryDate).getTime()-referenceTime)/86400000<=7).map((lot)=><div className="log-row" key={lot.id}><code title={lot.batchCode}>{lot.batchCode}</code><span className="log-main">{lot.product.name}</span><strong>{new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}</strong></div>)}</div></section></div>}
  {tab==="users"&&<section className="panel"><Panel title="Tài khoản & phân quyền" description={!canAdmin?"Chỉ Admin được tạo tài khoản mới.":!data?.stores.length?"Cần ít nhất một cửa hàng để tạo tài khoản.":`${data.users.length} tài khoản`} actions={canAdmin&&<button className="button primary" disabled={!data?.stores.length} onClick={() => setDialog({ kind: "user", mode: "create", defaultValues: { storeIds: store ? [store.id] : [] } })}><Plus/>Tạo tài khoản</button>}/><div className="table-scroll"><table className="data-table"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Cửa hàng</th><th></th></tr></thead><tbody>{data?.users.map((account)=><tr key={account.id}><td><span className="user-cell"><strong>{account.name}</strong><small>{account.email}</small></span></td><td data-label="Vai trò"><span className="badge open">{account.role}</span></td><td data-label="Cửa hàng">{account.userStores.map((s)=>s.store.name).join(", ")}</td><td className="cell-actions">{canAdmin&&account.id!==user.id&&<span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa tài khoản" onClick={()=>editUser(account)}><Pencil aria-hidden="true"/></button><button type="button" className="button danger icon-action" aria-label="Khoá" title="Khoá tài khoản" onClick={()=>requestRemoval("user",account.id,account.email)}><Lock aria-hidden="true"/></button></span>}</td></tr>)}</tbody></table></div></section>}
  {tab==="integrations"&&<div className="admin-stack"><section className="panel"><Panel title="Mô phỏng dữ liệu đầu vào"/><p className="muted integration-scope">POS, WMS và Supplier dùng SKU đầu tiên tại cửa hàng đang chọn. FEFO chạy cho tất cả cửa hàng đang hoạt động.</p><div className="integration-actions"><button className="button" aria-busy={integrationPending==="POS"} disabled={integrationPending!==null} onClick={()=>simulate("POS")}>{integrationPending==="POS"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Activity/>POS bán 2 sản phẩm</>}</button><button className="button" aria-busy={integrationPending==="WMS"} disabled={integrationPending!==null} onClick={()=>simulate("WMS")}>{integrationPending==="WMS"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Boxes/>WMS nhập thêm kho sau</>}</button><button className="button" aria-busy={integrationPending==="SUPPLIER"} disabled={integrationPending!==null} onClick={()=>simulate("SUPPLIER")}>{integrationPending==="SUPPLIER"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><PackageSearch/>Supplier gửi lô mới</>}</button><button className="button primary" aria-busy={integrationPending==="FEFO"} disabled={integrationPending!==null} onClick={()=>simulate("FEFO")}>{integrationPending==="FEFO"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><ShieldCheck/>Chạy FEFO engine</>}</button></div></section><section className="panel"><Panel title="Sự kiện tích hợp gần đây"/><div className="log-list">{data?.integrations.map((event)=><div className="log-row" key={event.id}><code>{event.type}</code><span className="log-main">{event.externalEventId}<small>{new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short"}).format(new Date(event.createdAt))}</small></span><span className={`badge ${event.status==="PROCESSED"?"open":"blocked"}`}>{event.status}</span></div>)}</div></section></div>}
  </section>
  {dialog?.kind === "store" && <StoreForm key={`store-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "inventory" && <InventoryForm key={dialog.id} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "product" && <ProductForm key={`product-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "supplier" && <SupplierForm key={`supplier-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "lot" && <LotForm key={`lot-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} products={data?.products || []} suppliers={data?.suppliers || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "zone" && <ZoneForm key={`zone-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "shelf" && <ShelfForm key={`shelf-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} zones={data?.stores.find(item=>item.id===(dialog.mode === "edit" ? dialog.readOnlyValues?.storeId : dialog.defaultValues.storeId))?.zones || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "esl" && <EslForm key={`esl-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} shelves={(data?.stores.find(item=>item.id===(dialog.mode === "edit" ? dialog.readOnlyValues?.storeId : dialog.defaultValues.storeId))?.shelves || []).map(item=>({id:item.id,name:`${item.code} · ${item.label}`}))} products={data?.products || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "fefo-rule" && <FefoRuleForm key={`fefo-rule-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "user" && <UserForm key={`user-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "task" && <TaskForm descriptor={dialog} stores={data?.stores || []} references={data?.taskReferences || { products: [], shelves: [], lots: [], assignees: [] }} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {confirmation && <AdminConfirmDialog open title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} onOpenChange={open=>{if(!open)setConfirmation(null);}} onSubmit={submitRemoval} />}
  <Toaster /></main>;
}

function AdminMetric({icon:Icon,label,value,alert}:{icon:typeof Store;label:string;value:number;alert?:boolean}){return <article className={`metric ${alert?"alert":""}`}><div className="metric-head"><small>{label}</small><span className="metric-icon" aria-hidden="true"><Icon/></span></div><div className="metric-value"><strong>{value}</strong></div></article>}
function Panel({title,description,actions}:{title:string;description?:ReactNode;actions?:ReactNode}){return <header className="panel-header"><div className="panel-heading"><h2>{title}</h2>{description&&<p className="panel-description">{description}</p>}</div>{actions&&<div className="panel-actions admin-actions">{actions}</div>}</header>}
function TabbedPanel<T extends string>({id,label,items,value,onChange,actions,wide,children}:{id:string;label:string;items:SubTab<T>[];value:T;onChange(value:T):void;actions?:ReactNode;wide?:boolean;children:ReactNode}){
  const move=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const target={ArrowRight:index+1,ArrowLeft:index-1,Home:0,End:items.length-1}[event.key];
    if(target===undefined)return;
    event.preventDefault();
    const next=(target+items.length)%items.length;
    onChange(items[next].id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <><header className={`panel-header tabbed${wide?" wide-tabs":""}`}><div className="sub-tabs" role="tablist" aria-label={label}>{items.map((item,index)=>{const selected=item.id===value;return <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} aria-selected={selected} aria-controls={`${id}-panel`} aria-label={item.short?item.label:undefined} tabIndex={selected?0:-1} className={selected?"active":undefined} onClick={()=>onChange(item.id)} onKeyDown={(event)=>move(event,index)}>{item.short?<><span className="tab-full">{item.label}</span><span className="tab-short" aria-hidden="true">{item.short}</span></>:item.label}</button>})}</div>{actions&&<div className="panel-actions admin-actions">{actions}</div>}</header><div className="sub-tab-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`}>{children}</div></>;
}
function InventoryTable({items,onEdit}:{items:Inventory[];onEdit(item:Inventory):void}){return <div className="table-scroll"><table className="data-table"><thead><tr><th>Sản phẩm</th><th>Kệ</th><th>Trên kệ</th><th>Kho sau</th><th>Ngưỡng</th><th></th></tr></thead><tbody>{items.map((item)=><tr key={item.id}><td>{item.product.emoji} {item.product.name}</td><td data-label="Kệ"><code>{item.shelf.code}</code></td><td data-label="Trên kệ"><strong style={{color:item.onShelf<=item.lowThreshold?"var(--red)":"inherit"}}>{item.onShelf}/{item.capacity}</strong></td><td data-label="Kho sau">{item.backroom}</td><td data-label="Ngưỡng">≤ {item.lowThreshold}</td><td className="cell-actions"><span className="row-actions icon-actions"><button type="button" className="button icon-action" aria-label="Sửa" title="Sửa tồn kho" onClick={()=>onEdit(item)}><Pencil aria-hidden="true"/></button></span></td></tr>)}</tbody></table></div>}
