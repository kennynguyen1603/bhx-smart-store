import type { Metadata } from "next";
import { KioskApp } from "@/components/kiosk-app";

export const metadata: Metadata = { title: "Kiosk tìm sản phẩm" };

export default function KioskPage() { return <KioskApp />; }
