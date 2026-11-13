import Link from "next/link";

export function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link href="/" className={`logo ${inverse ? "logo-inverse" : ""}`} aria-label="BHX Smart Store">
      <span className="logo-mark">BHX</span>
      <span><strong>Smart Store</strong><small>Unified operations</small></span>
    </Link>
  );
}
