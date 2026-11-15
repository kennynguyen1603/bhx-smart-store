"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function EslQrDemo({ code }: { code: string }) {
  const [dataUrl, setDataUrl] = useState("");

  useEffect(() => {
    let current = true;
    setDataUrl("");
    void QRCode.toDataURL(code, { errorCorrectionLevel: "M", width: 320, margin: 2 })
      .then((url) => {
        if (current) setDataUrl(url);
      });
    return () => {
      current = false;
    };
  }, [code]);

  return (
    <section className="esl-qr-demo" aria-label="Nhãn QR ESL">
      <span className="section-label">QR DEMO</span>
      <h3>Quét bằng thiết bị thứ hai</h3>
      {dataUrl && <img src={dataUrl} alt={`QR cho ${code}`} />}
      <code>{code}</code>
    </section>
  );
}
