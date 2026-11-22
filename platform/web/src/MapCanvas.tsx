// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung bản đồ của thành phần bản đồ: MapLibre GL JS vẽ nền trơn, không tải ảnh nền từ máy chủ nào (ADR 0024), mỗi
// điểm là một nút HTML đặt theo tọa độ. Nút HTML thay cho lớp vẽ trên canvas để trình đọc màn hình đọc được tên và
// màu của từng điểm và bấm được bằng bàn phím. MapPanel.tsx nạp tệp này khi cần, để trang khác không tải MapLibre.

import { Alert } from "@mantine/core";
import { LngLatBounds, Map as MapLibre, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import type { Point } from "./mapConfig";

// Mặc định MapLibre tìm tệp worker cạnh mã của nó trong node_modules; sau khi build, mã nằm trong assets/ nên phải
// chỉ đường tới bản worker do Vite build ra, cùng origin để Content-Security-Policy (worker-src 'self') cho chạy.
setWorkerUrl(workerUrl);

type Props = {
  points: Point[];
  selected?: string;
  onSelect: (key: string) => void;
};

// Màu nền lấy từ theme đang dùng: MapLibre cần một màu cụ thể, không đọc được biến CSS.
const background = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--mantine-color-gray-1").trim() || "white";

function markerElement(point: Point, onSelect: (key: string) => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "mortise-map-point";
  element.dataset.color = point.color;
  element.setAttribute("aria-label", `${point.title}: ${point.colorLabel}`);
  element.title = `${point.title}: ${point.colorLabel}`;
  Object.assign(element.style, {
    width: "16px",
    height: "16px",
    padding: "0",
    borderRadius: "50%",
    border: "2px solid white",
    background: `var(--mantine-color-${point.color}-6)`,
    cursor: "pointer",
  });
  element.addEventListener("click", () => onSelect(point.key));
  return element;
}

export default function MapCanvas({ points, selected, onSelect }: Props) {
  const container = useRef<HTMLElement>(null);
  const [map, setMap] = useState<MapLibre>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (!container.current) return;
    let created: MapLibre;
    try {
      created = new MapLibre({
        container: container.current,
        style: {
          version: 8,
          sources: {},
          layers: [{ id: "background", type: "background", paint: { "background-color": background() } }],
        },
        center: [0, 0],
        zoom: 1,
        attributionControl: false,
        // Nút phóng to, thu nhỏ cho người không dùng chuột; nhãn mặc định của MapLibre là tiếng Anh.
        locale: { "NavigationControl.ZoomIn": "Phóng to", "NavigationControl.ZoomOut": "Thu nhỏ" },
      });
      created.addControl(new NavigationControl({ showCompass: false }));
    } catch (error) {
      // MapLibre cần WebGL; trình duyệt tắt WebGL thì báo lý do, danh sách điểm bên dưới vẫn dùng được.
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    // MapLibre đo khung một lần khi tạo và chỉ đo lại khi cửa sổ đổi cỡ; khung đổi cỡ vì bố cục trang (CSS nạp sau,
    // thanh menu đóng mở) mà không đo lại thì bản đồ chỉ vẽ một phần khung và điểm nằm ngoài phần đó.
    const observer = new ResizeObserver(() => created.resize());
    observer.observe(container.current);
    setMap(created);
    return () => {
      observer.disconnect();
      created.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const markers = points.map((point) => {
      const element = markerElement(point, onSelect);
      if (point.key === selected) element.style.outline = "3px solid var(--mantine-color-dark-6)";
      return new Marker({ element }).setLngLat([point.longitude, point.latitude]).addTo(map);
    });
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [map, points, selected, onSelect]);

  // Chỉ căn khung khi tập điểm đổi, không căn lại khi người xem chọn một điểm sau khi đã kéo, phóng bản đồ.
  useEffect(() => {
    if (!map || points.length === 0) return;
    const bounds = new LngLatBounds();
    for (const point of points) bounds.extend([point.longitude, point.latitude]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false });
  }, [map, points]);

  if (failure) {
    return (
      <Alert color="yellow" title="Không vẽ được bản đồ">
        Trình duyệt không vẽ được bản đồ ({failure}). Danh sách điểm bên dưới vẫn đủ.
      </Alert>
    );
  }
  return <section ref={container} aria-label="Bản đồ" style={{ height: 420, borderRadius: 8 }} />;
}
