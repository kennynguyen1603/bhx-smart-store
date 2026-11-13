"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function BarcodeScanner({ onDetected, label = "Bật camera" }: { onDetected(value: string): void; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setError(""); setActive(true);
    try {
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result) { onDetected(result.getText()); stop(); }
      });
    } catch {
      setError("Không truy cập được camera. Hãy nhập mã thủ công hoặc dùng scanner HID.");
      setActive(false);
    }
  }

  function stop() {
    controlsRef.current?.stop(); controlsRef.current = null; setActive(false);
  }

  useEffect(() => stop, []);
  return (
    <div className={`scan-area ${active ? "is-active" : ""}`}>
      <div className="scan-heading">
        <span className="scan-heading-icon"><ScanLine /></span>
        <span><strong>{active ? "Đang tìm mã" : label}</strong><small>{active ? "Giữ thiết bị ổn định trong khung" : "Camera chỉ hoạt động khi bạn cho phép"}</small></span>
        <span className={`scan-status ${active ? "active" : ""}`}><i />{active ? "Đang quét" : "Sẵn sàng"}</span>
      </div>
      <div className="scanner-viewport">
        {active ? <video ref={videoRef} muted playsInline /> : <div className="scanner-placeholder"><Camera /><strong>Quét nhanh bằng camera</strong><small>Đặt mã ESL hoặc barcode vào giữa khung hình</small></div>}
        {active && <div className="scanner-frame" aria-hidden="true"><i /><i /><i /><i /><span>ĐƯA MÃ VÀO KHUNG</span></div>}
      </div>
      <button type="button" className={`button scan-toggle ${active ? "" : "primary"}`} onClick={active ? stop : start}>{active ? <><CameraOff /> Tắt camera</> : <><Camera /> Mở camera</>}</button>
      {error && <div className="alert-box danger">{error}</div>}
    </div>
  );
}
