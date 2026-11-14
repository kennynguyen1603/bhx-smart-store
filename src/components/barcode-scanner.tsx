"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Camera, CameraOff, LoaderCircle, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function BarcodeScanner({ onDetected, label = "Bật camera" }: { onDetected(value: string): void; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    startingRef.current = false;
    controlsRef.current?.stop();
    controlsRef.current = null;

    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    if (mountedRef.current) {
      setActive(false);
      setStarting(false);
      setReady(false);
    }
  }, []);

  async function start() {
    if (startingRef.current || active) return;

    const video = videoRef.current;
    if (!video) {
      setError("Không thể khởi tạo khung camera. Vui lòng đóng và mở lại trình quét.");
      return;
    }

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Trình duyệt không hỗ trợ camera trong ngữ cảnh hiện tại. Hãy mở trang bằng HTTPS.");
      return;
    }

    startingRef.current = true;
    setError("");
    setStarting(true);
    setReady(false);
    setActive(true);

    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result) => {
          if (!result) return;
          const value = result.getText().trim();
          if (!value) return;
          onDetected(value);
          stop();
        },
      );

      if (!mountedRef.current || !startingRef.current) {
        controls.stop();
        return;
      }

      controlsRef.current = controls;
      startingRef.current = false;
      setStarting(false);
      await video.play().catch(() => undefined);
      setReady(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    } catch (cause) {
      startingRef.current = false;
      const name = cause instanceof DOMException ? cause.name : "";
      const message =
        name === "NotAllowedError"
          ? "Camera đang bị chặn. Hãy cho phép quyền camera trong cài đặt trình duyệt rồi thử lại."
          : name === "NotFoundError"
            ? "Không tìm thấy camera trên thiết bị này."
            : name === "NotReadableError"
              ? "Camera đang được ứng dụng khác sử dụng. Hãy đóng ứng dụng đó rồi thử lại."
              : "Không khởi động được camera. Hãy thử tải lại trang hoặc nhập mã thủ công.";
      setError(message);
      stop();
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    const video = videoRef.current;
    return () => {
      mountedRef.current = false;
      controlsRef.current?.stop();
      controlsRef.current = null;
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className={`scan-area ${active ? "is-active" : ""}`}>
      <div className="scan-heading">
        <span className="scan-heading-icon"><ScanLine /></span>
        <span><strong>{active ? (ready ? "Đang tìm mã" : "Đang mở camera") : label}</strong><small>{active ? (ready ? "Giữ thiết bị ổn định trong khung" : "Vui lòng chờ hình ảnh camera xuất hiện") : "Camera chỉ hoạt động khi bạn cho phép"}</small></span>
        <span className={`scan-status ${ready ? "active" : ""}`}><i />{active ? (ready ? "Đang quét" : "Đang mở") : "Sẵn sàng"}</span>
      </div>
      <div className="scanner-viewport">
        <video
          ref={videoRef}
          className={active ? "is-visible" : ""}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: active ? 1 : 0, visibility: active ? "visible" : "hidden" }}
          muted
          autoPlay
          playsInline
          onLoadedData={() => setReady(true)}
          onPlaying={() => setReady(true)}
        />
        {!active && <div className="scanner-placeholder" style={{ position: "absolute", inset: 0, alignContent: "center" }}><Camera /><strong>Quét nhanh bằng camera</strong><small>Đặt mã ESL hoặc barcode vào giữa khung hình</small></div>}
        {active && !ready && <div className="scanner-loading" aria-live="polite" style={{ position: "absolute", inset: 0, zIndex: 2, display: "grid", placeItems: "center", alignContent: "center", gap: 10, color: "white", background: "rgba(4,38,24,.82)" }}><LoaderCircle className="spin" /><strong style={{ fontSize: 9 }}>Đang khởi động camera…</strong></div>}
        {active && ready && <div className="scanner-frame" aria-hidden="true" style={{ zIndex: 3 }}><i /><i /><i /><i /><span>ĐƯA MÃ VÀO KHUNG</span></div>}
      </div>
      <button type="button" className={`button scan-toggle ${active ? "" : "primary"}`} onClick={active ? stop : start} disabled={starting}>{active ? <><CameraOff /> Tắt camera</> : <><Camera /> Mở camera</>}</button>
      {error && <div className="alert-box danger">{error}</div>}
    </div>
  );
}
