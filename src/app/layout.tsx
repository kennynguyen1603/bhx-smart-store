import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BHX Smart Store", template: "%s · BHX Smart Store" },
  description: "Vận hành kệ hàng thông minh, FEFO và kiosk tìm sản phẩm cho cửa hàng BHX.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "BHX Staff", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#08783f", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
