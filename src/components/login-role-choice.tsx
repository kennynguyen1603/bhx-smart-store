import { Home } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { safeAudienceCallback, type LoginAudience } from "@/lib/demo-roles";

export function LoginShell({ children }: { children: ReactNode }) {
  return <main className="auth-page">
    <section className="auth-visual"><strong className="auth-brand">BHX Smart Store</strong><div><h1>Vận hành cửa hàng<br /><em>trong tầm tay.</em></h1><p>Đăng nhập để tiếp tục công việc của bạn.</p></div><small>BHX Smart In-store Operations</small></section>
    <section className="auth-panel">
      <div className="auth-panel-content">
        {children}
        <Link className="button secondary auth-home-link" href="/"><Home aria-hidden="true" />Về trang chủ</Link>
      </div>
    </section>
  </main>;
}

export function LoginRoleChoice({ callbackUrl }: { callbackUrl?: string }) {
  function href(audience: LoginAudience) {
    const destination = safeAudienceCallback(audience, callbackUrl);
    return `/${audience}/login${callbackUrl && destination !== `/${audience}` ? `?callbackUrl=${encodeURIComponent(destination)}` : ""}`;
  }
  return <div className="login-card"><h2 className="login-title">Đăng <em>nhập</em></h2><p>Chọn trang phù hợp với công việc của bạn.</p><nav className="login-role-choice" aria-label="Chọn trang đăng nhập">
    <Link className="button primary large" href={href("staff")}>Tôi là nhân viên / quản lý</Link>
    <Link className="button secondary large" href={href("admin")}>Tôi là quản trị</Link>
  </nav></div>;
}
