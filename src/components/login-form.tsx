"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { FormEvent, useState } from "react";
import { isRoleAllowedForAudience, safeAudienceCallback, safeAudienceTaskCallback, type LoginAudience } from "@/lib/demo-roles";

export function LoginForm({ audience, callbackUrl }: { audience: LoginAudience; callbackUrl?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [correctLogin, setCorrectLogin] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setError(""); setCorrectLogin(undefined);
    const destination = safeAudienceCallback(audience, callbackUrl);
    let signedIn = false;
    try {
      const result = await signIn("credentials", { email, password, redirect: false, callbackUrl: destination });
      if (!result?.ok || result.error) {
        setError("Email hoặc mật khẩu không đúng.");
        return;
      }
      signedIn = true;
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Session verification failed");
      const session: Partial<Session> = await response.json();
      const role = session?.user?.role;
      if (!role || !["STAFF", "MANAGER", "ADMIN"].includes(role)) throw new Error("Missing session role");
      if (!isRoleAllowedForAudience(role, audience)) {
        await signOut({ redirect: false });
        signedIn = false;
        setError("Tài khoản không có vai trò phù hợp với trang này. Vui lòng dùng trang đăng nhập bên dưới.");
        const correctAudience = role === "STAFF" ? "staff" : "admin";
        const recovered = safeAudienceTaskCallback(correctAudience, callbackUrl);
        setCorrectLogin(`/${correctAudience}/login${recovered !== `/${correctAudience}` ? `?callbackUrl=${encodeURIComponent(recovered)}` : ""}`);
        return;
      }
      window.location.href = destination;
    } catch {
      if (signedIn) {
        try { await signOut({ redirect: false }); } catch { /* Stay on the form when cleanup cannot complete. */ }
      }
      setError("Không thể xác minh đăng nhập. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-card">
      <h2 className="login-title">Đăng <em>nhập</em></h2>
      <form onSubmit={submit}>
        <label>Email<div className="input-wrap"><Mail /><input type="email" name="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></label>
        <label>Mật khẩu<div className="input-wrap"><LockKeyhole /><input type={visible ? "text" : "password"} name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{visible ? <EyeOff /> : <Eye />}</button></div></label>
        {error && <div className="form-error" role="alert">{error}{correctLogin && <a href={correctLogin}>Đăng nhập {correctLogin.startsWith("/staff/login") ? "nhân viên / quản lý" : "quản trị"}</a>}</div>}
        <button className="button primary large" disabled={loading}>{loading ? <><LoaderCircle className="spin" /> Đang đăng nhập…</> : "Đăng nhập"}</button>
      </form>
    </div>
  );
}
