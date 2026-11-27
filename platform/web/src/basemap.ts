// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nền bản đồ tự lưu trữ của bản cài (ADR 0056): tệp PMTiles cắt từ dữ liệu OpenStreetMap lúc cài (`make basemap`),
// nằm trong /basemap/ cùng origin với basemap.json mô tả nó. Tệp này đọc basemap.json, mở phần đầu của tệp PMTiles và
// dựng kiểu vẽ cho MapLibre; MapCanvas.tsx dùng kết quả, không có thì vẽ nền trơn như ADR 0024.

import { layers, namedFlavor } from "@protomaps/basemaps";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { PMTiles, type Protocol, TileType } from "pmtiles";

/** Nội dung basemap.json do `make basemap` ghi: tên tệp PMTiles trong /basemap/ và có hiện chữ địa danh hay không. */
export type Basemap = { tiles: string; labels: boolean };

/** Kiểu vẽ và mức phóng nhỏ nhất có dữ liệu, đọc từ phần đầu của tệp PMTiles. */
export type LoadedBasemap = { style: StyleSpecification; minZoom: number; center: [number, number] };

export const BASEMAP_DIR = "/basemap/";

// Tên nguồn trong kiểu vẽ; các lớp của @protomaps/basemaps trỏ tới nguồn theo tên này.
const SOURCE = "basemap";

// Chỉ nhận tên tệp trong /basemap/, không nhận đường dẫn hay địa chỉ khác: CSP chỉ cho tải dữ liệu cùng origin, và
// một địa chỉ ngoài sẽ làm bản đồ cần internet.
const TILES = /^[A-Za-z0-9][A-Za-z0-9._-]*\.pmtiles$/;

// Lớp dữ liệu luôn ẩn. Khối nhà: điểm của gói phải nằm trên nền không chỉ ra được công trình có thật nào. Ranh giới
// hành chính: gói tự vẽ ranh giới của mình (ADR 0020), hai bộ ranh giới chồng nhau thì người xem không biết tin bộ nào.
const HIDDEN_SOURCE_LAYERS = new Set(["buildings", "boundaries"]);

/** Đọc basemap.json; sai một trường là bỏ cả tệp, bản đồ dùng nền trơn. */
export function parseBasemap(value: unknown): Basemap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { tiles, labels, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof tiles !== "string" || !TILES.test(tiles)) return null;
  if (labels !== undefined && typeof labels !== "boolean") return null;
  return { tiles, labels: labels === true };
}

const sourceLayerOf = (layer: LayerSpecification) =>
  "source-layer" in layer ? (layer["source-layer"] as string | undefined) : undefined;

/**
 * Các lớp của kiểu vẽ "light" trong @protomaps/basemaps, bỏ khối nhà và ranh giới. Tắt chữ thì bỏ mọi lớp symbol, nên
 * kiểu vẽ không cần tệp phông (glyphs). Bật chữ thì giữ tên địa danh, đường, sông nhưng bỏ lớp cần ảnh biểu tượng
 * (điểm quan tâm, biển số đường, mũi tên một chiều): bản cài không có bộ ảnh biểu tượng (sprite).
 */
export function basemapLayers(labels: boolean): LayerSpecification[] {
  const all = layers(SOURCE, namedFlavor("light"), labels ? { lang: "vi" } : undefined) as LayerSpecification[];
  return all.filter((layer) => {
    const sourceLayer = sourceLayerOf(layer);
    if (sourceLayer && HIDDEN_SOURCE_LAYERS.has(sourceLayer)) return false;
    if (layer.type !== "symbol") return true;
    return labels && sourceLayer !== "pois" && layer.layout?.["icon-image"] === undefined;
  });
}

/** Kiểu vẽ đầy đủ. Phông chữ chỉ khai khi bật chữ, và cũng nằm trong /basemap/ cùng origin. */
export function basemapStyle(basemap: Basemap, origin: string): StyleSpecification {
  return {
    version: 8,
    ...(basemap.labels ? { glyphs: `${origin}${BASEMAP_DIR}fonts/{fontstack}/{range}.pbf` } : {}),
    sources: { [SOURCE]: { type: "vector", url: `pmtiles://${origin}${BASEMAP_DIR}${basemap.tiles}` } },
    layers: basemapLayers(basemap.labels),
  };
}

/**
 * Đọc nền của bản cài; không có hay hỏng thì trả null để bản đồ vẽ nền trơn. Không bao giờ ném lỗi: nền là phần thêm,
 * điểm và danh sách điểm vẫn phải hiện. Thiếu tệp thì nginx trả 404, còn máy chủ phát triển của Vite trả index.html với
 * mã 200, nên kiểm loại nội dung trước khi đọc JSON.
 */
export async function loadBasemap(protocol: Protocol, fetcher: typeof fetch = fetch): Promise<LoadedBasemap | null> {
  try {
    const response = await fetcher(`${BASEMAP_DIR}basemap.json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null;
    const basemap = parseBasemap(await response.json());
    if (!basemap) {
      console.warn(`${BASEMAP_DIR}basemap.json sai định dạng; vẽ nền trơn. Chạy lại make basemap để ghi lại tệp.`);
      return null;
    }
    const origin = window.location.origin;
    const archive = new PMTiles(`${origin}${BASEMAP_DIR}${basemap.tiles}`);
    const header = await archive.getHeader();
    if (header.tileType !== TileType.Mvt) {
      console.warn(`${BASEMAP_DIR}${basemap.tiles} không phải tile vector; vẽ nền trơn.`);
      return null;
    }
    // Đăng ký với giao thức pmtiles:// để MapLibre dùng lại phần đầu vừa đọc, không tải lại.
    protocol.add(archive);
    return {
      style: basemapStyle(basemap, origin),
      minZoom: header.minZoom,
      center: [header.centerLon, header.centerLat],
    };
  } catch (error) {
    console.warn("Không đọc được nền bản đồ; vẽ nền trơn.", error);
    return null;
  }
}
