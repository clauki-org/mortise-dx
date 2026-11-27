// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử vùng cố định của bản đồ (mapAreas.ts): đa giác khép kín cho GeoJSON, chỗ đặt tên vùng, điểm trong hay ngoài
// vùng, khung căn theo điểm và các vùng có điểm, và lớp của vùng nằm sau lớp nền.

import type { StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { areaCenter, areasGeoJSON, contains, framePositions, withAreas } from "./mapAreas";
import type { Areas, Point, Position } from "./mapConfig";

const square = (x: number, y: number): Position[] => [
  [x, y],
  [x + 1, y],
  [x + 1, y + 1],
  [x, y + 1],
];

const areas: Areas = {
  label: "Ranh giới",
  color: "indigo",
  items: [
    { name: "Vùng 1", outline: square(0, 0) },
    { name: "Vùng 2", outline: square(1, 0) },
  ],
};

const point = (longitude: number, latitude: number) =>
  ({ key: `${longitude}`, longitude, latitude, title: "", color: "red", colorLabel: "", row: {} }) as unknown as Point;

describe("mapAreas", () => {
  it("khép kín đa giác và giữ tên vùng", () => {
    const feature = areasGeoJSON(areas).features[0];
    expect(feature?.properties).toEqual({ name: "Vùng 1" });
    expect(feature?.geometry.coordinates[0]).toEqual([...square(0, 0), [0, 0]]);
  });

  it("đặt tên ở trọng tâm diện tích, không bị nhiều đỉnh trên một cạnh kéo lệch", () => {
    expect(areaCenter(square(2, 4))).toEqual([2.5, 4.5]);
    const crowded: Position[] = [
      [0, 0],
      [0.25, 0],
      [0.5, 0],
      [0.75, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(areaCenter(crowded)).toEqual([0.5, 0.5]);
  });

  it("biết điểm trong hay ngoài vùng", () => {
    expect(contains(square(0, 0), 0.5, 0.5)).toBe(true);
    expect(contains(square(0, 0), 1.5, 0.5)).toBe(false);
  });

  it("căn khung theo mọi điểm và trọn các vùng có điểm; chưa có điểm thì theo mọi vùng", () => {
    expect(framePositions([point(0.5, 0.5)], areas)).toEqual([[0.5, 0.5], ...square(0, 0)]);
    expect(framePositions([point(5, 5)], areas)).toEqual([[5, 5]]);
    expect(framePositions([], areas)).toEqual([...square(0, 0), ...square(1, 0)]);
    expect(framePositions([point(0.5, 0.5)])).toEqual([[0.5, 0.5]]);
  });

  it("thêm lớp tô và viền sau lớp nền, màu đọc theo tên màu của cấu hình", () => {
    const base: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background" }] };
    const style = withAreas(base, areas, (swatch, shade) => `${swatch}-${shade}`);
    expect(style.layers.map((layer) => layer.id)).toEqual(["background", "areas-fill", "areas-line"]);
    expect(style.layers[1]).toMatchObject({ paint: { "fill-color": "indigo-6" } });
    expect(style.layers[2]).toMatchObject({ paint: { "line-color": "indigo-8" } });
    expect(withAreas(base, undefined, () => "x")).toBe(base);
  });
});
