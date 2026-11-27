// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử thương hiệu theo bản cài (branding.ts): đọc tệp đúng, bỏ cả tệp khi sai một trường, và mọi kiểu hỏng của
// /branding.json đều rơi về thương hiệu mặc định thay vì chặn lần vẽ đầu.

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRANDING, loadBranding, parseBranding } from "./branding";

const valid = { name: "Cổng số Tỉnh Mẫu", short_name: "Tỉnh Mẫu", logo: "/brand/logo.svg", color: "indigo" };

const respond = (body: string, contentType: string, status = 200): typeof fetch =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } }));

describe("parseBranding", () => {
  it("đọc tệp đúng hợp đồng, logo không bắt buộc", () => {
    expect(parseBranding(valid)).toEqual({
      name: "Cổng số Tỉnh Mẫu",
      shortName: "Tỉnh Mẫu",
      logo: "/brand/logo.svg",
      color: "indigo",
    });
    const { logo: _, ...noLogo } = valid;
    expect(parseBranding(noLogo)).not.toHaveProperty("logo");
  });

  it.each([
    ["logo ở origin khác", { ...valid, logo: "https://cdn.example.org/logo.svg" }],
    ["logo không có máy chủ nhưng khác origin", { ...valid, logo: "//cdn.example.org/brand/logo.svg" }],
    ["logo ngoài /brand/", { ...valid, logo: "/assets/logo.svg" }],
    ["logo thoát khỏi /brand/", { ...valid, logo: "/brand/../index.html" }],
    ["màu không đạt tương phản", { ...valid, color: "teal" }],
    ["thiếu tên ngắn", { name: valid.name, color: "blue" }],
    ["tên chỉ có khoảng trắng", { ...valid, name: "   " }],
    ["trường lạ", { ...valid, theme: "dark" }],
    ["không phải đối tượng", ["Mortise"]],
    ["null", null],
  ])("bỏ cả tệp khi %s", (_, value) => {
    expect(parseBranding(value)).toBeNull();
  });
});

describe("loadBranding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("dùng tệp của bản cài khi đúng", async () => {
    const branding = await loadBranding(respond(JSON.stringify(valid), "application/json"));
    expect(branding.name).toBe("Cổng số Tỉnh Mẫu");
    expect(branding.color).toBe("indigo");
  });

  it("thương hiệu mặc định đọc từ brand/branding.json", () => {
    expect(DEFAULT_BRANDING.name).toBe("Mortise DX");
  });

  it.each([
    // Máy chủ phát triển (và nginx nếu thiếu location riêng) trả index.html với mã 200 cho tệp không có.
    ["trang HTML với mã 200", respond("<!doctype html><html></html>", "text/html")],
    ["404", respond("not found", "text/plain", 404)],
    ["JSON hỏng", respond("{ name: ", "application/json")],
    ["sai hợp đồng", respond(JSON.stringify({ ...valid, color: "yellow" }), "application/json")],
    [
      "lỗi mạng",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ],
  ])("rơi về mặc định khi %s", async (_, fetcher) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadBranding(fetcher as typeof fetch)).toEqual(DEFAULT_BRANDING);
  });
});
