// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung bản đồ của thành phần bản đồ: MapLibre GL JS vẽ nền của bản cài (tệp PMTiles cùng origin, basemap.ts, ADR
// 0056), không có thì nền trơn (ADR 0024); mỗi điểm là một nút HTML đặt theo tọa độ. Nút HTML thay cho lớp vẽ trên canvas để trình đọc màn hình đọc được tên và
// màu của từng điểm và bấm được bằng bàn phím. MapPanel.tsx nạp tệp này khi cần, để trang khác không tải MapLibre.

import { Anchor, Box, Text } from "@mantine/core";
import {
  addProtocol,
  LngLatBounds,
  Map as MapLibre,
  Marker,
  NavigationControl,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";
import { type LoadedBasemap, loadBasemap } from "./basemap";
import type { Point } from "./mapConfig";
import { ErrorNotice, Loading } from "./States";

// Mặc định MapLibre tìm tệp worker cạnh mã của nó trong node_modules; sau khi build, mã nằm trong assets/ nên phải
// chỉ đường tới bản worker do Vite build ra, cùng origin để Content-Security-Policy (worker-src 'self') cho chạy.
setWorkerUrl(workerUrl);

// Giao thức pmtiles:// đọc tile bằng yêu cầu Range tới tệp cùng origin (connect-src 'self'). Đăng ký một lần cho cả
// trang: đăng ký lại mỗi lần vẽ bản đồ sẽ bỏ phần đầu tệp đã đọc và tải lại.
const protocol = new Protocol();
addProtocol("pmtiles", protocol.tile);

type Props = {
  points: Point[];
  selected?: string;
  onSelect: (key: string) => void;
};

// Màu nền lấy từ theme đang dùng: MapLibre cần một màu cụ thể, không đọc được biến CSS.
const background = () =>
  getComputedStyle(document.documentElement).getPropertyValue("--mantine-color-gray-1").trim() || "white";

const plainStyle = (): StyleSpecification => ({
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": background() } }],
});

/** Nền của bản cài: undefined khi đang đọc, null khi không có và vẽ nền trơn. */
function useBasemap() {
  const [basemap, setBasemap] = useState<LoadedBasemap | null>();
  useEffect(() => {
    let current = true;
    loadBasemap(protocol).then((loaded) => current && setBasemap(loaded));
    return () => {
      current = false;
    };
  }, []);
  return basemap;
}

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
  const [failure, setFailure] = useState<unknown>();
  const basemap = useBasemap();

  useEffect(() => {
    if (!container.current || basemap === undefined) return;
    let created: MapLibre;
    try {
      created = new MapLibre({
        container: container.current,
        style: basemap?.style ?? plainStyle(),
        center: basemap?.center ?? [0, 0],
        // Không cho thu nhỏ quá mức thấp nhất có trong tệp nền: thu nhỏ hơn thì nền trống, và người xem không còn
        // thấy vùng nào quanh các điểm.
        minZoom: basemap?.minZoom ?? 0,
        zoom: basemap?.minZoom ?? 1,
        attributionControl: false,
        // Nút phóng to, thu nhỏ cho người không dùng chuột; nhãn mặc định của MapLibre là tiếng Anh.
        locale: { "NavigationControl.ZoomIn": "Phóng to", "NavigationControl.ZoomOut": "Thu nhỏ" },
      });
      created.addControl(new NavigationControl({ showCompass: false }));
    } catch (error) {
      // MapLibre cần WebGL; trình duyệt tắt WebGL thì báo lý do, danh sách điểm bên dưới vẫn dùng được.
      setFailure(error);
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
  }, [basemap]);

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

  if (failure !== undefined) {
    return (
      <ErrorNotice title="Không vẽ được bản đồ" error={failure}>
        <Text size="sm">Trình duyệt cần bật WebGL để vẽ bản đồ. Danh sách điểm bên dưới vẫn đủ.</Text>
      </ErrorNotice>
    );
  }
  if (basemap === undefined) return <Loading what="nền bản đồ" />;
  return (
    <Box pos="relative">
      <section ref={container} aria-label="Bản đồ" style={{ height: 420, borderRadius: 8 }} />
      {basemap && <Attribution />}
    </Box>
  );
}

/**
 * Dòng ghi nguồn mà ODbL đòi khi dùng dữ liệu OpenStreetMap. Là chữ của trang chứ không phải nút ghi nguồn của
 * MapLibre: nút đó thu thành một biểu tượng ở màn hình hẹp, nên dòng ghi nguồn không còn luôn hiện.
 */
function Attribution() {
  return (
    <Text
      size="xs"
      pos="absolute"
      right={0}
      bottom={0}
      px={6}
      py={2}
      bg="var(--mantine-color-body)"
      style={{ borderTopLeftRadius: 4 }}
    >
      ©{" "}
      <Anchor href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" inherit>
        OpenStreetMap
      </Anchor>{" "}
      (ODbL)
    </Text>
  );
}
