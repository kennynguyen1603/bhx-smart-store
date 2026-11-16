import type { Metadata } from "next";
import { EslLabelPrintButton } from "@/components/esl-label-print-button";
import { loadEslLabels } from "@/lib/esl-labels";

export const metadata: Metadata = { title: "Nhãn ESL để in" };

export default async function EslLabelsPage({ searchParams }: { searchParams: Promise<{ storeId?: string | string[] }> }) {
  const query = await searchParams;
  const { stores, selectedStoreId, labels } = await loadEslLabels(typeof query.storeId === "string" ? query.storeId : undefined);
  const sheets = Array.from({ length: Math.ceil(labels.length / 4) }, (_, index) => labels.slice(index * 4, index * 4 + 4));

  return (
    <main className="esl-label-page">
      <header className="esl-label-toolbar screen-only">
        <div>
          <h1>Nhãn ESL để in</h1>
          <p>In nhãn A4 để quét mã ESL bằng thiết bị thứ hai.</p>
        </div>
        <form method="get" action="/demo/esl-labels">
          <label htmlFor="esl-label-store">Cửa hàng</label>
          <select id="esl-label-store" name="storeId" defaultValue={selectedStoreId ?? ""} disabled={!stores.length}>
            {!stores.length && <option value="">Chưa có cửa hàng</option>}
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
          </select>
          <button type="submit" disabled={!stores.length}>Xem nhãn</button>
        </form>
        <span className="esl-label-count">{labels.length} nhãn</span>
        <EslLabelPrintButton disabled={!labels.length} />
      </header>

      {!labels.length && (
        <section className="esl-label-empty">
          <h2>Chưa có nhãn ESL để in</h2>
          <p>Trong Admin, hãy tạo cửa hàng đang hoạt động, kệ và sản phẩm, rồi gán ESL cho đúng cửa hàng, kệ và sản phẩm. Sau đó tải lại trang hoặc chọn cửa hàng khác.</p>
        </section>
      )}

      {sheets.map((sheet, index) => (
        <section className="esl-label-sheet" key={index} aria-label={`Trang nhãn ${index + 1}`}>
          {sheet.map((label) => (
            <article className="esl-label-card" key={label.id}>
              <div className="esl-label-qr">
                {label.dataUrl
                  ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Server-generated QR data URLs need no image optimization.
                    <img src={label.dataUrl} width={320} height={320} alt={`QR cho ${label.code}`} />
                  )
                  : <p className="esl-label-qr-error">{label.error}</p>}
              </div>
              <h2 className="esl-label-code">{label.code}</h2>
              <p className="esl-label-product">{label.product.name}</p>
              <p className="esl-label-location">{label.shelf.code} · {label.shelf.label}<br />{label.store.name} ({label.store.code})</p>
              <div className="esl-label-badges">
                {label.badges.length
                  ? label.badges.map((badge) => <span className="esl-label-badge" key={badge}>{badge}</span>)
                  : <span className="esl-label-no-task">Không có nhiệm vụ</span>}
              </div>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
