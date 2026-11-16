"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import type { ApiMutationResult } from "./admin-types";
import { validateShelfPlacement, type ShelfRect } from "@/lib/shelf-layout";

export type AdminMapStore = {
  id: string;
  mapWidth: number;
  mapHeight: number;
  shelves: (ShelfRect & { code: string; label: string; esls: { ledOn: boolean }[] })[];
};
type Props = { store: AdminMapStore; canEdit: boolean; onMove(shelfId: string, x: number, y: number): Promise<ApiMutationResult> };
type Position = { x: number; y: number };
type Placement = Position & { source: AdminMapStore["shelves"][number] };
type Gesture = { shelfId: string; pointerId: number; start: Position; dragging: boolean; handle: HTMLButtonElement };
const DRAG_THRESHOLD_PX = 6;

export function AdminMapEditor(props: Props) {
  // A different store owns a different gesture and optimistic-update lifecycle.
  return <ShelfMap key={props.store.id} {...props} />;
}

function ShelfMap({ store, canEdit, onMove }: Props) {
  const instructionsId = useId();
  const mapRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const pendingLock = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<(Position & { shelfId: string }) | null>(null);
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const shelves = store.shelves.map((shelf) => {
    const local = placements[shelf.id];
    // Keep a confirmed local move until overview catches up, then trust server data.
    return local && shelf === local.source ? { ...shelf, x: local.x, y: local.y } : shelf;
  });

  function select(id: string | null) {
    selectedRef.current = id;
    setSelected(id);
  }

  function cancelGesture() {
    const active = gesture.current;
    gesture.current = null;
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    setPreview(null);
    select(null);
  }

  function target(clientX: number, clientY: number): Position | null {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return { x: Math.floor((clientX - rect.left) / rect.width * store.mapWidth), y: Math.floor((clientY - rect.top) / rect.height * store.mapHeight) };
  }

  async function move(shelfId: string, position: Position) {
    if (!canEdit || pendingLock.current) return;
    const shelf = shelves.find((item) => item.id === shelfId);
    select(null);
    setPreview(null);
    if (!shelf || (shelf.x === position.x && shelf.y === position.y)) return;
    const validation = validateShelfPlacement({ ...shelf, ...position }, shelves, { width: store.mapWidth, height: store.mapHeight });
    if (!validation.valid) {
      setError(validation.reason === "out-of-bounds" ? "Kệ phải nằm hoàn toàn trong sơ đồ cửa hàng." : "Vị trí này đã có kệ khác.");
      return;
    }
    const original = store.shelves.find((item) => item.id === shelfId)!;
    const previous = placements[shelfId];
    pendingLock.current = true;
    setPending(true);
    setError("");
    setPlacements((current) => ({ ...current, [shelfId]: { ...position, source: original } }));
    try {
      const result = await onMove(shelfId, position.x, position.y).catch((): ApiMutationResult => ({ ok: false, message: "Không thể lưu vị trí kệ. Vui lòng thử lại." }));
      if (result.ok) return;
      setPlacements((current) => {
        const restored = { ...current };
        if (previous) restored[shelfId] = previous;
        else delete restored[shelfId];
        return restored;
      });
      setError(result.message);
    } finally {
      pendingLock.current = false;
      setPending(false);
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, shelfId: string) {
    if (!canEdit || pendingLock.current || gesture.current || event.button !== 0) return;
    suppressClick.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { shelfId, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, dragging: false, handle: event.currentTarget };
    setError("");
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.dragging && Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) < DRAG_THRESHOLD_PX) return;
    active.dragging = true;
    select(active.shelfId);
    const position = target(event.clientX, event.clientY);
    if (position) setPreview({ ...position, shelfId: active.shelfId });
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    if (!active.dragging) return;
    suppressClick.current = true;
    const position = target(event.clientX, event.clientY);
    if (position) void move(active.shelfId, position);
    else cancelGesture();
  }

  function pointerCancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    suppressClick.current = gesture.current.dragging;
    cancelGesture();
  }

  return <div className="admin-map-editor" onKeyDown={(event) => {
    if (event.key === "Escape") { suppressClick.current = !!gesture.current?.dragging; cancelGesture(); setError(""); }
  }}>
    <p id={instructionsId} className="admin-map-instructions">{canEdit ? "Kéo kệ đến ô mới hoặc chạm kệ rồi chạm ô đích. Chạm lại kệ hoặc nhấn Escape để huỷ." : "Sơ đồ chỉ xem. Chỉ Admin được di chuyển kệ."}</p>
    <div ref={mapRef} className="map-grid admin-placement-grid" role="group" aria-label="Sơ đồ vị trí kệ" aria-describedby={instructionsId} aria-busy={pending}
      style={{ gridTemplateColumns: `repeat(${store.mapWidth},minmax(0,1fr))`, gridTemplateRows: `repeat(${store.mapHeight},50px)` }}>
      {Array.from({ length: store.mapWidth * store.mapHeight }, (_, index) => {
        const x = index % store.mapWidth; const y = Math.floor(index / store.mapWidth);
        return <button type="button" className="map-cell" key={index} aria-label={`Ô ${x + 1}, ${y + 1}`} aria-describedby={instructionsId} disabled={!canEdit || pending}
          onClick={() => { if (selectedRef.current) void move(selectedRef.current, { x, y }); }} />;
      })}
      {shelves.map((shelf) => {
        const position = preview?.shelfId === shelf.id ? preview : shelf;
        return <button type="button" key={shelf.id} className="admin-shelf-handle" aria-label={`Kệ ${shelf.code}`} aria-pressed={selected === shelf.id} aria-describedby={instructionsId} disabled={!canEdit || pending}
          style={{ left: `${position.x / store.mapWidth * 100}%`, top: `${position.y / store.mapHeight * 100}%`, width: `${shelf.width / store.mapWidth * 100}%`, height: `${shelf.height / store.mapHeight * 100}%` }}
          onPointerDown={(event) => pointerDown(event, shelf.id)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onLostPointerCapture={pointerCancel}
          onClick={() => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            if (!canEdit || pendingLock.current) return;
            setError(""); select(selectedRef.current === shelf.id ? null : shelf.id);
          }}>{shelf.code}<small>{shelf.esls.some((esl) => esl.ledOn) ? " 🔴" : " 🟢"}</small></button>;
      })}
    </div>
    <p role="status" className="admin-map-status">{pending ? "Đang lưu vị trí kệ…" : selected ? "Đã chọn kệ. Chạm ô đích để di chuyển." : ""}</p>
    {error && <p role="alert" className="admin-map-error">{error}</p>}
  </div>;
}
