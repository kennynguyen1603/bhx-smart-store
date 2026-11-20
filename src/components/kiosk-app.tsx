"use client";

import {
  ArrowLeft,
  Barcode,
  CheckCircle2,
  Footprints,
  Home,
  MapPin,
  ScanLine,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { Logo } from "@/components/logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routeToShelf } from "@/lib/kiosk";
import { createKioskDetailCache } from "@/lib/kiosk-detail-cache";
import { formatVnd } from "@/lib/normalize";

type Bootstrap = {
  stores: { id: string; code: string; name: string; address: string }[];
  categories: string[];
};
type Product = {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  priceVnd: number;
  originalPriceVnd: number;
  markdownPercent: number | null;
  emoji: string;
  availability: "AVAILABLE" | "LOW" | "OUT";
  availabilityLabel: string;
  shelf: { id: string; code: string; label: string; zone?: string };
};
type Detail = {
  store: {
    code: string;
    name: string;
    address: string;
    mapWidth: number;
    mapHeight: number;
  };
  product: Omit<Product, "shelf"> & {
    unit: string;
    originalPriceVnd: number;
    shelf: {
      id: string;
      code: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
      zone?: { id: string; name: string };
    };
    traceability: {
      batchCode: string;
      origin: string;
      expiryDate: string;
      supplier: string;
      certificate: string | null;
      markdownPercent: number | null;
    }[];
  };
  map: {
    zones: {
      id: string;
      name: string;
      color: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
    shelves: {
      id: string;
      code: string;
      label: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[];
    start: { x: number; y: number };
    destination: { x: number; y: number };
    route: { x: number; y: number }[];
  };
};
type DetailResponse = { product: Detail["product"] };
type StoreMap = {
  store: Detail["store"];
  zones: Detail["map"]["zones"];
  shelves: Detail["map"]["shelves"];
  start: Detail["map"]["start"];
};
type CachedPayload = DetailResponse | StoreMap;

const detailCache = createKioskDetailCache<CachedPayload>();

const categoryEmoji: Record<string, string> = {
  "Rau củ & trái cây": "🥬",
  "Sữa & đồ lạnh": "🥛",
  "Mì & thực phẩm khô": "🍜",
  "Bánh & đồ ăn nhanh": "🥖",
  "Chăm sóc nhà cửa": "🧴",
  "Trứng & thực phẩm mát": "🥚",
  "Gia vị & nước chấm": "🫙",
};

// Type-ahead waits for a typing pause so each keystroke does not hit the API.
const SUGGEST_DELAY_MS = 100;
const SUGGEST_MIN_CHARS = 2;
const SUGGEST_LIMIT = 6;

type Suggestions = { query: string; products: Product[] };

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
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchInput = useRef<HTMLInputElement>(null);
  const suggestTimer = useRef<number | null>(null);
  const suggestAbort = useRef<AbortController | null>(null);
  const scannerBuffer = useRef("");
  const scannerTimer = useRef<number | null>(null);
  const detailRequest = useRef(0);
  const searchRequest = useRef(0);

  const resetSession = useCallback(() => setSeconds(120), []);
  const cancelSuggestions = useCallback(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = null;
    suggestAbort.current?.abort();
    suggestAbort.current = null;
    setSuggestOpen(false);
    setActiveSuggestion(-1);
  }, []);
  const requestSuggestions = useCallback(
    (value: string) => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      suggestAbort.current?.abort();
      suggestAbort.current = null;
      const term = value.trim();
      if (term.length < SUGGEST_MIN_CHARS || !storeCode) {
        suggestTimer.current = null;
        setSuggestions(null);
        setSuggestOpen(false);
        setActiveSuggestion(-1);
        return;
      }
      suggestTimer.current = window.setTimeout(async () => {
        suggestTimer.current = null;
        const controller = new AbortController();
        suggestAbort.current = controller;
        const params = new URLSearchParams({
          storeCode,
          q: term,
          limit: String(SUGGEST_LIMIT * 2),
        });
        try {
          const response = await fetch(`/api/kiosk/products/search?${params}`, {
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error(`Request failed: ${response.status}`);
          const result = (await response.json()) as { products?: Product[] };
          if (controller.signal.aborted) return;
          // A product stocked on several shelves comes back once per shelf.
          const seen = new Set<string>();
          const unique = (result.products || []).filter(
            (product) => !seen.has(product.id) && !!seen.add(product.id),
          );
          setSuggestions({
            query: term,
            products: unique.slice(0, SUGGEST_LIMIT),
          });
          setActiveSuggestion(-1);
          setSuggestOpen(true);
        } catch {
          if (controller.signal.aborted) return;
          setSuggestions(null);
          setSuggestOpen(false);
        } finally {
          if (suggestAbort.current === controller) suggestAbort.current = null;
        }
      }, SUGGEST_DELAY_MS);
    },
    [storeCode],
  );
  const closeDetail = useCallback(() => {
    detailRequest.current += 1;
    setSelectedProduct(null);
    setDetail(null);
    setDetailError(false);
    setDetailLoading(false);
  }, []);
  const home = useCallback(
    (automatic = false) => {
      if (automatic) detailCache.clear();
      searchRequest.current += 1;
      cancelSuggestions();
      setSuggestions(null);
      setQuery("");
      setProducts([]);
      setResults(false);
      setScanMiss(false);
      setSearchLoading(false);
      closeDetail();
      setSeconds(120);
    },
    [cancelSuggestions, closeDetail],
  );
  const loadDetail = useCallback(
    async (product: Product) => {
      const detailKey = `detail:${storeCode}:${product.id}:${product.shelf.id}`;
      const detailParams = new URLSearchParams({
        storeCode,
        shelfId: product.shelf.id,
      });
      const mapKey = `map:${storeCode}`;
      const loadJson = async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json() as Promise<CachedPayload>;
      };
      const [detailResult, mapResult] = await Promise.all([
        detailCache.get(detailKey, () =>
          loadJson(`/api/kiosk/products/${product.id}?${detailParams}`),
        ) as Promise<DetailResponse>,
        detailCache.get(mapKey, () =>
          loadJson(`/api/kiosk/stores/${storeCode}/map`),
        ) as Promise<StoreMap>,
      ]);
      const shelf = detailResult.product.shelf;
      const navigation = routeToShelf(mapResult.start, shelf, {
        width: mapResult.store.mapWidth,
        height: mapResult.store.mapHeight,
        obstacles: [
          ...mapResult.zones.map(({ x, y, width, height }) => ({
            x,
            y,
            width,
            height,
          })),
          ...mapResult.shelves.map(({ x, y, width, height }) => ({
            x,
            y,
            width,
            height,
          })),
          { x: 4, y: mapResult.store.mapHeight - 1, width: 4, height: 1 },
        ],
      });
      return {
        store: mapResult.store,
        product: detailResult.product,
        map: {
          zones: mapResult.zones,
          shelves: mapResult.shelves,
          start: mapResult.start,
          ...navigation,
        },
      };
    },
    [storeCode],
  );
  const prefetchProduct = useCallback(
    (product: Product) => {
      void loadDetail(product).catch(() => undefined);
    },
    [loadDetail],
  );
  const openProduct = useCallback(
    async (product: Product) => {
      const request = ++detailRequest.current;
      setSelectedProduct(product);
      setDetail(null);
      setDetailError(false);
      setDetailLoading(true);
      resetSession();
      try {
        const result = await loadDetail(product);
        if (request === detailRequest.current) setDetail(result);
      } catch {
        if (request === detailRequest.current) setDetailError(true);
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [loadDetail, resetSession],
  );
  const search = useCallback(
    async (value = query, openExact = false, category?: string) => {
      if (!storeCode) return;
      const normalizedQuery = value.trim();
      const request = ++searchRequest.current;
      cancelSuggestions();
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
      if (openExact && result.products?.length === 1)
        await openProduct(result.products[0]);
    },
    [cancelSuggestions, openProduct, query, resetSession, storeCode],
  );
  const pickSuggestion = useCallback(
    (product: Product) => {
      const term = suggestions?.query || query;
      scannerBuffer.current = "";
      setQuery(term);
      // Land on the matching results behind the map so closing it keeps context.
      void search(term);
      void openProduct(product);
    },
    [openProduct, query, search, suggestions],
  );

  useEffect(
    () => () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      suggestAbort.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/kiosk/bootstrap")
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setBootstrap(data);
        if (data.stores[0]) setStoreCode(data.stores[0].code);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds((value) => (value <= 1 ? (home(true), 120) : value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [home]);
  useEffect(() => {
    const reset = () => resetSession();
    window.addEventListener("pointerdown", reset);
    window.addEventListener("keydown", reset);
    return () => {
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [resetSession]);
  useEffect(() => {
    const hid = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target?.matches("input,textarea,[contenteditable=true]") &&
        target !== searchInput.current
      )
        return;
      if (event.ctrlKey || event.altKey || event.metaKey) {
        scannerBuffer.current = "";
        return;
      }
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
        scannerTimer.current = window.setTimeout(() => {
          scannerBuffer.current = "";
        }, gap);
      } else if (event.key !== "Shift") scannerBuffer.current = "";
    };
    window.addEventListener("keydown", hid);
    return () => window.removeEventListener("keydown", hid);
  }, [search]);

  function submit(event: FormEvent) {
    event.preventDefault();
    search();
  }
  const suggestionItems = suggestions?.products || [];
  const showSuggestions =
    suggestOpen && !!suggestions && query.trim().length >= SUGGEST_MIN_CHARS;
  function suggestionKeys(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (showSuggestions) event.preventDefault();
      setSuggestOpen(false);
      setActiveSuggestion(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!suggestionItems.length) return;
      event.preventDefault();
      setSuggestOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveSuggestion((index) => {
        if (!showSuggestions) return step > 0 ? 0 : suggestionItems.length - 1;
        const next = index + step;
        if (next < -1) return suggestionItems.length - 1;
        return next >= suggestionItems.length ? -1 : next;
      });
      return;
    }
    if (event.key === "Enter" && showSuggestions && activeSuggestion >= 0) {
      const product = suggestionItems[activeSuggestion];
      if (!product) return;
      event.preventDefault();
      pickSuggestion(product);
    }
  }
  const store = bootstrap?.stores.find((item) => item.code === storeCode);
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const heading = useMemo(
    () => (query ? `Kết quả cho “${query}”` : "Sản phẩm trong cửa hàng"),
    [query],
  );
  const modalProduct = detail?.product || selectedProduct;

  return (
    <main className={`kiosk-page${results ? " flex flex-col" : ""}`}>
      <header className="kiosk-header">
        <button
          onClick={() => home()}
          style={{ border: 0, background: "transparent" }}
        >
          <Logo />
        </button>
        <div className="kiosk-location">
          <MapPin />
          <span>
            <small>BẠN ĐANG Ở</small>
            <strong>{store?.name || "Đang tải cửa hàng"}</strong>
          </span>
        </div>
        <div className="kiosk-actions">
          <Select
            value={storeCode}
            onValueChange={(value) => {
              if (value === storeCode) return;
              detailCache.clearStore(storeCode);
              setStoreCode(value);
              home();
            }}
          >
            <SelectTrigger
              className="kiosk-store-select"
              aria-label="Chọn cửa hàng"
              data-store-code={storeCode}
            >
              <SelectValue placeholder="Chọn cửa hàng" />
            </SelectTrigger>
            <SelectContent className="kiosk-store-menu">
              {bootstrap?.stores.map((item) => (
                <SelectItem
                  value={item.code}
                  key={item.code}
                  data-store-code={item.code}
                >
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link className="button kiosk-exit" href="/">
            <Home aria-hidden="true" /> Thoát
          </Link>
        </div>
      </header>
      <section
        className={`kiosk-main py-5!${results ? " flex flex-1 flex-col" : ""}`}
      >
        {!results ? (
          <>
            <div className="kiosk-intro">
              <span className="eyebrow">TÌM HÀNG NHANH HƠN</span>
              <h1>
                Bạn đang tìm
                <br />
                <em>sản phẩm nào?</em>
              </h1>
              <p>
                Quét barcode bằng máy quét hoặc nhập tên để được chỉ đường đến
                đúng kệ hàng.
              </p>
            </div>
            <form className="kiosk-search" onSubmit={submit}>
              <Search aria-hidden="true" />
              <input
                ref={searchInput}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  requestSuggestions(e.target.value);
                }}
                onKeyDown={suggestionKeys}
                onFocus={() => {
                  if (suggestions && query.trim() === suggestions.query)
                    setSuggestOpen(true);
                }}
                onBlur={() => {
                  setSuggestOpen(false);
                  setActiveSuggestion(-1);
                }}
                autoFocus
                autoComplete="off"
                role="combobox"
                aria-label="Tìm sản phẩm"
                aria-autocomplete="list"
                aria-expanded={showSuggestions && suggestionItems.length > 0}
                aria-controls="kiosk-suggestions"
                aria-activedescendant={
                  showSuggestions && activeSuggestion >= 0
                    ? `kiosk-suggestion-${activeSuggestion}`
                    : undefined
                }
                placeholder="Tìm sữa, trái cây, mì gói…"
              />
              <button
                type="button"
                className="button"
                aria-label="Quét"
                onClick={() => setCameraOpen(true)}
              >
                <ScanLine aria-hidden="true" />
                <span className="kiosk-scan-label">Quét</span>
              </button>
              <button
                className="button primary"
                aria-label={
                  searchLoading
                    ? "Đang tìm…"
                    : query.trim()
                      ? "Tìm kiếm"
                      : "Xem tất cả sản phẩm"
                }
                disabled={searchLoading || !storeCode}
              >
                {searchLoading ? (
                  "Đang tìm…"
                ) : query.trim() ? (
                  "Tìm kiếm"
                ) : (
                  <span className="kiosk-action-label">
                    Xem tất cả
                    <span className="kiosk-action-detail"> sản phẩm</span>
                  </span>
                )}
              </button>
              {showSuggestions && (
                <div
                  className="kiosk-suggestions"
                  // Keep focus in the input so a tap selects instead of blurring first.
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {suggestionItems.length ? (
                    <ul
                      id="kiosk-suggestions"
                      role="listbox"
                      aria-label="Gợi ý sản phẩm"
                    >
                      {suggestionItems.map((product, index) => (
                        <li
                          key={product.id}
                          id={`kiosk-suggestion-${index}`}
                          role="option"
                          aria-selected={index === activeSuggestion}
                          className="kiosk-suggestion"
                          onClick={() => pickSuggestion(product)}
                          onMouseEnter={() => {
                            setActiveSuggestion(index);
                            prefetchProduct(product);
                          }}
                        >
                          <span
                            className="kiosk-suggestion-emoji"
                            aria-hidden="true"
                          >
                            {product.emoji}
                          </span>
                          <span className="kiosk-suggestion-copy">
                            <strong>{product.name}</strong>
                            <small>
                              {product.category} · {product.shelf.label}
                            </small>
                          </span>
                          <span className="kiosk-suggestion-meta">
                            <span className="kiosk-suggestion-price">
                              {formatVnd(product.priceVnd)}
                            </span>
                            {product.availability !== "AVAILABLE" && (
                              <span
                                className={`kiosk-suggestion-stock ${product.availability}`}
                              >
                                {product.availabilityLabel}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="kiosk-suggestion-empty" role="status">
                      Không có gợi ý cho “{suggestions.query}”
                    </p>
                  )}
                </div>
              )}
            </form>
            <div className="category-grid">
              {bootstrap?.categories.map((category) => (
                <button
                  key={category}
                  disabled={!storeCode}
                  onClick={() => search("", false, category)}
                >
                  <span className="kiosk-category-icon" aria-hidden="true">
                    {categoryEmoji[category] || "🛒"}
                  </span>
                  <span className="kiosk-category-name">{category}</span>
                </button>
              ))}
            </div>
            <div
              className="kiosk-scanner-hint"
              style={{ textAlign: "center", color: "var(--muted)" }}
            >
              <Barcode style={{ verticalAlign: "middle", marginRight: 6 }} />
              Scanner HID sẵn sàng · Quét mã và nhấn Enter
            </div>
          </>
        ) : (
          <>
            <header className="kiosk-results-header flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
              <button
                className="button ghost kiosk-results-back size-11! shrink-0 p-0!"
                aria-label="Quay lại"
                title="Quay lại"
                onClick={() => home()}
              >
                <ArrowLeft aria-hidden="true" />
              </button>
              <div className="kiosk-results-copy min-w-0 flex-1">
                <span className="section-label">KẾT QUẢ TÌM KIẾM</span>
                <h2 className="my-1 text-[20px] leading-[1.3] text-[var(--green-950)]">
                  {heading}
                </h2>
              </div>
              <p className="kiosk-results-count m-0 max-w-[45%] text-right text-[var(--muted)] max-[640px]:max-w-none max-[640px]:basis-full max-[640px]:pl-14 max-[640px]:text-left">
                {products.length} sản phẩm phù hợp tại {store?.name}
              </p>
            </header>
            {products.length ? (
              <div className="product-grid">
                {products.map((product) => (
                  <button
                    className="product-card p-5!"
                    onClick={() => openProduct(product)}
                    onMouseEnter={() => prefetchProduct(product)}
                    onFocus={() => prefetchProduct(product)}
                    onTouchStart={() => prefetchProduct(product)}
                    key={product.id}
                  >
                    <span className="product-emoji">{product.emoji}</span>
                    <span className="product-card-copy min-w-0">
                      <span className="flex items-start justify-between gap-2">
                        <small className="min-w-0">{product.category}</small>
                        <span
                          className={`availability ${product.availability} mt-0! shrink-0 py-0! leading-5!`}
                        >
                          {product.availabilityLabel}
                        </span>
                      </span>
                      <strong className="mt-1! mb-1!">{product.name}</strong>
                      <ProductPrice product={product} />
                      <span className="product-location">
                        <MapPin
                          style={{ width: 12, verticalAlign: "middle" }}
                        />{" "}
                        {product.shelf.label} · {product.shelf.zone}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid flex-1 place-items-center py-10">
                <div className="empty-state w-full max-w-[560px]">
                  {scanMiss
                    ? "Không nhận diện được mã sản phẩm hoặc ESL tại cửa hàng này."
                    : "Không tìm thấy sản phẩm phù hợp. Hãy thử từ khoá ngắn hơn."}
                </div>
              </div>
            )}
          </>
        )}
      </section>
      <div
        className="kiosk-session-timer"
        style={{
          position: "fixed",
          right: 15,
          bottom: 12,
          color: "var(--muted)",
          background: "rgba(255,255,255,.8)",
          padding: "7px 9px",
          borderRadius: 9,
        }}
      >
        Phiên tự đặt lại sau{" "}
        <strong style={{ color: "var(--green-700)" }}>{timer}</strong>
      </div>
      {modalProduct && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.currentTarget === event.target && closeDetail()
          }
        >
          <section className="modal map-modal">
            <button
              className="icon-button modal-close absolute! top-3! right-3! size-11! min-h-11! min-w-11!"
              onClick={closeDetail}
              aria-label="Đóng chi tiết"
            >
              <X />
            </button>
            <div className="product-detail grid! min-h-0! grid-cols-1! lg:grid-cols-[310px_minmax(0,1fr)]! lg:grid-rows-[auto_minmax(0,1fr)]!">
              <aside className="product-detail-info detail-product-summary grid! grid-cols-[44px_minmax(0,1fr)]! self-start! gap-x-2! border-r-0! border-b! border-[#e8e2d7]! p-2.5! pr-14! lg:col-start-1 lg:row-start-1 lg:grid-cols-[72px_minmax(0,1fr)]! lg:gap-x-3! lg:border-r! lg:border-b-0! lg:p-5! lg:pr-5!">
                <div className="detail-emoji size-11! h-11! self-center! rounded-xl! text-[26px]! lg:size-[72px]! lg:text-[40px]!">
                  {modalProduct.emoji}
                </div>
                <div className="detail-product-copy grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 lg:block [&>.detail-product-price]:col-start-2 [&>.detail-product-price]:row-start-1 [&>.detail-product-price]:justify-self-start">
                  <span
                    className={`availability ${modalProduct.availability} mt-0! px-2! py-1! text-[12px]!`}
                  >
                    ● {modalProduct.availabilityLabel}
                  </span>
                  <h2 className="col-span-2 row-start-2 my-0! font-serif! text-[17px]! leading-tight! wrap-break-word lg:my-1.5! lg:text-[20px]!">
                    {modalProduct.name}
                  </h2>
                  <ProductPrice product={modalProduct} detail />
                  <div className="detail-location-inline col-span-2 row-start-3 mt-0.5 flex min-w-0 items-center gap-1.5 border-0 bg-transparent p-0 lg:mt-3 lg:gap-2 lg:rounded-xl lg:border lg:border-[#dce9df] lg:bg-white/80 lg:px-2.5 lg:py-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-[#e8f7ee] text-[#08783f] lg:size-8">
                      <MapPin className="size-3.5 lg:size-4" />
                    </span>
                    <span className="min-w-0 wrap-break-word text-[12px] leading-tight text-[#77837e] lg:grid lg:gap-0.5 lg:text-[13px]">
                      <strong className="text-[13px] text-[#063d25] lg:text-[14px]">
                        {modalProduct.shelf.label}
                      </strong>
                      <span className="before:mx-1 before:content-['·'] lg:before:hidden">
                        {typeof modalProduct.shelf.zone === "string"
                          ? modalProduct.shelf.zone
                          : modalProduct.shelf.zone?.name || "Khu trưng bày"}
                      </span>
                    </span>
                  </div>
                </div>
              </aside>
              <section className="map-side detail-map-panel min-h-0! lg:col-start-2 lg:row-span-2 lg:row-start-1">
                {detail && (
                  <>
                    <header className="map-heading detail-route-intro mb-2.5! grid! grid-cols-[minmax(0,1fr)_auto]! gap-x-2! gap-y-0.5! lg:mb-[15px]! lg:flex! lg:gap-5!">
                      <div className="contents! lg:block!">
                        <div className="col-start-1 row-start-1 min-w-0 self-start">
                          <span className="section-label block!">
                            ĐƯỜNG ĐI ĐẾN SẢN PHẨM
                          </span>
                          <h2 className="mt-0.5! mb-0! text-[17px]! leading-tight! wrap-break-word lg:my-[6px]! lg:text-[21px]!">
                            {detail.product.shelf.zone?.name} ·{" "}
                            {detail.product.shelf.code}
                          </h2>
                        </div>
                      </div>
                      <span className="walk-time col-start-2! row-start-1! m-0! grid! min-w-0! grid-cols-[16px_auto]! self-start! gap-x-1.5! rounded-lg! px-2! py-1.5! lg:min-w-[145px]! lg:grid-cols-[28px_auto]! lg:rounded-xl! lg:px-3! lg:py-2.5!">
                        <Footprints className="w-4! lg:w-[21px]!" />
                        <strong className="text-[13px] leading-tight whitespace-nowrap lg:text-base">
                          Khoảng 1 phút
                        </strong>
                        <small className="text-[11px] leading-tight lg:text-sm">
                          đi bộ
                        </small>
                      </span>
                    </header>
                    <StoreMap detail={detail} />
                  </>
                )}
                {detailLoading && (
                  <div
                    className="detail-loading"
                    aria-label="Đang tải chỉ đường và truy xuất nguồn gốc"
                  >
                    <span className="detail-skeleton heading" />
                    <span className="detail-skeleton map" />
                    <span className="detail-skeleton row" />
                    <span className="detail-skeleton row" />
                  </div>
                )}
                {detailError && (
                  <div className="detail-error" role="alert">
                    <strong>Chưa tải được chỉ đường</strong>
                    <span>Vui lòng kiểm tra kết nối và thử lại.</span>
                    <button
                      className="button primary"
                      onClick={() => openProduct(selectedProduct!)}
                    >
                      Thử lại
                    </button>
                  </div>
                )}
              </section>
              {detail && (
                <section className="detail-trace-panel flex! min-w-0 flex-col! gap-2! border-t border-[#e8e2d7] bg-[#fbf8f1] p-3 lg:col-start-1 lg:row-start-2 lg:gap-3! lg:border-t lg:border-r lg:p-6">
                  <span className="section-label">TRUY XUẤT NGUỒN GỐC</span>
                  <div className="trace-list mt-0! gap-2! lg:gap-3!">
                    {detail.product.traceability.map((lot) => (
                      <article
                        className="trace-row trace-card block! rounded-xl! border border-[#e3e9e5] bg-white! p-2.5! shadow-[0_6px_18px_rgba(7,82,47,0.04)] lg:p-3.5!"
                        key={lot.batchCode}
                      >
                        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 text-left lg:gap-y-3 [&_dd]:m-0 [&_dt]:m-0">
                          <div className="col-span-2 min-w-0">
                            <dt className="text-[10px] font-black tracking-[0.08em] text-[#77837e] uppercase">
                              Nhà cung cấp
                            </dt>
                            <dd className="mt-0.5 wrap-break-word text-sm leading-snug font-bold text-[#17372d]">
                              {lot.supplier}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[10px] font-black tracking-[0.08em] text-[#77837e] uppercase">
                              Xuất xứ
                            </dt>
                            <dd className="mt-0.5 wrap-break-word text-sm text-[#17372d]">
                              {lot.origin}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[10px] font-black tracking-[0.08em] text-[#77837e] uppercase">
                              Chứng nhận
                            </dt>
                            <dd className="mt-0.5 wrap-break-word text-sm text-[#17372d]">
                              {lot.certificate || "Đã kiểm định"}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[10px] font-black tracking-[0.08em] text-[#77837e] uppercase">
                              Lô
                            </dt>
                            <dd className="mt-0.5 wrap-break-word text-sm font-semibold text-[#17372d]">
                              {lot.batchCode}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-[10px] font-black tracking-[0.08em] text-[#77837e] uppercase">
                              HSD
                            </dt>
                            <dd className="mt-0.5 text-sm text-[#17372d]">
                              {new Intl.DateTimeFormat("vi-VN").format(
                                new Date(lot.expiryDate),
                              )}
                            </dd>
                          </div>
                        </dl>
                        {lot.markdownPercent ? (
                          <span className="mt-3 inline-flex rounded-full bg-[#fff3c4] px-2.5 py-1 text-xs font-bold text-[#8a5a00]">
                            Giảm {lot.markdownPercent}%
                          </span>
                        ) : null}
                      </article>
                    ))}
                  </div>
                  <button
                    className="button primary large map-confirm mt-0! min-h-11! w-full!"
                    onClick={closeDetail}
                  >
                    <CheckCircle2 /> Tôi đã biết đường
                  </button>
                </section>
              )}
            </div>
          </section>
        </div>
      )}
      {cameraOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setCameraOpen(false)
          }
        >
          <section className="modal">
            <button
              className="icon-button modal-close"
              onClick={() => setCameraOpen(false)}
            >
              <X />
            </button>
            <div className="modal-head">
              <span className="section-label">CAMERA SCANNER</span>
              <h2>Quét barcode hoặc QR</h2>
            </div>
            <div className="modal-body">
              <BarcodeScanner
                label="Đưa mã vào giữa khung hình"
                onDetected={(value) => {
                  setCameraOpen(false);
                  setQuery(value);
                  void search(value, true);
                }}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function ProductPrice({
  product,
  detail = false,
}: {
  product: Pick<Product, "priceVnd" | "originalPriceVnd" | "markdownPercent">;
  detail?: boolean;
}) {
  const discounted =
    product.markdownPercent !== null &&
    product.priceVnd < product.originalPriceVnd;
  return (
    <span className={`price-display ${detail ? "detail-product-price" : ""}`}>
      <span className="product-price">{formatVnd(product.priceVnd)}</span>
      {discounted && (
        <>
          <small className="original-price">
            {formatVnd(product.originalPriceVnd)}
          </small>
          <small className="discount-badge">
            Giảm {product.markdownPercent}%
          </small>
        </>
      )}
    </span>
  );
}

function StoreMap({ detail }: { detail: Detail }) {
  const { map, store, product } = detail;
  const pct = (value: number, max: number) => `${(value / max) * 100}%`;
  const points = map.route
    .map((point) => `${point.x + 0.5},${point.y + 0.5}`)
    .join(" ");
  const targetZoneId = product.shelf.zone?.id;
  const routeLength = Math.max(1, map.route.length - 1);
  const gridSize = `${100 / store.mapWidth}% ${100 / store.mapHeight}%`;

  return (
    <div className="store-map-shell">
      <div className="map-toolbar">
        <span>SƠ ĐỒ TẦNG TRỆT</span>
        <span>
          <i /> Tuyến đề xuất · {routeLength} đoạn
        </span>
      </div>
      <div
        className="store-map"
        style={{
          aspectRatio: `${store.mapWidth}/${store.mapHeight}`,
          backgroundSize: gridSize,
        }}
        aria-label={`Sơ đồ đường đi đến ${product.shelf.label}`}
      >
        {map.zones.map((zone) => {
          const isTarget = zone.id === targetZoneId;
          const shelvesInZone = map.shelves.filter(
            (shelf) =>
              shelf.x >= zone.x &&
              shelf.x < zone.x + zone.width &&
              shelf.y >= zone.y &&
              shelf.y < zone.y + zone.height,
          );
          const isVertical = zone.height > 1;
          const isNarrow = isVertical && zone.width === 1;
          const shelvesOnLeft = shelvesInZone.filter(
            (shelf) => shelf.x < zone.x + zone.width / 2,
          ).length;
          const labelSide =
            isVertical && !isNarrow
              ? shelvesOnLeft >= shelvesInZone.length / 2
                ? "label-right"
                : "label-left"
              : "";
          return (
            <span
              key={zone.id}
              className={`map-zone ${isTarget ? "is-target" : ""} ${labelSide} ${isNarrow ? "is-narrow" : ""}`}
              style={{
                left: pct(zone.x, store.mapWidth),
                top: pct(zone.y, store.mapHeight),
                width: pct(zone.width, store.mapWidth),
                height: pct(zone.height, store.mapHeight),
                backgroundColor: zone.color,
              }}
            >
              <span className="map-zone-label">
                <small>{isTarget ? "ĐIỂM ĐẾN" : "KHU VỰC"}</small>
                <strong>{zone.name}</strong>
              </span>
            </span>
          );
        })}
        {map.shelves.map((shelf) => {
          const isTarget = shelf.id === product.shelf.id;
          return (
            <span
              key={shelf.id}
              className={`map-shelf ${isTarget ? "target" : ""}`}
              style={{
                left: pct(shelf.x, store.mapWidth),
                top: pct(shelf.y, store.mapHeight),
                width: pct(Math.max(shelf.width, 1), store.mapWidth),
                height: pct(Math.max(shelf.height, 1), store.mapHeight),
              }}
            >
              <strong>{shelf.code}</strong>
              {isTarget && <small>{shelf.label}</small>}
            </span>
          );
        })}
        <span className="map-facility checkout">QUẦY THANH TOÁN</span>
        <svg
          className="route-line"
          viewBox={`0 0 ${store.mapWidth} ${store.mapHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline className="route-glow" points={points} />
          <polyline className="route-path" points={points} />
        </svg>
        <span
          className="map-marker start"
          style={{
            left: pct(map.start.x + 0.5, store.mapWidth),
            top: pct(map.start.y + 0.5, store.mapHeight),
          }}
        >
          <i />
          <b>Bạn đang ở đây</b>
        </span>
        <span
          className="map-marker destination"
          style={{
            left: pct(map.destination.x + 0.5, store.mapWidth),
            top: pct(map.destination.y + 0.5, store.mapHeight),
          }}
        >
          <i />
          <b>{product.shelf.code}</b>
        </span>
      </div>
      <div className="map-legend">
        <span>
          <i className="you" /> Kiosk hiện tại
        </span>
        <span>
          <i className="route" /> Đường chỉ dẫn
        </span>
        <span>
          <i className="destination" /> {product.shelf.label}
        </span>
      </div>
      <div className="route-steps">
        <span>
          <b>1</b>
          <small>Xuất phát</small>
          <strong>Kiosk lối vào</strong>
        </span>
        <span>
          <b>2</b>
          <small>Đi theo</small>
          <strong>Lối đi chính</strong>
        </span>
        <span>
          <b>3</b>
          <small>Rẽ vào</small>
          <strong>{product.shelf.zone?.name || "Khu trưng bày"}</strong>
        </span>
        <span className="active">
          <b>4</b>
          <small>Điểm đến</small>
          <strong>{product.shelf.label}</strong>
        </span>
      </div>
    </div>
  );
}
