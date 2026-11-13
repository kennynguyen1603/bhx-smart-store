"use client";

import { ArrowLeft, Barcode, CheckCircle2, Clock3, Home, MapPin, ScanLine, Search, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { Logo } from "@/components/logo";
import { formatVnd } from "@/lib/normalize";

type Bootstrap = { stores: { id: string; code: string; name: string; address: string }[]; categories: string[] };
type Product = { id: string; sku: string; barcode: string; name: string; category: string; priceVnd: number; emoji: string; availability: "AVAILABLE" | "LOW" | "OUT"; availabilityLabel: string; shelf: { id: string; code: string; label: string; zone?: string } };
type Detail = { store: { code: string; name: string; address: string; mapWidth: number; mapHeight: number }; product: Omit<Product, "shelf"> & { unit: string; originalPriceVnd: number; shelf: { id: string; code: string; label: string; zone?: { name: string } }; traceability: { batchCode: string; origin: string; expiryDate: string; supplier: string; certificate: string | null; markdownPercent: number | null }[] }; map: { zones: { id: string; name: string; color: string; x: number; y: number; width: number; height: number }[]; shelves: { id: string; code: string; label: string; x: number; y: number; width: number; height: number }[]; start: { x: number; y: number }; destination: { x: number; y: number }; route: { x: number; y: number }[] } };

const categoryEmoji: Record<string, string> = { "Rau củ & trái cây": "🥬", "Sữa & đồ lạnh": "🥛", "Mì & thực phẩm khô": "🍜", "Bánh & đồ ăn nhanh": "🥖", "Chăm sóc nhà cửa": "🧴" };

export function KioskApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [storeCode, setStoreCode] = useState("NT-Q5");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [results, setResults] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [seconds, setSeconds] = useState(120);
  const scannerBuffer = useRef("");
  const scannerTimer = useRef<number | null>(null);

  const resetSession = useCallback(() => setSeconds(120), []);
  const home = useCallback(() => { setQuery(""); setProducts([]); setResults(false); setDetail(null); setSeconds(120); }, []);
  const openProduct = useCallback(async (id: string) => {
    setLoading(true);
    const response = await fetch(`/api/kiosk/products/${id}?storeCode=${storeCode}`);
    const result = await response.json();
    if (response.ok) setDetail(result);
    setLoading(false);
    resetSession();
  }, [resetSession, storeCode]);
  const search = useCallback(async (value = query, openExact = false, category?: string) => {
    setLoading(true);
    resetSession();
    const params = new URLSearchParams({ storeCode });
    if (value) params.set("q", value);
    if (category) params.set("category", category);
    const response = await fetch(`/api/kiosk/products/search?${params}`);
    const result = await response.json();
    setProducts(result.products || []);
    setResults(true);
    setLoading(false);
    if (openExact && result.products?.length === 1) await openProduct(result.products[0].id);
  }, [openProduct, query, resetSession, storeCode]);

  useEffect(() => { fetch("/api/kiosk/bootstrap").then((response) => response.json()).then((data) => { setBootstrap(data); if (data.stores[0]) setStoreCode(data.stores[0].code); }); }, []);
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value <= 1 ? (home(), 120) : value - 1), 1000); return () => clearInterval(timer); }, [home]);
  useEffect(() => {
    const reset = () => resetSession();
    window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset);
    return () => { window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); };
  }, [resetSession]);
  useEffect(() => {
    const hid = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input,textarea")) return;
      if (event.key === "Enter" && scannerBuffer.current.length >= 6) { const barcode = scannerBuffer.current; scannerBuffer.current = ""; search(barcode, true); return; }
      if (event.key.length === 1) { scannerBuffer.current += event.key; if (scannerTimer.current) clearTimeout(scannerTimer.current); scannerTimer.current = window.setTimeout(() => { scannerBuffer.current = ""; }, 120); }
    };
    window.addEventListener("keydown", hid); return () => window.removeEventListener("keydown", hid);
  }, [search]);

  function submit(event: FormEvent) { event.preventDefault(); search(); }
  const store = bootstrap?.stores.find((item) => item.code === storeCode);
  const timer = `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
  const heading = useMemo(() => query ? `Kết quả cho “${query}”` : "Sản phẩm trong cửa hàng", [query]);

  return (
    <main className="kiosk-page">
      <header className="kiosk-header"><button onClick={home} style={{border:0,background:"transparent"}}><Logo /></button><div className="kiosk-location"><MapPin /><span><small>BẠN ĐANG Ở</small><strong>{store?.name || "Đang tải cửa hàng"}</strong></span></div><div className="kiosk-actions"><select className="form-control" value={storeCode} onChange={(e) => { setStoreCode(e.target.value); home(); }}>{bootstrap?.stores.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}</select><Link className="button" href="/"><Home /> Thoát</Link></div></header>
      <section className="kiosk-main">
        {!results ? <><div className="kiosk-intro"><span className="eyebrow">TÌM HÀNG NHANH HƠN</span><h1>Bạn đang tìm<br /><em>sản phẩm nào?</em></h1><p>Quét barcode bằng máy quét hoặc nhập tên để được chỉ đường đến đúng kệ hàng.</p></div><form className="kiosk-search" onSubmit={submit}><Search /><input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Tìm sữa, trái cây, mì gói…" /><button type="button" className="button" onClick={()=>setCameraOpen(true)}><ScanLine/>Quét</button><button className="button primary" disabled={loading}>{loading ? "Đang tìm…" : "Tìm kiếm"}</button></form><div className="category-grid">{bootstrap?.categories.map((category) => <button key={category} onClick={() => search("", false, category)}><span style={{display:"block",fontSize:25,marginBottom:7}}>{categoryEmoji[category] || "🛒"}</span>{category}</button>)}</div><div style={{textAlign:"center",color:"var(--muted)",fontSize:9}}><Barcode style={{verticalAlign:"middle",marginRight:6}} />Scanner HID sẵn sàng · Quét mã và nhấn Enter</div></> : <><button className="button ghost" onClick={home}><ArrowLeft /> Quay lại</button><header className="panel-header" style={{marginTop:20}}><div><span className="section-label">KẾT QUẢ TÌM KIẾM</span><h2>{heading}</h2><p>{products.length} sản phẩm phù hợp tại {store?.name}</p></div></header><div className="product-grid">{products.map((product) => <button className="product-card" onClick={() => openProduct(product.id)} key={product.id}><span className="product-emoji">{product.emoji}</span><span><small>{product.category}</small><strong>{product.name}</strong><span className="product-price">{formatVnd(product.priceVnd)}</span><span className="product-location"><MapPin style={{width:12,verticalAlign:"middle"}} /> {product.shelf.label} · {product.shelf.zone}</span><span className={`availability ${product.availability}`}>{product.availabilityLabel}</span></span></button>)}{!products.length && <div className="empty-state">Không tìm thấy sản phẩm phù hợp. Hãy thử từ khoá ngắn hơn.</div>}</div></>}
      </section>
      <div style={{position:"fixed",right:15,bottom:12,fontSize:8,color:"var(--muted)",background:"rgba(255,255,255,.8)",padding:"7px 9px",borderRadius:9}}>Phiên tự đặt lại sau <strong style={{color:"var(--green-700)"}}>{timer}</strong></div>
      {detail && <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setDetail(null)}><section className="modal wide"><button className="icon-button modal-close" onClick={() => setDetail(null)}><X /></button><div className="product-detail"><aside className="product-detail-info"><div className="detail-emoji">{detail.product.emoji}</div><div><span className={`availability ${detail.product.availability}`}>● {detail.product.availabilityLabel}</span><h2>{detail.product.name}</h2><div className="product-price" style={{fontSize:22}}>{formatVnd(detail.product.priceVnd)}</div>{detail.product.priceVnd < detail.product.originalPriceVnd && <small style={{textDecoration:"line-through",color:"var(--muted)"}}>{formatVnd(detail.product.originalPriceVnd)}</small>}<p className="muted" style={{fontSize:9}}>{detail.product.shelf.label} · {detail.product.shelf.zone?.name}</p></div></aside><section className="map-side"><span className="section-label">ĐƯỜNG ĐI ĐẾN SẢN PHẨM</span><h2 style={{margin:"6px 0"}}>{detail.product.shelf.label}</h2><p className="muted" style={{fontSize:9}}>Đi theo đường nét đứt từ kiosk đến kệ được tô vàng.</p><StoreMap detail={detail} /><div className="trace-list"><span className="section-label">TRUY XUẤT NGUỒN GỐC</span>{detail.product.traceability.map((lot) => <div className="trace-row" key={lot.batchCode}><span><strong>{lot.supplier}</strong>{lot.origin} · {lot.certificate || "Đã kiểm định"}</span><span><strong>Lô {lot.batchCode}</strong>HSD {new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}{lot.markdownPercent ? ` · Giảm ${lot.markdownPercent}%` : ""}</span></div>)}</div><button className="button primary large" style={{marginTop:16}} onClick={() => setDetail(null)}><CheckCircle2 /> Tôi đã biết đường</button></section></div></section></div>}
      {cameraOpen&&<div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setCameraOpen(false)}><section className="modal"><button className="icon-button modal-close" onClick={()=>setCameraOpen(false)}><X/></button><div className="modal-head"><span className="section-label">CAMERA SCANNER</span><h2>Quét barcode hoặc QR</h2></div><div className="modal-body"><BarcodeScanner label="Đưa mã vào giữa khung hình" onDetected={(value)=>{setCameraOpen(false);setQuery(value);void search(value,true);}}/></div></section></div>}
      {loading && <div className="toast-stack"><div className="toast"><Clock3 className="spin" /> Đang đồng bộ dữ liệu cửa hàng…</div></div>}
    </main>
  );
}

function StoreMap({ detail }: { detail: Detail }) {
  const { map, store, product } = detail;
  const pct = (value: number, max: number) => `${value / max * 100}%`;
  const points = map.route.map((point) => `${point.x + .5},${point.y + .5}`).join(" ");
  return <div className="store-map" style={{gridTemplateColumns:`repeat(${store.mapWidth},1fr)`,gridTemplateRows:`repeat(${store.mapHeight},1fr)`}}>{map.zones.map((zone) => <span key={zone.id} className="map-zone" style={{left:pct(zone.x,store.mapWidth),top:pct(zone.y,store.mapHeight),width:pct(zone.width,store.mapWidth),height:pct(zone.height,store.mapHeight),background:zone.color}} />)}{map.shelves.map((shelf) => <span key={shelf.id} className={`map-shelf ${shelf.id === product.shelf.id ? "target" : ""}`} style={{left:pct(shelf.x,store.mapWidth),top:pct(shelf.y,store.mapHeight),width:pct(shelf.width,store.mapWidth),height:pct(shelf.height,store.mapHeight)}}>{shelf.code}</span>)}<svg className="route-line" viewBox={`0 0 ${store.mapWidth} ${store.mapHeight}`} preserveAspectRatio="none"><polyline points={points} /></svg><i className="map-point" style={{left:pct(map.start.x+.5,store.mapWidth),top:pct(map.start.y+.5,store.mapHeight)}} /><i className="map-point" style={{left:pct(map.destination.x+.5,store.mapWidth),top:pct(map.destination.y+.5,store.mapHeight),background:"var(--yellow)"}} /></div>;
}
