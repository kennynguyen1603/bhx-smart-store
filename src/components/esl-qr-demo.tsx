"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function EslQrDemo({ code }: { code: string }) {
  const [qr, setQr] = useState({ code: "", dataUrl: "" });

  useEffect(() => {
    let current = true;
    void QRCode.toDataURL(code, { errorCorrectionLevel: "M", width: 320, margin: 2 })
      .then((url) => {
        if (current) setQr({ code, dataUrl: url });
      });
    return () => {
      current = false;
    };
  }, [code]);

  return (
    <section className="esl-qr-demo" aria-label="Nhãn QR ESL">
      <span className="section-label">QR DEMO</span>
      <h3>Quét bằng thiết bị thứ hai</h3>
      {qr.code === code && <img src={qr.dataUrl} alt={`QR cho ${code}`} />}
      <code>{code}</code>
    </section>
  );
}
