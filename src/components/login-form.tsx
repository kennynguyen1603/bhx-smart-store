"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

const accounts = [
  ["Staff", "staff@demo.bhx"],
  ["Manager", "manager@demo.bhx"],
  ["Admin", "admin@demo.bhx"],
] as const;

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("staff@demo.bhx");
  const [password, setPassword] = useState("Demo@123");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const callbackUrl = searchParams.get("callbackUrl") || (email.startsWith("staff") ? "/staff" : "/admin");
    const result = await signIn("credentials", { email, password, redirect: false, callbackUrl });
    setLoading(false);
    if (result?.error) setError("Email hoặc mật khẩu không đúng.");
    else window.location.href = result?.url || callbackUrl;
  }

  return (
    <div className="login-card">
      <span className="eyebrow">ĐĂNG NHẬP BẢO MẬT</span><h2>Chào mừng trở lại</h2><p>Dùng một trong các tài khoản demo để tiếp tục.</p>
      <div className="account-chips">{accounts.map(([label, value]) => <button type="button" key={value} className={email === value ? "active" : ""} onClick={() => setEmail(value)}>{label}</button>)}</div>
      <form onSubmit={submit}>
        <label>Email<div className="input-wrap"><Mail /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></label>
        <label>Mật khẩu<div className="input-wrap"><LockKeyhole /><input type={visible ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" onClick={() => setVisible(!visible)} aria-label="Hiện mật khẩu">{visible ? <EyeOff /> : <Eye />}</button></div></label>
        {error && <div className="form-error">{error}</div>}
        <button className="button primary large" disabled={loading}>{loading ? <><LoaderCircle className="spin" /> Đang đăng nhập…</> : "Đăng nhập"}</button>
      </form>
      <div className="demo-note"><strong>Mật khẩu demo</strong><code>Demo@123</code></div>
    </div>
  );
}
