import { describe, expect, it, vi } from "vitest";
import { createEslQr } from "@/components/esl-qr-demo";

describe("createEslQr", () => {
  it("returns a controlled Vietnamese fallback when QR generation rejects", async () => {
    const encode = vi.fn().mockRejectedValue(new Error("canvas unavailable"));

    const result = await createEslQr("ESL-NT-Q5-T-01", encode);

    expect(result).toEqual({
      code: "ESL-NT-Q5-T-01",
      dataUrl: "",
      error: "Không thể tạo mã QR lúc này. Hãy dùng mã ESL bên dưới để nhập thủ công.",
    });
  });
});
