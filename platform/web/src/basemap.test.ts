// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử nền bản đồ của bản cài (basemap.ts): basemap.json sai thì bỏ cả tệp; kiểu vẽ không chữ thật sự không có
// lớp chữ, khối nhà hay ranh giới và không cần tệp phông; bật chữ thì chỉ thêm tên, không thêm lớp cần ảnh biểu tượng;
// mọi kiểu thiếu hay hỏng của basemap.json đều rơi về nền trơn thay vì ném lỗi.

import type { Protocol } from "pmtiles";
import { describe, expect, it, vi } from "vitest";
import { basemapLayers, basemapStyle, loadBasemap, parseBasemap } from "./basemap";

const respond = (body: string, contentType: string, status = 200): typeof fetch =>
  vi.fn(async () => new Response(body, { status, headers: { "content-type": contentType } }));

const protocol = { add: vi.fn() } as unknown as Protocol;

describe("parseBasemap", () => {
  it("đọc tệp đúng, chữ mặc định tắt", () => {
    expect(parseBasemap({ tiles: "region.pmtiles" })).toEqual({ tiles: "region.pmtiles", labels: false });
    expect(parseBasemap({ tiles: "region.pmtiles", labels: true })).toEqual({ tiles: "region.pmtiles", labels: true });
  });

  it.each([
    ["tệp ở origin khác", { tiles: "https://tiles.example.org/region.pmtiles" }],
    ["tệp ngoài /basemap/", { tiles: "../index.html" }],
    ["không phải PMTiles", { tiles: "region.mbtiles" }],
    ["labels không phải true, false", { tiles: "region.pmtiles", labels: "yes" }],
    ["trường lạ", { tiles: "region.pmtiles", sprite: "/basemap/sprite" }],
    ["không phải đối tượng", ["region.pmtiles"]],
    ["null", null],
  ])("bỏ cả tệp khi %s", (_, value) => {
    expect(parseBasemap(value)).toBeNull();
  });
});

const sourceLayers = (labels: boolean) =>
  new Set(basemapLayers(labels).map((layer) => ("source-layer" in layer ? layer["source-layer"] : undefined)));

describe("basemapStyle", () => {
  it("tắt chữ: không lớp symbol, không khối nhà, ranh giới, điểm quan tâm, không phông hay ảnh biểu tượng", () => {
    const style = basemapStyle({ tiles: "region.pmtiles", labels: false }, "https://mortise.example");
    expect(style.layers.filter((layer) => layer.type === "symbol")).toEqual([]);
    for (const hidden of ["buildings", "boundaries", "pois", "places"])
      expect(sourceLayers(false)).not.toContain(hidden);
    for (const kept of ["earth", "landuse", "water", "roads"]) expect(sourceLayers(false)).toContain(kept);
    expect(style).not.toHaveProperty("glyphs");
    expect(style).not.toHaveProperty("sprite");
    expect(style.sources).toEqual({
      basemap: { type: "vector", url: "pmtiles://https://mortise.example/basemap/region.pmtiles" },
    });
  });

  it("bật chữ: thêm tên địa danh, phông cùng origin; vẫn không khối nhà, ranh giới, điểm quan tâm, ảnh biểu tượng", () => {
    const style = basemapStyle({ tiles: "region.pmtiles", labels: true }, "https://mortise.example");
    const symbols = style.layers.filter((layer) => layer.type === "symbol");
    expect(symbols.length).toBeGreaterThan(0);
    expect(sourceLayers(true)).toContain("places");
    for (const hidden of ["buildings", "boundaries", "pois"]) expect(sourceLayers(true)).not.toContain(hidden);
    for (const layer of symbols) expect(layer.layout?.["icon-image"]).toBeUndefined();
    expect(style.glyphs).toBe("https://mortise.example/basemap/fonts/{fontstack}/{range}.pbf");
    expect(style).not.toHaveProperty("sprite");
  });
});

describe("loadBasemap", () => {
  it.each([
    ["chưa chạy make basemap (404)", respond("not found", "text/html", 404)],
    ["máy chủ phát triển trả index.html", respond("<!doctype html>", "text/html")],
    ["JSON hỏng", respond("{", "application/json")],
    ["JSON sai định dạng", respond('{"tiles": "https://x.example/a.pmtiles"}', "application/json")],
    [
      "mạng lỗi",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ],
  ])("trả null để vẽ nền trơn khi %s", async (_, fetcher) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(loadBasemap(protocol, fetcher as typeof fetch)).resolves.toBeNull();
  });
});
