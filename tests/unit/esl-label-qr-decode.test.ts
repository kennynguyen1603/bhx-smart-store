import { createRequire } from "node:module";
import { BrowserQRCodeReader } from "@zxing/browser";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from "@zxing/library";
import { expect, it, vi } from "vitest";
import { encodeEslLabelQr } from "@/lib/esl-labels";

// Encoding must not consult seed data or even instantiate a database client.
vi.mock("@/lib/db", () => ({ prisma: {} }));
const { PNG } = createRequire(import.meta.url)("pngjs") as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};

it("decodes the fixed ESL-LVV-TD-D-13 printable label through the installed scanner", async () => {
  const { dataUrl, error } = await encodeEslLabelQr("ESL-LVV-TD-D-13");
  expect(error).toBe("");
  const png = PNG.sync.read(Buffer.from(dataUrl.split(",")[1], "base64"));
  const pixels = Int32Array.from({ length: png.width * png.height }, (_, index) => {
    const offset = index * 4;
    return (png.data[offset] << 16) | (png.data[offset + 1] << 8) | png.data[offset + 2];
  });
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, png.width, png.height)));
  expect(new BrowserQRCodeReader().decodeBitmap(bitmap).getText()).toBe("ESL-LVV-TD-D-13");
});
