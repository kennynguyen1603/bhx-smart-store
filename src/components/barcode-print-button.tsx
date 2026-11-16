"use client";

export function BarcodePrintButton({ disabled = false }: { disabled?: boolean }) {
  return <button className="barcode-print-button" type="button" disabled={disabled} onClick={() => window.print()}>In A4</button>;
}
