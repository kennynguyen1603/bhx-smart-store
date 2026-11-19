"use client";

import { ArrowLeft, Barcode, CheckCircle2, Footprints, Home, MapPin, Navigation, ScanLine, Search, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { Logo } from "@/components/logo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { routeToShelf } from "@/lib/kiosk";
import { createKioskDetailCache } from "@/lib/kiosk-detail-cache";
import { formatVnd } from "@/lib/normalize";

type Bootstrap = { stores: { id: string; code: string; name: string; address: string }[]; categories: string[] };
type Product = { id: string; sku: string; barcode: string; name: string; category: string; priceVnd: number; originalPriceVnd: number; markdownPercent: number | null; emoji: string; availability: "AVAILABLE" | "LOW" | "OUT"; availabilityLabel: string; shelf: { id: string; code: string; label: string; zone?: string } };
type Detail = { store: { code: string; name: string; address: string; mapWidth: number; mapHeight: number }; product: Omit<Product, "shelf"> & { unit: string; originalPriceVnd: number; shelf: { id: string; code: string; label: string; x: number; y: number; width: number; height: number; zone?: { id: string; name: string } }; traceability: { batchCode: string; origin: string; expiryDate: string; supplier: string; certificate: string | null; markdownPercent: number | null }[] }; map: { zones: { id: string; name: string; color: string; x: number; y: number; width: number; height: number }[]; shelves: { id: string; code: string; label: string; x: number; y: number; width: number; height: number }[]; start: { x: number; y: number }; destination: { x: number; y: number }; route: { x: number; y: number }[] } };
type DetailResponse = { product: Detail["product"] };
type StoreMap = { store: Detail["store"]; zones: Detail["map"]["zones"]; shelves: Detail["map"]["shelves"]; start: Detail["map"]["start"] };
type CachedPayload = DetailResponse | StoreMap;

const detailCache = createKioskDetailCache<CachedPayload>();

const categoryEmoji: Record<string, string> = { "Rau củ & trái cây": "🥬", "Sữa & đồ lạnh": "🥛", "Mì & thực phẩm khô": "🍜", "Bánh & đồ ăn nhanh": "🥖", "Chăm sóc nhà cửa": "🧴", "Trứng & thực phẩm mát": "🥚", "Gia vị & nước chấm": "🫙" };

export function KioskApp() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [storeCode, setStoreCode] = useState("");
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [results, setResults] = useState(false);
  const [scanMiss, setScanMiss] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [seconds, setSeconds] = useState(120);
  const searchInput = useRef<HTMLInputElement>(null);
  const scannerBuffer = useRef("");
  const scannerTimer = useRef<number | null>(null);
  const detailRequest = useRef(0);
  const searchRequest = useRef(0);

  const resetSession = useCallback(() => setSeconds(120), []);
  const closeDetail = useCallback(() => { detailRequest.current += 1; setSelectedProduct(null); setDetail(null); setDetailError(false); setDetailLoading(false); }, []);
  const home = useCallback((automatic = false) => {
    if (automatic) detailCache.clear();
    searchRequest.current += 1;
    setQuery(""); setProducts([]); setResults(false); setScanMiss(false); setSearchLoading(false); closeDetail(); setSeconds(120);
  }, [closeDetail]);
  const loadDetail = useCallback(async (product: Product) => {
    const detailKey = `detail:${storeCode}:${product.id}:${product.shelf.id}`;
    const detailParams = new URLSearchParams({ storeCode, shelfId: product.shelf.id });
    const mapKey = `map:${storeCode}`;
    const loadJson = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      return response.json() as Promise<CachedPayload>;
    };
    const [detailResult, mapResult] = await Promise.all([
      detailCache.get(detailKey, () => loadJson(`/api/kiosk/products/${product.id}?${detailParams}`)) as Promise<DetailResponse>,
      detailCache.get(mapKey, () => loadJson(`/api/kiosk/stores/${storeCode}/map`)) as Promise<StoreMap>,
    ]);
    const shelf = detailResult.product.shelf;
    const navigation = routeToShelf(mapResult.start, shelf, {
      width: mapResult.store.mapWidth,
      height: mapResult.store.mapHeight,
      obstacles: [
        ...mapResult.zones.map(({ x, y, width, height }) => ({ x, y, width, height })),
        ...mapResult.shelves.map(({ x, y, width, height }) => ({ x, y, width, height })),
        { x: 4, y: mapResult.store.mapHeight - 1, width: 4, height: 1 },
      ],
    });
    return { store: mapResult.store, product: detailResult.product, map: { zones: mapResult.zones, shelves: mapResult.shelves, start: mapResult.start, ...navigation } };
  }, [storeCode]);
  const prefetchProduct = useCallback((product: Product) => { void loadDetail(product).catch(() => undefined); }, [loadDetail]);
  const openProduct = useCallback(async (product: Product) => {
    const request = ++detailRequest.current;
    setSelectedProduct(product); setDetail(null); setDetailError(false); setDetailLoading(true); resetSession();
    try { const result = await loadDetail(product); if (request === detailRequest.current) setDetail(result); }
    catch { if (request === detailRequest.current) setDetailError(true); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }, [loadDetail, resetSession]);
  const search = useCallback(async (value = query, openExact = false, category?: string) => {
    if (!storeCode) return;
    const normalizedQuery = value.trim();
    const request = ++searchRequest.current;
    setSearchLoading(true);
    resetSession();
    const params = new URLSearchParams({ storeCode });
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (category) params.set("category", category);
    if (openExact) params.set("exact", "1");
    const response = await fetch(`/api/kiosk/products/search?${params}`);
    const result = await response.json();
    if (request !== searchRequest.current) return;
    setProducts(result.products || []);
    setScanMiss(openExact && !result.products?.length);
    setQuery(normalizedQuery);
    setResults(true);
    setSearchLoading(false);
    if (openExact && result.products?.length === 1) await openProduct(result.products[0]);
  }, [openProduct, query, resetSession, storeCode]);

  useEffect(() => {
    let active = true;
    fetch("/api/kiosk/bootstrap").then((response) => response.json()).then((data) => {
      if (!active) return;
      setBootstrap(data);
      if (data.stores[0]) setStoreCode(data.stores[0].code);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setSeconds((value) => value <= 1 ? (home(true), 120) : value - 1), 1000); return () => clearInterval(timer); }, [home]);
  useEffect(() => {
    const reset = () => resetSession();
    window.addEventListener("pointerdown", reset); window.addEventListener("keydown", reset);
    return () => { window.removeEventListener("pointerdown", reset); window.removeEventListener("keydown", reset); };
  }, [resetSession]);
  useEffect(() => {
    const hid = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.matches("input,textarea,[contenteditable=true]") && target !== searchInput.current) return;
      if (event.ctrlKey || event.altKey || event.metaKey) { scannerBuffer.current = ""; return; }
      if (event.key === "Enter" && scannerBuffer.current.length >= 6) {
        // Cancel the search form's default submit so a HID scan issues one exact request.
        event.preventDefault();
        const barcode = scannerBuffer.current;
        scannerBuffer.current = "";
        if (scannerTimer.current) clearTimeout(scannerTimer.current);
        setQuery(barcode);
        void search(barcode, true);
        return;
      }
      if (event.key.length === 1) {
        scannerBuffer.current += event.key;
        if (scannerTimer.current) clearTimeout(scannerTimer.current);
        // Focused text entry needs a tighter scanner cadence than the global HID target.
        const gap = target === searchInput.current ? 50 : 120;
        scannerTimer.current = window.setTimeout(() => { scannerBuffer.current = ""; }, gap);
      } else if (event.key !== "Shift") scannerBuffer.current = "";
    };
    window.addEventListener("keydown", hid); return () => window.removeEventListener("keydown", hid);
  }, [search]);

  function submit(event: FormEvent) { event.preventDefault(); search(); }
  const store = bootstrap?.stores.find((item) => item.code === storeCode);
  const timer = `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
  const heading = useMemo(() => query ? `Kết quả cho “${query}”` : "Sản phẩm trong cửa hàng", [query]);
  const modalProduct = detail?.product || selectedProduct;

  return (
    <main className="kiosk-page">
      <header className="kiosk-header"><button onClick={() => home()} style={{border:0,background:"transparent"}}><Logo /></button><div className="kiosk-location"><MapPin /><span><small>BẠN ĐANG Ở</small><strong>{store?.name || "Đang tải cửa hàng"}</strong></span></div><div className="kiosk-actions"><Select value={storeCode} onValueChange={(value) => { if (value === storeCode) return; detailCache.clearStore(storeCode); setStoreCode(value); home(); }}><SelectTrigger className="kiosk-store-select" aria-label="Chọn cửa hàng" data-store-code={storeCode}><SelectValue placeholder="Chọn cửa hàng" /></SelectTrigger><SelectContent className="kiosk-store-menu">{bootstrap?.stores.map((item) => <SelectItem value={item.code} key={item.code} data-store-code={item.code}>{item.name}</SelectItem>)}</SelectContent></Select><Link className="button kiosk-exit" href="/"><Home aria-hidden="true" /> Thoát</Link></div></header>
      <section className="kiosk-main py-5!">
        {!results ? <><div className="kiosk-intro"><span className="eyebrow">TÌM HÀNG NHANH HƠN</span><h1>Bạn đang tìm<br /><em>sản phẩm nào?</em></h1><p>Quét barcode bằng máy quét hoặc nhập tên để được chỉ đường đến đúng kệ hàng.</p></div><form className="kiosk-search" onSubmit={submit}><Search /><input ref={searchInput} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Tìm sữa, trái cây, mì gói…" /><button type="button" className="button" aria-label="Quét" onClick={()=>setCameraOpen(true)}><ScanLine/><span className="kiosk-scan-label">Quét</span></button><button className="button primary" aria-label={searchLoading ? "Đang tìm…" : query.trim() ? "Tìm kiếm" : "Xem tất cả sản phẩm"} disabled={searchLoading || !storeCode}>{searchLoading ? "Đang tìm…" : query.trim() ? "Tìm kiếm" : <span className="kiosk-action-label">Xem tất cả<span className="kiosk-action-detail"> sản phẩm</span></span>}</button></form><div className="category-grid">{bootstrap?.categories.map((category) => <button key={category} disabled={!storeCode} onClick={() => search("", false, category)}><span style={{display:"block",fontSize:25,marginBottom:7}}>{categoryEmoji[category] || "🛒"}</span>{category}</button>)}</div><div className="kiosk-scanner-hint" style={{textAlign:"center",color:"var(--muted)"}}><Barcode style={{verticalAlign:"middle",marginRight:6}} />Scanner HID sẵn sàng · Quét mã và nhấn Enter</div></> : <>
          <header className="kiosk-results-header flex items-start gap-3">
            <button className="button ghost kiosk-results-back size-11! shrink-0 p-0!" aria-label="Quay lại" title="Quay lại" onClick={() => home()}><ArrowLeft aria-hidden="true" /></button>
            <div className="kiosk-results-copy min-w-0">
              <span className="section-label">KẾT QUẢ TÌM KIẾM</span>
              <h2 className="my-1 text-[20px] leading-[1.3] text-[var(--green-950)]">{heading}</h2>
              <p className="m-0 text-[var(--muted)]">{products.length} sản phẩm phù hợp tại {store?.name}</p>
            </div>
          </header>
          <div className="product-grid">
            {products.map((product) => <button className="product-card p-5!" onClick={() => openProduct(product)} onMouseEnter={() => prefetchProduct(product)} onFocus={() => prefetchProduct(product)} onTouchStart={() => prefetchProduct(product)} key={product.id}>
              <span className="product-emoji">{product.emoji}</span>
              <span className="product-card-copy min-w-0">
                <span className="flex items-start justify-between gap-2"><small className="min-w-0">{product.category}</small><span className={`availability ${product.availability} mt-0! shrink-0 py-0! leading-5!`}>{product.availabilityLabel}</span></span>
                <strong className="mt-1! mb-1!">{product.name}</strong><ProductPrice product={product} /><span className="product-location"><MapPin style={{width:12,verticalAlign:"middle"}} /> {product.shelf.label} · {product.shelf.zone}</span>
              </span>
            </button>)}
            {!products.length && <div className="empty-state">{scanMiss ? "Không nhận diện được mã sản phẩm hoặc ESL tại cửa hàng này." : "Không tìm thấy sản phẩm phù hợp. Hãy thử từ khoá ngắn hơn."}</div>}
          </div>
        </>}
      </section>
      <div className="kiosk-session-timer" style={{position:"fixed",right:15,bottom:12,color:"var(--muted)",background:"rgba(255,255,255,.8)",padding:"7px 9px",borderRadius:9}}>Phiên tự đặt lại sau <strong style={{color:"var(--green-700)"}}>{timer}</strong></div>
      {modalProduct && (
        <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && closeDetail()}>
          <section className="modal map-modal">
            <button className="icon-button modal-close" onClick={closeDetail} aria-label="Đóng chi tiết"><X /></button>
            <div className="product-detail">
              <aside className="product-detail-info">
                <div className="detail-emoji">{modalProduct.emoji}</div>
                <div className="detail-product-copy">
                  <span className={`availability ${modalProduct.availability}`}>● {modalProduct.availabilityLabel}</span>
                  <h2>{modalProduct.name}</h2>
                  <ProductPrice product={modalProduct} detail />
                </div>
                <div className="detail-location-card">
                  <span className="detail-location-icon"><MapPin /></span>
                  <span><small>VỊ TRÍ SẢN PHẨM</small><strong>{modalProduct.shelf.label}</strong><em>{typeof modalProduct.shelf.zone === "string" ? modalProduct.shelf.zone : modalProduct.shelf.zone?.name || "Khu trưng bày"}</em></span>
                </div>
                <div className="detail-help"><Navigation /><span><strong>Đi theo tuyến màu xanh</strong><small>Điểm đến được đánh dấu màu vàng trên sơ đồ.</small></span></div>
              </aside>
              <section className="map-side">
                {detail && <>
                  <header className="map-heading">
                    <div><span className="section-label">ĐƯỜNG ĐI ĐẾN SẢN PHẨM</span><h2>{detail.product.shelf.zone?.name} · {detail.product.shelf.code}</h2><p>Từ kiosk lối vào đến đúng khu vực và kệ trưng bày.</p></div>
                    <span className="walk-time"><Footprints /><strong>Khoảng 1 phút</strong><small>đi bộ</small></span>
                  </header>
                  <StoreMap detail={detail} />
                  <div className="trace-list">
                    <span className="section-label">TRUY XUẤT NGUỒN GỐC</span>
                    {detail.product.traceability.map((lot) => <div className="trace-row" key={lot.batchCode}><span><strong>{lot.supplier}</strong>{lot.origin} · {lot.certificate || "Đã kiểm định"}</span><span><strong>Lô {lot.batchCode}</strong>HSD {new Intl.DateTimeFormat("vi-VN").format(new Date(lot.expiryDate))}{lot.markdownPercent ? ` · Giảm ${lot.markdownPercent}%` : ""}</span></div>)}
                  </div>
                  <button className="button primary large map-confirm" onClick={closeDetail}><CheckCircle2 /> Tôi đã biết đường</button>
                </>}
                {detailLoading && <div className="detail-loading" aria-label="Đang tải chỉ đường và truy xuất nguồn gốc"><span className="detail-skeleton heading" /><span className="detail-skeleton map" /><span className="detail-skeleton row" /><span className="detail-skeleton row" /></div>}
                {detailError && <div className="detail-error" role="alert"><strong>Chưa tải được chỉ đường</strong><span>Vui lòng kiểm tra kết nối và thử lại.</span><button className="button primary" onClick={() => openProduct(selectedProduct!)}>Thử lại</button></div>}
              </section>
            </div>
          </section>
        </div>
      )}
      {cameraOpen&&<div className="modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&setCameraOpen(false)}><section className="modal"><button className="icon-button modal-close" onClick={()=>setCameraOpen(false)}><X/></button><div className="modal-head"><span className="section-label">CAMERA SCANNER</span><h2>Quét barcode hoặc QR</h2></div><div className="modal-body"><BarcodeScanner label="Đưa mã vào giữa khung hình" onDetected={(value)=>{setCameraOpen(false);setQuery(value);void search(value,true);}}/></div></section></div>}
    </main>
  );
}

function ProductPrice({ product, detail = false }: { product: Pick<Product, "priceVnd" | "originalPriceVnd" | "markdownPercent">; detail?: boolean }) {
  const discounted = product.markdownPercent !== null && product.priceVnd < product.originalPriceVnd;
  return (
    <span className={`price-display ${detail ? "detail-product-price" : ""}`}>
      <span className="product-price">{formatVnd(product.priceVnd)}</span>
      {discounted && <><small className="original-price">{formatVnd(product.originalPriceVnd)}</small><small className="discount-badge">Giảm {product.markdownPercent}%</small></>}
    </span>
  );
}

function StoreMap({ detail }: { detail: Detail }) {
  const { map, store, product } = detail;
  const pct = (value: number, max: number) => `${value / max * 100}%`;
  const points = map.route.map((point) => `${point.x + .5},${point.y + .5}`).join(" ");
  const targetZoneId = product.shelf.zone?.id;
  const routeLength = Math.max(1, map.route.length - 1);
  const gridSize = `${100 / store.mapWidth}% ${100 / store.mapHeight}%`;

  return (
    <div className="store-map-shell">
      <div className="map-toolbar"><span>SƠ ĐỒ TẦNG TRỆT</span><span><i /> Tuyến đề xuất · {routeLength} đoạn</span></div>
      <div className="store-map" style={{ aspectRatio: `${store.mapWidth}/${store.mapHeight}`, backgroundSize: gridSize }} aria-label={`Sơ đồ đường đi đến ${product.shelf.label}`}>
        {map.zones.map((zone) => {
          const isTarget = zone.id === targetZoneId;
          const shelvesInZone = map.shelves.filter((shelf) => shelf.x >= zone.x && shelf.x < zone.x + zone.width && shelf.y >= zone.y && shelf.y < zone.y + zone.height);
          const isVertical = zone.height > 1;
          const isNarrow = isVertical && zone.width === 1;
          const shelvesOnLeft = shelvesInZone.filter((shelf) => shelf.x < zone.x + zone.width / 2).length;
          const labelSide = isVertical && !isNarrow ? (shelvesOnLeft >= shelvesInZone.length / 2 ? "label-right" : "label-left") : "";
          return (
            <span key={zone.id} className={`map-zone ${isTarget ? "is-target" : ""} ${labelSide} ${isNarrow ? "is-narrow" : ""}`} style={{ left: pct(zone.x, store.mapWidth), top: pct(zone.y, store.mapHeight), width: pct(zone.width, store.mapWidth), height: pct(zone.height, store.mapHeight), backgroundColor: zone.color }}>
              <span className="map-zone-label"><small>{isTarget ? "ĐIỂM ĐẾN" : "KHU VỰC"}</small><strong>{zone.name}</strong></span>
            </span>
          );
        })}
        {map.shelves.map((shelf) => {
          const isTarget = shelf.id === product.shelf.id;
          return <span key={shelf.id} className={`map-shelf ${isTarget ? "target" : ""}`} style={{ left: pct(shelf.x, store.mapWidth), top: pct(shelf.y, store.mapHeight), width: pct(Math.max(shelf.width, 1), store.mapWidth), height: pct(Math.max(shelf.height, 1), store.mapHeight) }}><strong>{shelf.code}</strong>{isTarget && <small>{shelf.label}</small>}</span>;
        })}
        <span className="map-facility checkout">QUẦY THANH TOÁN</span>
        <svg className="route-line" viewBox={`0 0 ${store.mapWidth} ${store.mapHeight}`} preserveAspectRatio="none" aria-hidden="true">
          <polyline className="route-glow" points={points} />
          <polyline className="route-path" points={points} />
        </svg>
        <span className="map-marker start" style={{ left: pct(map.start.x + .5, store.mapWidth), top: pct(map.start.y + .5, store.mapHeight) }}><i /><b>Bạn đang ở đây</b></span>
        <span className="map-marker destination" style={{ left: pct(map.destination.x + .5, store.mapWidth), top: pct(map.destination.y + .5, store.mapHeight) }}><i /><b>{product.shelf.code}</b></span>
      </div>
      <div className="map-legend"><span><i className="you" /> Kiosk hiện tại</span><span><i className="route" /> Đường chỉ dẫn</span><span><i className="destination" /> {product.shelf.label}</span></div>
      <div className="route-steps">
        <span><b>1</b><small>Xuất phát</small><strong>Kiosk lối vào</strong></span>
        <span><b>2</b><small>Đi theo</small><strong>Lối đi chính</strong></span>
        <span><b>3</b><small>Rẽ vào</small><strong>{product.shelf.zone?.name || "Khu trưng bày"}</strong></span>
        <span className="active"><b>4</b><small>Điểm đến</small><strong>{product.shelf.label}</strong></span>
      </div>
    </div>
  );
}
