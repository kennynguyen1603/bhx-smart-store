"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { DEMO_ACCOUNTS, demoDestinationForEmail } from "@/lib/demo-roles";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("staff@demo.bhx");
  const [password, setPassword] = useState("Demo@123");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    const isDemoAccount = DEMO_ACCOUNTS.some((account) => account.email === email.trim().toLowerCase());
    const callbackUrl = isDemoAccount ? demoDestinationForEmail(email) : searchParams.get("callbackUrl") || demoDestinationForEmail(email);
    const result = await signIn("credentials", { email, password, redirect: false, callbackUrl });
    setLoading(false);
    if (result?.error) setError("Email hoặc mật khẩu không đúng.");
    else window.location.href = result?.url || callbackUrl;
  }

  return (
    <div className="login-card">
      <h2>Chào mừng trở lại</h2><p>Chọn vai trò demo để tiếp tục.</p>
      <div className="account-chips">{DEMO_ACCOUNTS.map((account) => <button type="button" key={account.email} className={email === account.email ? "active" : ""} aria-pressed={email === account.email} onClick={() => setEmail(account.email)}>{account.label} — {account.description}</button>)}</div>
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
