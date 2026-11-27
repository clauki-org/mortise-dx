// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Vùng cố định của thành phần bản đồ (mục `areas` của contracts/map.schema.json): dựng GeoJSON để MapLibre tô và viền,
// chỗ đặt tên vùng, và khung cần căn để thấy mọi điểm cùng trọn các vùng chứa điểm. MapCanvas.tsx dùng các hàm này;
// tách ra đây để kiểm thử bằng hàm thuần, không cần WebGL.

import type { StyleSpecification } from "maplibre-gl";
import type { Area, Areas, Point, Position } from "./mapConfig";

/** Các vùng thành FeatureCollection: mỗi vùng một đa giác đã khép kín, như GeoJSON đòi. */
export function areasGeoJSON(areas: Areas) {
  return {
    type: "FeatureCollection" as const,
    features: areas.items.map((area) => ({
      type: "Feature" as const,
      properties: { name: area.name },
      geometry: { type: "Polygon" as const, coordinates: [[...area.outline, area.outline[0] as Position]] },
    })),
  };
}

/**
 * Trọng tâm diện tích của đường viền, chỗ đặt tên vùng. Không dùng trung bình các đỉnh: một cạnh có nhiều đỉnh sẽ
 * kéo tên về phía cạnh đó. Đường viền suy biến (diện tích 0) thì dùng trung bình các đỉnh.
 */
export function areaCenter(outline: Position[]): Position {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  outline.forEach(([x0, y0], index) => {
    const [x1, y1] = outline[(index + 1) % outline.length] as Position;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  });
  if (twiceArea === 0) {
    const sum = outline.reduce(([sx, sy], [px, py]) => [sx + px, sy + py], [0, 0]);
    return [sum[0] / outline.length, sum[1] / outline.length];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/** Điểm (kinh độ, vĩ độ) nằm trong đường viền hay không, theo phép đếm số lần cắt cạnh của tia nằm ngang. */
export function contains(outline: Position[], longitude: number, latitude: number): boolean {
  let inside = false;
  outline.forEach(([xi, yi], index) => {
    const [xj, yj] = outline[(index + outline.length - 1) % outline.length] as Position;
    if (yi > latitude !== yj > latitude && longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  });
  return inside;
}

/**
 * Các tọa độ khung bản đồ phải chứa: mọi điểm, cộng trọn các vùng có ít nhất một điểm. Người của một đơn vị nhờ vậy
 * thấy trọn ranh giới đơn vị mình, người của cấp trên thấy mọi vùng có điểm. Chưa có điểm nào thì căn theo mọi vùng.
 */
export function framePositions(points: Point[], areas?: Areas): Position[] {
  const positions: Position[] = points.map((point) => [point.longitude, point.latitude]);
  const items = areas?.items ?? [];
  const shown: Area[] =
    points.length === 0
      ? items
      : items.filter((area) => points.some((point) => contains(area.outline, point.longitude, point.latitude)));
  for (const area of shown) positions.push(...area.outline);
  return positions;
}

/**
 * Thêm nguồn và hai lớp của vùng (tô nhạt, viền) vào cuối kiểu vẽ, tức trên nền và dưới điểm (điểm là nút HTML nằm
 * trên canvas). `color` đổi tên màu và sắc độ thành màu cụ thể của theme: MapLibre không đọc được biến CSS.
 */
export function withAreas(
  style: StyleSpecification,
  areas: Areas | undefined,
  color: (swatch: string, shade: number) => string,
): StyleSpecification {
  if (!areas) return style;
  const fill = color(areas.color, 6);
  const line = color(areas.color, 8);
  return {
    ...style,
    sources: { ...style.sources, areas: { type: "geojson", data: areasGeoJSON(areas) } },
    layers: [
      ...style.layers,
      { id: "areas-fill", type: "fill", source: "areas", paint: { "fill-color": fill, "fill-opacity": 0.12 } },
      { id: "areas-line", type: "line", source: "areas", paint: { "line-color": line, "line-width": 2 } },
    ],
  } satisfies StyleSpecification;
}
