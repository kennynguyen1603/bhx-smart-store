"use client";

export function EslLabelPrintButton({ disabled = false }: { disabled?: boolean }) {
  return <button className="esl-label-print-button screen-only" type="button" disabled={disabled} onClick={() => window.print()}>In A4</button>;
}
