import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <Logo inverse />
        <div><span className="eyebrow light">NHÂN VIÊN NỘI BỘ</span><h1>Dữ liệu đúng.<br />Nhiệm vụ đúng.<br /><em>Đúng thời điểm.</em></h1><p>Đăng nhập để truy cập cửa hàng được phân công và đồng bộ công việc của bạn.</p></div>
        <small>BHX Smart In-store Operations</small>
      </section>
      <section className="auth-panel"><Suspense fallback={<p>Đang tải biểu mẫu đăng nhập…</p>}><LoginForm /></Suspense></section>
    </main>
  );
}
