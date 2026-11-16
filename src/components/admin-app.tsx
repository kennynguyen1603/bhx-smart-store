"use client";

import { Activity, Boxes, Database, LayoutGrid, LoaderCircle, LogOut, PackageSearch, Plus, RefreshCw, Settings2, ShieldCheck, Store, Users } from "lucide-react";
import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { AdminConfirmDescriptor, AdminDialogDescriptor, ApiMutationResult } from "@/components/admin/admin-types";
import { toast, Toaster } from "@/components/ui/sonner";
import { Logo } from "@/components/logo";
import { formatVnd } from "@/lib/normalize";

type StoreData = { id: string; code: string; name: string; address: string; mapWidth: number; mapHeight: number; active: boolean; zones: { id: string; name: string; color: string; x: number; y: number; width: number; height: number }[]; shelves: Shelf[]; kiosks: { id: string; name: string; x: number; y: number }[] };
type Esl = { id: string; code: string; storeId: string; shelfId: string; productId: string; ledOn: boolean; product: { name: string } };
type Shelf = { id: string; storeId: string; zoneId: string | null; code: string; label: string; x: number; y: number; width: number; height: number; zone: { name: string } | null; esls: Esl[] };
type Product = { id: string; sku: string; barcode: string; name: string; category: string; unit: string; basePriceVnd: number; emoji: string; active: boolean };
type Inventory = { id: string; onShelf: number; backroom: number; capacity: number; lowThreshold: number; version: number; product: Product; shelf: Shelf; store: { name: string } };
type Overview = { generatedAt: string; selectedStoreId: string; stores: StoreData[]; users: { id: string; name: string; email: string; role: "STAFF" | "MANAGER" | "ADMIN"; active: boolean; userStores: { storeId: string; isDefault: boolean; store: { id: string; name: string } }[] }[]; products: Product[]; suppliers: { id: string; code: string; name: string; country: string; certificate: string | null; active: boolean }[]; lots: { id: string; storeId: string; productId: string; supplierId: string; receivedAt: string; batchCode: string; origin: string; expiryDate: string; quantity: number; status: string; markdownPercent: number | null; product: Product; supplier: { name: string }; store: { name: string } }[]; inventories: Inventory[]; integrations: { id: string; externalEventId: string; type: string; status: string; error: string | null; createdAt: string }[]; audits: { id: string; action: string; entityType: string; actor: { name: string } | null; createdAt: string }[]; rules: { id: string; storeId: string; daysRemaining: number; discountPercent: number; quarantine: boolean; active: boolean }[] };
const resources = { store: "stores", inventory: "inventories", product: "products", supplier: "suppliers", lot: "lots", zone: "zones", shelf: "shelves", esl: "esls", "fefo-rule": "fefo-rules", user: "users" } as const;
const destructiveActions = {
  store: { action: "deactivate", title: "Vô hiệu hoá cửa hàng", description: "Cửa hàng sẽ ngừng hoạt động.", confirmLabel: "Vô hiệu hoá" },
  product: { action: "hide", title: "Ẩn sản phẩm", description: "Sản phẩm sẽ ngừng hiển thị.", confirmLabel: "Ẩn sản phẩm" },
  supplier: { action: "deactivate", title: "Vô hiệu hoá nhà cung cấp", description: "Nhà cung cấp sẽ ngừng hoạt động.", confirmLabel: "Vô hiệu hoá" },
  lot: { action: "close", title: "Đóng lô hàng", description: "Số lượng lô sẽ về 0 và trạng thái chuyển thành đã hết.", confirmLabel: "Đóng lô" },
  zone: { action: "delete", title: "Xoá khu vực", description: "Khu vực sẽ bị xoá khỏi sơ đồ cửa hàng.", confirmLabel: "Xoá khu vực" },
  shelf: { action: "delete", title: "Xoá kệ", description: "Kệ sẽ bị xoá khỏi sơ đồ cửa hàng.", confirmLabel: "Xoá kệ" },
  esl: { action: "detach", title: "Gỡ ESL khỏi kệ", description: "Liên kết thiết bị ESL với kệ và sản phẩm sẽ bị xoá.", confirmLabel: "Gỡ ESL" },
  "fefo-rule": { action: "delete", title: "Xoá quy tắc FEFO", description: "Quy tắc giảm giá hoặc cách ly này sẽ bị xoá.", confirmLabel: "Xoá quy tắc" },
  user: { action: "lock", title: "Khoá tài khoản", description: "Tài khoản sẽ bị vô hiệu hoá và không thể đăng nhập.", confirmLabel: "Khoá tài khoản" },
} as const satisfies Record<Exclude<AdminDialogDescriptor["kind"], "inventory">, Omit<AdminConfirmDescriptor, "kind" | "id">>;
type Tab = "overview" | "inventory" | "catalog" | "map" | "fefo" | "users" | "integrations";
type IntegrationMode = "POS" | "WMS" | "SUPPLIER" | "FEFO";

