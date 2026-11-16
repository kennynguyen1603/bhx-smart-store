import { encodeEan13Modules } from "@/lib/ean13";

export function Ean13Barcode({ value, height = 60, showText = true }: { value: string; height?: number; showText?: boolean }) {
  const modules = encodeEan13Modules(value);
  // Eleven white modules on each side preserve quiet zones when printed.
  const width = 117;
  const svgHeight = height + (showText ? 18 : 5);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${svgHeight}`} width={351} height={svgHeight * 3} role="img" aria-label={`Mã vạch EAN-13 ${value}`}>
      <rect x={0} y={0} width={width} height={svgHeight} fill="#fff" />
      <g shapeRendering="crispEdges" aria-hidden="true">
        {modules.map((bar, index) => bar && <rect key={index} x={index + 11} y={0} width={1} height={height + (index < 3 || (index >= 45 && index < 50) || index >= 92 ? 5 : 0)} fill="#000" />)}
      </g>
      {showText && <text x={width / 2} y={height + 16} textAnchor="middle" fontFamily="monospace" fontSize={10} fill="#000" aria-hidden="true">{value}</text>}
    </svg>
  );
}
