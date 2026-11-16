"use client";

import { ScanLine, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { EslQrDemo } from "@/components/esl-qr-demo";

export type TaskSummary = {
  id: string;
  type: "RESTOCK" | "FEFO" | "QUARANTINE";
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  priority: "NORMAL" | "MEDIUM" | "HIGH";
  title: string;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  assignee: { id: string; name: string } | null;
  product: { id: string; name: string; emoji: string; basePriceVnd: number };
  shelf: { id: string; code: string; label: string; esls: { code: string }[] };
  lot: null | { batchCode: string; expiryDate: string; quantity: number; origin: string; markdownPercent: number | null; supplier: { name: string } };
  inventory: null | { id: string; onShelf: number; backroom: number; capacity: number; lowThreshold: number; version: number; product: { id: string; name: string; emoji: string }; shelf: { id: string; code: string; label: string } };
};

type EslLookupPayload = {
  esl: { code: string; storeId: string; shelfId: string; productId: string; product: { name: string }; shelf: { label: string } };
  inventory: TaskSummary["inventory"];
  tasks: TaskSummary[];
};

export function EslScannerModal({
  storeId,
  onSelectTask,
  onClose,
}: {
  storeId: string;
  onSelectTask(task: TaskSummary): void;
  onClose(): void;
}) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<EslLookupPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const lookupGeneration = useRef(0);
  const lookupController = useRef<AbortController | null>(null);

  const cancelLookup = useCallback(() => {
    lookupGeneration.current += 1;
    lookupController.current?.abort();
    lookupController.current = null;
  }, []);

  useEffect(() => cancelLookup, [cancelLookup]);

  function close() {
    cancelLookup();
    onClose();
  }

  async function lookup(value = code) {
    const normalized = value.trim();
    if (!normalized) return;
    const generation = ++lookupGeneration.current;
    lookupController.current?.abort();
    const controller = new AbortController();
    lookupController.current = controller;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/esl/${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const payload = await response.json() as EslLookupPayload;
      if (payload.esl.storeId !== storeId) throw new Error();
      if (generation !== lookupGeneration.current) return;
      setCode(payload.esl.code);
      setResult(payload);
    } catch {
      if (generation === lookupGeneration.current) setError("Mã ESL không tồn tại hoặc thuộc cửa hàng khác.");
    } finally {
      if (generation === lookupGeneration.current) {
        lookupController.current = null;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void lookup();
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="modal esl-scanner-modal">
        <button className="icon-button modal-close" onClick={close} aria-label="Đóng tra cứu ESL"><X /></button>
        <header className="modal-head"><h2>Tra cứu ESL</h2><p>Quét nhãn hoặc nhập mã thiết bị để xem nhiệm vụ đang mở.</p></header>
        <div className="modal-body">
          <BarcodeScanner label="Quét mã ESL" onDetected={(value) => { setCode(value); void lookup(value); }} />
          <form className="manual-scan esl-lookup-form" onSubmit={submit}>
            <input className="form-control" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ví dụ: ESL-NT-Q5-L-02" aria-label="Mã ESL tra cứu" />
            <button className="button primary" disabled={!code.trim()}><ScanLine />{loading ? "Đang tra cứu" : "Tra cứu"}</button>
          </form>
          {error && <div className="alert-box danger">{error}</div>}
          {result && <div className="esl-lookup-result">
            <div className="product-summary"><span>🏷️</span><span><small>{result.esl.shelf.label}</small><strong>{result.esl.product.name}</strong><small>{result.esl.code}</small></span></div>
            {result.tasks.length === 0 && <div className="empty-state">Không có nhiệm vụ đang mở</div>}
            {result.tasks.length > 0 && <section className="esl-task-choices"><h3>Chọn nhiệm vụ cần mở</h3>{result.tasks.map((task) => <button className="task-row" key={task.id} onClick={() => onSelectTask(task)}><span className="task-copy"><strong>{task.title}</strong><span>{task.type} · {task.status}</span></span><span>Mở nhiệm vụ</span></button>)}</section>}
            <EslQrDemo code={result.esl.code} />
          </div>}
        </div>
      </section>
    </div>
  );
}