export function AdminApp({ user }: { user: Session["user"] }) {
  const [data, setData] = useState<Overview | null>(null);
  const [storeId, setStoreId] = useState(user.defaultStoreId || "");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<AdminDialogDescriptor | null>(null);
  const [confirmation, setConfirmation] = useState<AdminConfirmDescriptor | null>(null);
  const [dragShelf, setDragShelf] = useState<string | null>(null);
  const [integrationPending, setIntegrationPending] = useState<IntegrationMode | null>(null);
  const integrationPendingLock = useRef<IntegrationMode | null>(null);
  const canAdmin = user.role === "ADMIN";
  const notify = useCallback((message: string, error = false) => { if (error) toast.error(message); else toast.success(message); }, []);
  const load = useCallback(async (afterWrite = false) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/overview${storeId ? `?storeId=${storeId}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Overview refresh failed");
      const result: Overview = await response.json();
      setData(result);
      if (!storeId && result.selectedStoreId) setStoreId(result.selectedStoreId);
      return true;
    } catch {
      notify(afterWrite ? "Đã lưu thay đổi nhưng không thể tải lại dữ liệu. Vui lòng tải lại dữ liệu." : "Không thể tải dữ liệu quản trị. Vui lòng thử lại.", true);
      return false;
    } finally { setLoading(false); }
  }, [storeId, notify]);
  useEffect(() => { const initialLoad = window.setTimeout(() => void load(), 0); return () => clearTimeout(initialLoad); }, [load]);
  const store = data?.stores.find((item) => item.id === storeId) || data?.stores[0];
  const lowCount = data?.inventories.filter((item) => item.onShelf <= item.lowThreshold).length || 0;
  const referenceTime = data ? new Date(data.generatedAt).getTime() : 0;
  const expiring = data?.lots.filter((lot) => (new Date(lot.expiryDate).getTime() - referenceTime) / 86400000 <= 3).length || 0;

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
  async function dropShelf(cell: number) { if (!dragShelf || !store) return; const x = cell % store.mapWidth; const y = Math.floor(cell / store.mapWidth); await api(`/api/admin/shelves/${dragShelf}`, "PUT", { x, y }); setDragShelf(null); }
  async function simulate(mode: IntegrationMode) {
    if (integrationPendingLock.current) return;
    const inventory = data?.inventories[0];
    if (mode !== "FEFO" && !inventory) return;
    integrationPendingLock.current = mode;
    setIntegrationPending(mode);
    try {
      await api("/api/admin/simulate", "POST", { mode, inventoryId: inventory?.id, quantity: mode === "POS" ? 2 : 10 });
    } finally {
      integrationPendingLock.current = null;
      setIntegrationPending(null);
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
  const nav = [{ id:"overview",label:"Tổng quan",icon:LayoutGrid },{ id:"inventory",label:"Tồn kho",icon:Boxes },{ id:"catalog",label:"Danh mục",icon:PackageSearch },{ id:"map",label:"Sơ đồ & ESL",icon:Store },{ id:"fefo",label:"FEFO",icon:Settings2 },{ id:"users",label:"Người dùng",icon:Users },{ id:"integrations",label:"Tích hợp",icon:Database }] as const;
  return <main className="app-shell"><aside className="sidebar"><Logo inverse /><div className="store-selector"><label>CỬA HÀNG QUẢN TRỊ</label><select value={storeId} onChange={(e) => setStoreId(e.target.value)}>{data?.stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><nav className="side-nav">{nav.map(({id,label,icon:Icon}) => <button key={id} className={tab===id?"active":""} onClick={() => setTab(id)}><Icon />{label}</button>)}</nav><div className="user-card"><span className="user-avatar">AD</span><span><strong>{user.name}</strong><small>{user.role}</small></span><button onClick={() => signOut({callbackUrl:"/"})}><LogOut /></button></div></aside><section className="workspace"><header className="workspace-header"><div><span className="section-label">STORE ADMIN · {store?.code}</span><h1>{nav.find((item)=>item.id===tab)?.label}</h1><p>{store?.address}</p></div><div className="header-actions"><span className="connection-pill"><span className="live-dot" />Data layer online</span><button className="icon-button" aria-label="Tải lại dữ liệu" data-admin-dialog-fallback disabled={loading} onClick={() => void load()}><RefreshCw className={loading?"spin":""}/></button></div></header>
  {tab==="overview"&&<><div className="metric-grid"><AdminMetric icon={Store} label="Cửa hàng" value={data?.stores.length||0}/><AdminMetric icon={Boxes} label="SKU tại cửa hàng" value={data?.inventories.length||0}/><AdminMetric icon={Activity} label="Kệ sắp hết" value={lowCount} alert/><AdminMetric icon={ShieldCheck} label="Lô cần FEFO" value={expiring}/></div>{canAdmin&&<div className="admin-actions"><button className="button" onClick={createStore}><Plus/>Thêm cửa hàng</button><button className="button" disabled={!store} onClick={editStore}>Sửa cửa hàng</button>{store&&<button className="button danger" onClick={()=>requestRemoval("store",store.id,store.name)}>Vô hiệu hoá</button>}</div>}<div className="admin-grid"><section className="panel"><Panel label="TÌNH TRẠNG KỆ" title="Tồn kho gần đây"/><InventoryTable items={data?.inventories.slice(0,6)||[]} onEdit={editInventory}/></section><section className="panel"><Panel label="SYSTEM OF RECORD" title="Luồng tích hợp"/><div className="log-list">{data?.integrations.slice(0,8).map((event)=><div className="log-row" key={event.id}><code>{event.type}</code><span>{event.externalEventId}</span><span className={`badge ${event.status==="PROCESSED"?"open":"blocked"}`}>{event.status}</span></div>)}</div></section></div></>}
  {tab==="inventory"&&<section className="panel"><Panel label="ON-SHELF AVAILABILITY" title="Tồn kệ và kho sau"/><InventoryTable items={data?.inventories||[]} onEdit={editInventory}/></section>}
  {tab==="catalog"&&<div className="admin-grid"><section className="panel"><Panel label="PRODUCT MASTER" title="Sản phẩm"/>{canAdmin&&<button className="button" onClick={() => setDialog({ kind: "product", mode: "create", defaultValues: {} })}><Plus/>Thêm sản phẩm</button>}<div className="table-scroll"><table className="data-table"><thead><tr><th>SKU</th><th>Sản phẩm</th><th>Giá</th><th>Trạng thái</th><th></th></tr></thead><tbody>{data?.products.map((product)=><tr key={product.id}><td><code>{product.sku}</code></td><td>{product.emoji} {product.name}<br/><small>{product.category}</small></td><td>{formatVnd(product.basePriceVnd)}</td><td><span className={`badge ${product.active?"open":"completed"}`}>{product.active?"Active":"Ẩn"}</span></td><td>{canAdmin&&<span className="row-actions"><button className="button" onClick={()=>editProduct(product)}>Sửa</button><button className="button danger" onClick={()=>requestRemoval("product",product.id,product.name)}>Ẩn</button></span>}</td></tr>)}</tbody></table></div></section><section className="panel"><Panel label="TRACEABILITY" title="Lô hàng & nhà cung cấp"/>{canAdmin&&<div className="admin-actions"><button className="button" disabled={!store || !data?.products.length || !data?.suppliers.length} onClick={createLot}><Plus/>Thêm lô</button><button className="button" onClick={createSupplier}><Plus/>Nhà cung cấp</button></div>}{canAdmin&&(!store||!data?.products.length||!data?.suppliers.length)&&<p className="muted">Cần cửa hàng, sản phẩm và nhà cung cấp để thêm lô.</p>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Lô</th><th>Sản phẩm</th><th>Nhà cung cấp</th><th>HSD</th><th></th></tr></thead><tbody>{data?.lots.map((lot)=><tr key={lot.id}><td><code>{lot.batchCode}</code></td><td>{lot.product.name}</td><td>{lot.supplier.name}<br/><small>{lot.origin}</small></td><td>{new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}<br/><span className={`badge ${lot.status==="QUARANTINED"?"blocked":"open"}`}>{lot.status}</span></td><td>{canAdmin&&<span className="row-actions"><button className="button" onClick={()=>editLot(lot)}>Sửa</button><button className="button danger" onClick={()=>requestRemoval("lot",lot.id,lot.batchCode)}>Đóng</button></span>}</td></tr>)}</tbody></table></div><h3 style={{fontSize:12}}>Nhà cung cấp</h3>{data?.suppliers.map((supplier)=><div className="log-row" key={supplier.id}><code>{supplier.code}</code><span>{supplier.name} · {supplier.country}</span><span>{supplier.certificate}{canAdmin&&<span className="row-actions"><button className="button" onClick={()=>editSupplier(supplier)}>Sửa</button><button className="button danger" onClick={()=>requestRemoval("supplier",supplier.id,supplier.name)}>Ẩn</button></span>}</span></div>)}</section></div>}
  {tab==="map"&&!store&&<section className="panel"><p className="muted">Cần cửa hàng để quản lý sơ đồ và ESL.</p><div className="admin-actions"><button className="button" disabled>Thêm zone</button><button className="button" disabled>Thêm kệ</button><button className="button" disabled>Gắn ESL</button></div></section>}
  {tab==="map"&&store&&<section className="panel"><Panel label="STORE MAP EDITOR" title="Kéo kệ đến ô mới để cập nhật vị trí"/><div className="admin-actions"><button className="button" disabled={!canAdmin || !store} onClick={createZone}><Plus/>Thêm zone</button><button className="button" disabled={!canAdmin || !store} onClick={createShelf}><Plus/>Thêm kệ</button><button className="button" disabled={!canAdmin || !store.shelves.length || !data?.products.length} onClick={createEsl}><Plus/>Gắn ESL</button></div>{canAdmin&&(!store.shelves.length||!data?.products.length)&&<p className="muted">Cần cửa hàng, kệ và sản phẩm để gắn ESL.</p>}<div className="zone-list">{store.zones.map(zone=><span className="row-actions" key={zone.id}><button className="button" onClick={()=>editZone(zone)}><i style={{background:zone.color}}/>{zone.name}</button>{canAdmin&&<button className="button danger" aria-label={`Xoá khu vực ${zone.name}`} onClick={()=>requestRemoval("zone",zone.id,zone.name)}>Xoá</button>}</span>)}</div><div className="map-editor"><div className="map-grid" style={{gridTemplateColumns:`repeat(${store.mapWidth},1fr)`,gridTemplateRows:`repeat(${store.mapHeight},50px)`}}>{Array.from({length:store.mapWidth*store.mapHeight},(_,index)=><span className="map-cell" key={index} onDragOver={(e)=>e.preventDefault()} onDrop={()=>dropShelf(index)}/>)}{store.shelves.map((shelf)=><span draggable onDragStart={()=>setDragShelf(shelf.id)} className="draggable-shelf" key={shelf.id} style={{left:`${shelf.x/store.mapWidth*100}%`,top:`${shelf.y/store.mapHeight*100}%`,width:`${shelf.width/store.mapWidth*100}%`,height:`${shelf.height/store.mapHeight*100}%`}}>{shelf.code}<small>{shelf.esls.some(esl=>esl.ledOn)?" 🔴":" 🟢"}</small></span>)}</div><div><h3 style={{fontSize:12}}>ESL đã gắn</h3><div className="log-list">{store.shelves.map((shelf)=><section className="admin-shelf-row" key={shelf.id}><div className="admin-actions"><code>{shelf.code}</code><button className="button" aria-label={`Sửa kệ ${shelf.code}`} onClick={()=>editShelf(shelf)}>Sửa kệ</button>{canAdmin&&<button className="button danger" aria-label={`Xoá kệ ${shelf.code}`} onClick={()=>requestRemoval("shelf",shelf.id,shelf.code)}>Xoá kệ</button>}</div>{shelf.esls.length?shelf.esls.map(esl=><div className="admin-esl-row" key={esl.id}><span><code>{esl.code}</code><br/><small>{esl.product.name}</small></span><span className="row-actions"><button className="button" aria-label={`Sửa ESL ${esl.code}`} onClick={()=>editEsl(esl)}>Sửa</button>{canAdmin&&<button className="button danger" aria-label={`Gỡ ESL ${esl.code}`} onClick={()=>requestRemoval("esl",esl.id,esl.code)}>Gỡ ESL</button>}</span></div>):<p className="muted">Chưa gắn ESL</p>}</section>)}</div></div></div></section>}
  {tab==="fefo"&&<div className="admin-grid"><section className="panel"><Panel label="FEFO ENGINE" title="Quy tắc giảm giá"/><div className="admin-actions"><button className="button" disabled={!canAdmin || !store} onClick={createRule}><Plus/>Thêm quy tắc</button>{canAdmin&&!store&&<p className="muted">Cần cửa hàng để thêm quy tắc FEFO.</p>}<button className="button primary" aria-busy={integrationPending==="FEFO"} disabled={integrationPending!==null} onClick={()=>simulate("FEFO")}>{integrationPending==="FEFO"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Activity/>Chạy FEFO ngay</>}</button></div><p className="muted integration-scope">FEFO chạy cho tất cả cửa hàng đang hoạt động.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Còn lại</th><th>Xử lý</th><th>Trạng thái</th><th></th></tr></thead><tbody>{data?.rules.map((rule)=><tr key={rule.id}><td>≤ {rule.daysRemaining} ngày</td><td>{rule.quarantine?"Cách ly":`Giảm ${rule.discountPercent}%`}</td><td><span className="badge open">{rule.active?"Active":"Tắt"}</span></td><td><span className="row-actions"><button className="button" onClick={()=>editRule(rule)}>Sửa</button><button className="button danger" disabled={!canAdmin} onClick={()=>requestRemoval("fefo-rule",rule.id,`≤ ${rule.daysRemaining} ngày · ${rule.discountPercent}%`)}>Xoá</button></span></td></tr>)}</tbody></table></div></section><section className="panel"><Panel label="EXPIRY WATCH" title="Lô sắp hết hạn"/><div className="log-list">{data?.lots.filter((lot)=>(new Date(lot.expiryDate).getTime()-referenceTime)/86400000<=7).map((lot)=><div className="log-row" key={lot.id}><code>{lot.batchCode}</code><span>{lot.product.name}</span><strong>{new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}</strong></div>)}</div></section></div>}
  {tab==="users"&&<div className="admin-grid"><section className="panel"><Panel label="RBAC" title="Tài khoản & phân quyền"/>{canAdmin?<button className="button primary" disabled={!data?.stores.length} onClick={() => setDialog({ kind: "user", mode: "create", defaultValues: { storeIds: store ? [store.id] : [] } })}><Plus/>Tạo tài khoản</button>:<p className="muted">Chỉ Admin được tạo tài khoản mới.</p>}{canAdmin&&!data?.stores.length&&<p className="muted">Cần ít nhất một cửa hàng để tạo tài khoản.</p>}</section><section className="panel"><Panel label="ACTIVE ACCOUNTS" title="Người dùng"/><div className="table-scroll"><table className="data-table"><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Cửa hàng</th><th></th></tr></thead><tbody>{data?.users.map((account)=><tr key={account.id}><td>{account.name}<br/><small>{account.email}</small></td><td><span className="badge open">{account.role}</span></td><td>{account.userStores.map((s)=>s.store.name).join(", ")}</td><td>{canAdmin&&account.id!==user.id&&<span className="row-actions"><button className="button" onClick={()=>editUser(account)}>Sửa</button><button className="button danger" onClick={()=>requestRemoval("user",account.id,account.email)}>Khoá</button></span>}</td></tr>)}</tbody></table></div></section></div>}
  {tab==="integrations"&&<div className="admin-grid"><section className="panel"><Panel label="SYSTEM SIMULATOR" title="Mô phỏng dữ liệu đầu vào"/><p className="muted integration-scope">POS, WMS và Supplier dùng SKU đầu tiên tại cửa hàng đang chọn. FEFO chạy cho tất cả cửa hàng đang hoạt động.</p><div className="integration-actions"><button className="button" aria-busy={integrationPending==="POS"} disabled={integrationPending!==null} onClick={()=>simulate("POS")}>{integrationPending==="POS"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Activity/>POS bán 2 sản phẩm</>}</button><button className="button" aria-busy={integrationPending==="WMS"} disabled={integrationPending!==null} onClick={()=>simulate("WMS")}>{integrationPending==="WMS"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><Boxes/>WMS nhập thêm kho sau</>}</button><button className="button" aria-busy={integrationPending==="SUPPLIER"} disabled={integrationPending!==null} onClick={()=>simulate("SUPPLIER")}>{integrationPending==="SUPPLIER"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><PackageSearch/>Supplier gửi lô mới</>}</button><button className="button primary" aria-busy={integrationPending==="FEFO"} disabled={integrationPending!==null} onClick={()=>simulate("FEFO")}>{integrationPending==="FEFO"?<><LoaderCircle className="ui-spinner" aria-hidden="true"/>Đang xử lý…</>:<><ShieldCheck/>Chạy FEFO engine</>}</button></div></section><section className="panel"><Panel label="EVENT LOG" title="Sự kiện tích hợp gần đây"/><div className="log-list">{data?.integrations.map((event)=><div className="log-row" key={event.id}><code>{event.type}</code><span>{event.externalEventId}<br/><small>{new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short"}).format(new Date(event.createdAt))}</small></span><span className={`badge ${event.status==="PROCESSED"?"open":"blocked"}`}>{event.status}</span></div>)}</div></section></div>}
  </section>
  {dialog?.kind === "store" && <StoreForm key={`store-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "inventory" && <InventoryForm key={dialog.id} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "product" && <ProductForm key={`product-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "supplier" && <SupplierForm key={`supplier-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "lot" && <LotForm key={`lot-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} products={data?.products || []} suppliers={data?.suppliers || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "zone" && <ZoneForm key={`zone-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "shelf" && <ShelfForm key={`shelf-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} zones={data?.stores.find(item=>item.id===(dialog.mode === "edit" ? dialog.readOnlyValues?.storeId : dialog.defaultValues.storeId))?.zones || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "esl" && <EslForm key={`esl-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} shelves={(data?.stores.find(item=>item.id===(dialog.mode === "edit" ? dialog.readOnlyValues?.storeId : dialog.defaultValues.storeId))?.shelves || []).map(item=>({id:item.id,name:`${item.code} · ${item.label}`}))} products={data?.products || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "fefo-rule" && <FefoRuleForm key={`fefo-rule-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {dialog?.kind === "user" && <UserForm key={`user-${dialog.mode}-${dialog.mode === "edit" ? dialog.id : "new"}`} descriptor={dialog} stores={data?.stores || []} onOpenChange={closeDialog} onSubmit={submitEntity} />}
  {confirmation && <AdminConfirmDialog open title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} onOpenChange={open=>{if(!open)setConfirmation(null);}} onSubmit={submitRemoval} />}
  <Toaster /></main>;
}

function AdminMetric({icon:Icon,label,value,alert}:{icon:typeof Store;label:string;value:number;alert?:boolean}){return <article className={`metric ${alert?"alert":""}`}><span className="metric-icon"><Icon/></span><span><small>{label}</small><strong>{value}</strong><small>Dữ liệu hiện tại</small></span></article>}
function Panel({label,title}:{label:string;title:string}){return <header className="panel-header"><div><span className="section-label">{label}</span><h2>{title}</h2></div></header>}
function InventoryTable({items,onEdit}:{items:Inventory[];onEdit(item:Inventory):void}){return <div className="table-scroll"><table className="data-table"><thead><tr><th>Sản phẩm</th><th>Kệ</th><th>Trên kệ</th><th>Kho sau</th><th>Ngưỡng</th><th></th></tr></thead><tbody>{items.map((item)=><tr key={item.id}><td>{item.product.emoji} {item.product.name}</td><td><code>{item.shelf.code}</code></td><td><strong style={{color:item.onShelf<=item.lowThreshold?"var(--red)":"inherit"}}>{item.onShelf}/{item.capacity}</strong></td><td>{item.backroom}</td><td>≤ {item.lowThreshold}</td><td><button className="button" onClick={()=>onEdit(item)}>Sửa</button></td></tr>)}</tbody></table></div>}
