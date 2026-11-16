import type { Metadata } from "next";
import { BarcodePrintButton } from "@/components/barcode-print-button";
import { Ean13Barcode } from "@/components/ean13-barcode";
import { prisma } from "@/lib/db";
import { isValidEan13 } from "@/lib/ean13";

export const metadata: Metadata = { title: "Mã vạch sản phẩm demo" };

export default async function BarcodePage({ searchParams }: { searchParams: Promise<{ storeId?: string | string[] }> }) {
  const query = await searchParams;
  const stores = await prisma.store.findMany({
    where: { active: true }, select: { id: true, code: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const store = stores.find((option) => option.id === query.storeId) ?? stores[0];
  const inventory = store ? await prisma.inventory.findMany({
    where: { storeId: store.id, product: { active: true } },
    select: { id: true, product: { select: { id: true, name: true, sku: true, barcode: true } }, shelf: { select: { code: true, label: true } } },
    orderBy: [{ product: { name: "asc" } }, { shelf: { code: "asc" } }, { id: "asc" }],
  }) : [];
  const sheets = Array.from({ length: Math.ceil(inventory.length / 8) }, (_, index) => inventory.slice(index * 8, index * 8 + 8));
  return (
    <main className="barcode-sheet-page">
      <header className="barcode-toolbar">
        <div><h1>Mã vạch sản phẩm demo</h1><p>In tờ A4 ở tỷ lệ 100% để quét sản phẩm tại kiosk.</p></div>
        <form method="get" action="/demo/barcodes">
          <label htmlFor="barcode-store">Cửa hàng</label>
          <select id="barcode-store" name="storeId" defaultValue={store?.id ?? ""} disabled={!stores.length}>
            {!stores.length && <option value="">Chưa có cửa hàng</option>}
            {stores.map((option) => <option key={option.id} value={option.id}>{option.name} ({option.code})</option>)}
          </select>
          <button type="submit" disabled={!stores.length}>Xem mã vạch</button>
        </form>
        <span>{inventory.length} nhãn</span>
        <BarcodePrintButton disabled={!inventory.some((item) => isValidEan13(item.product.barcode))} />
      </header>
      {!inventory.length && <section className="barcode-empty"><h2>Chưa có sản phẩm để in</h2><p>Hãy gán sản phẩm đang hoạt động vào tồn kho và kệ của cửa hàng trong Admin, rồi tải lại trang hoặc chọn cửa hàng khác.</p></section>}
      {sheets.map((sheet, index) => (
        <section className="barcode-sheet" key={index} aria-label={`Trang mã vạch ${index + 1}`}>
          {sheet.map(({ id, product, shelf }) => (
            <article className="barcode-card" key={id}>
              <h2>{product.name}</h2>
              <p className="barcode-sku">SKU: {product.sku}</p>
              {isValidEan13(product.barcode)
                ? <Ean13Barcode value={product.barcode} height={40} />
                : <p className="barcode-error">Mã EAN-13 không hợp lệ: {product.barcode}</p>}
              <p className="barcode-location">{store!.name} ({store!.code})<br />{shelf.code} · {shelf.label}</p>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
