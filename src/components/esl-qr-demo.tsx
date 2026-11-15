"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

const QR_FALLBACK = "Không thể tạo mã QR lúc này. Hãy dùng mã ESL bên dưới để nhập thủ công.";
type QrEncoder = (code: string, options: { errorCorrectionLevel: "M"; width: number; margin: number }) => Promise<string>;
type QrState = { code: string; dataUrl: string; error: string };

export async function createEslQr(
  code: string,
  encode: QrEncoder = (value, options) => QRCode.toDataURL(value, options),
): Promise<QrState> {
  try {
    return { code, dataUrl: await encode(code, { errorCorrectionLevel: "M", width: 320, margin: 2 }), error: "" };
  } catch {
    return { code, dataUrl: "", error: QR_FALLBACK };
  }
}

export function EslQrDemo({ code }: { code: string }) {
  const [qr, setQr] = useState<QrState>({ code: "", dataUrl: "", error: "" });

  useEffect(() => {
    let current = true;
    void createEslQr(code).then((next) => {
      if (current) setQr(next);
    });
    return () => {
      current = false;
    };
  }, [code]);

  return (
    <section className="esl-qr-demo" aria-label="Nhãn QR ESL">
      <span className="section-label">QR DEMO</span>
      <h3>Quét bằng thiết bị thứ hai</h3>
      {qr.code === code && qr.dataUrl && <img src={qr.dataUrl} alt={`QR cho ${code}`} />}
      {qr.code === code && qr.error && <div className="alert-box danger">{qr.error}</div>}
      <code>{code}</code>
    </section>
  );
}
