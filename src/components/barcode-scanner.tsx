"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff } from "lucide-react";
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
    <div className="scan-area">
      {active && <video ref={videoRef} muted playsInline />}
      <button type="button" className="button" onClick={active ? stop : start}>{active ? <><CameraOff /> Tắt camera</> : <><Camera /> {label}</>}</button>
      {error && <div className="alert-box danger">{error}</div>}
    </div>
  );
}
