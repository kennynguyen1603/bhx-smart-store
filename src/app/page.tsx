import { ArrowRight, MapPinned, Smartphone } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-header"><Logo /><span className="system-online"><i /> Dữ liệu cửa hàng đang đồng bộ</span></header>
      <section className="landing-hero">
        <h1>Hai trải nghiệm, một nền dữ liệu</h1>
        <p>Nhân viên xử lý nhiệm vụ và theo dõi tình trạng kệ. Khách hàng tìm sản phẩm và đường đến kệ trên cùng dữ liệu cửa hàng.</p>
      </section>
      <section className="experience-grid" aria-label="Trải nghiệm chính">
        <Link className="experience-card" href="/login?callbackUrl=/staff">
          <span className="card-number">01</span><span className="card-icon green"><Smartphone /></span>
          <span className="card-copy"><small>Dành cho nhân viên và quản lý</small><strong>Ứng dụng nhân viên</strong><span>Nhiệm vụ ưu tiên, quét ESL, bổ sung hàng và FEFO — có thể làm việc offline.</span></span>
          <span className="card-link">Đăng nhập ứng dụng <ArrowRight /></span>
        </Link>
        <Link className="experience-card" href="/kiosk">
          <span className="card-number">02</span><span className="card-icon yellow"><MapPinned /></span>
          <span className="card-copy"><small>Dành cho khách hàng</small><strong>Kiosk khách hàng</strong><span>Tìm kiếm, quét barcode, chỉ đường và xem thông tin nguồn gốc.</span></span>
          <span className="card-link">Bắt đầu tìm hàng <ArrowRight /></span>
        </Link>
      </section>
      <nav className="demo-links" aria-label="Demo bổ trợ">
        <Link href="/login?callbackUrl=/admin">Backoffice quản trị</Link>
        <Link href="/demo/esl-labels">Nhãn ESL demo</Link>
      </nav>
    </main>
  );
}
