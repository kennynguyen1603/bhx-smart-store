import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminEntityDialog } from "@/components/admin/admin-entity-dialog";
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster, toast } from "@/components/ui/sonner";
import "@/app/globals.css";

const host = document.getElementById("root")!;
function FoundationFixture() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const fallback = useRef<HTMLButtonElement>(null);
  const nonfocusable = useRef<HTMLDivElement>(null);
  const openerRef = host.dataset.opener === "body" ? { current: document.body }
    : host.dataset.opener === "div" ? nonfocusable : opener;
  const dialog = { open, onOpenChange: setOpen, title: "Sửa cửa hàng", description: "Thông tin cửa hàng", onSubmit: async () => true, openerRef, fallbackFocusRef: fallback };
  return <main>
    <button id="opener" ref={opener} onClick={() => setOpen(true)}>Mở biểu mẫu</button>
    <button id="fallback" ref={fallback}>Danh sách cửa hàng</button>
    <div ref={nonfocusable}>Thông tin</div>
    {host.dataset.kind === "confirm" ? <AdminConfirmDialog {...dialog} />
      : <AdminEntityDialog {...dialog}><input aria-label="Tên" defaultValue="BHX Quận 2" /></AdminEntityDialog>}
    <div style={{ width: 160, marginTop: 40 }}>
      <Select><SelectTrigger aria-label="Chọn sản phẩm"><SelectValue placeholder="Sản phẩm" /></SelectTrigger>
        <SelectContent position="popper" style={{ maxHeight: 240 }}>
          {Array.from({ length: 30 }, (_, i) => <SelectItem key={i} value={String(i)}>Sản phẩm {i + 1}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
    <button onClick={() => toast("Đã lưu", { duration: Infinity })}>Hiện thông báo</button>
    <Toaster />
  </main>;
}
createRoot(host).render(<FoundationFixture />);
