import { ArrowRight, Database, MapPinned, Smartphone, Store } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-header"><Logo /><span className="system-online"><i /> Unified Store Data đang hoạt động</span></header>
      <section className="landing-hero">
        <div className="eyebrow">BHX SMART IN-STORE</div>
        <h1>Một cửa hàng.<br /><em>Ba trải nghiệm kết nối.</em></h1>
        <p>Vận hành kệ theo dữ liệu thời gian thực, hỗ trợ khách tìm hàng và quản trị toàn bộ cấu hình cửa hàng trên cùng một nền tảng.</p>
      </section>
      <section className="experience-grid full">
        <Link className="experience-card" href="/login?callbackUrl=/staff">
          <span className="card-number">01</span><span className="card-icon green"><Smartphone /></span>
          <span className="card-copy"><small>Dành cho nhân viên</small><strong>Staff Task PWA</strong><span>Nhiệm vụ ưu tiên, quét ESL, bổ sung hàng và FEFO — có thể làm việc offline.</span></span>
          <span className="card-link">Đăng nhập ứng dụng <ArrowRight /></span>
        </Link>
        <Link className="experience-card" href="/kiosk">
          <span className="card-number">02</span><span className="card-icon yellow"><MapPinned /></span>
          <span className="card-copy"><small>Dành cho khách hàng</small><strong>In-store Kiosk</strong><span>Tìm kiếm, quét barcode, chỉ đường và xem thông tin nguồn gốc.</span></span>
          <span className="card-link">Bắt đầu tìm hàng <ArrowRight /></span>
        </Link>
        <Link className="experience-card" href="/login?callbackUrl=/admin">
          <span className="card-number">03</span><span className="card-icon cream"><Store /></span>
          <span className="card-copy"><small>Dành cho quản lý</small><strong>Store Admin</strong><span>Cấu hình dữ liệu, sơ đồ, FEFO và theo dõi luồng tích hợp.</span></span>
          <span className="card-link">Mở quản trị <ArrowRight /></span>
        </Link>
      </section>
      <footer className="data-flow">
        <span><Database /> <small>SYSTEMS OF RECORD</small><strong>ERP · WMS · POS</strong></span><ArrowRight />
        <span><Database /> <small>UNIFIED DATA LAYER</small><strong>Realtime · FEFO · On-shelf</strong></span><ArrowRight />
        <span><Store /> <small>ENGAGEMENT</small><strong>ESL · Kiosk · Staff</strong></span>
      </footer>
    </main>
  );
}
