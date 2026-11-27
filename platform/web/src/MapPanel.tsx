// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần bản đồ: các lớp điểm đọc qua GraphQL theo cấu hình của gói (contracts/map.schema.json), chú giải màu,
// khung bản đồ (MapCanvas.tsx, nạp khi cần) và danh sách điểm của từng lớp. Danh sách đi kèm để người không xem được
// bản đồ, hay trình duyệt không có WebGL, vẫn đọc đủ các điểm. Ở đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Button, ColorSwatch, Group, Paper, Stack, Table, Text, Title } from "@mantine/core";
import { Component, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import {
  type Areas,
  fieldText,
  type Layer,
  layerQuery,
  limitOf,
  type MapConfig,
  MISSING_COLOR,
  MISSING_LABEL,
  mapProblems,
  type Point,
  pointsOf,
  type Row,
  valueAt,
  visibleLayers,
} from "./mapConfig";
import { rolesOf } from "./menu";
import { PageHeader } from "./PageHeader";
import { Empty, ErrorNotice, Loading } from "./States";
import { useSession } from "./session";
import { TableScroll } from "./TableScroll";

const MapCanvas = lazy(() => import("./MapCanvas"));

type CanvasFailure = { error?: Error };

/**
 * Lỗi khi nạp hay vẽ khung bản đồ, ví dụ tệp MapLibre không tải được vì mất mạng hay vì bản cài vừa lên phiên bản
 * mới, chỉ làm hỏng khung bản đồ. Không chặn ở đây thì lỗi lên tới màn hình lỗi của router và danh sách điểm, vốn
 * không cần MapLibre, cũng mất. React nhớ lần nạp hỏng của lazy() nên chỉ tải lại trang mới nạp lại được.
 */
class CanvasBoundary extends Component<{ children: ReactNode }, CanvasFailure> {
  state: CanvasFailure = {};

  static getDerivedStateFromError(error: unknown): CanvasFailure {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Stack m="md">
        <ErrorNotice title="Không tải được bản đồ" error={this.state.error}>
          <Text size="sm">Danh sách điểm bên dưới vẫn đủ.</Text>
          <Button size="xs" variant="light" onClick={() => window.location.reload()}>
            Tải lại trang
          </Button>
        </ErrorNotice>
      </Stack>
    );
  }
}

const swatch = (color: string) => `var(--mantine-color-${color}-6)`;

/** Một lớp: đọc dòng với vai trò của lớp, đổi thành điểm; danh sách điểm của lớp hiện ngay dưới tên lớp. */
function useLayer(layer: Layer) {
  const { query, variables } = useMemo(() => layerQuery(layer), [layer]);
  // Truy vấn mang vai trò riêng; bộ nhớ đệm của urql không phân biệt vai trò nên luôn đọc lại từ máy chủ.
  const context = useMemo(() => (layer.role ? { role: layer.role } : {}), [layer.role]);
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Row[] }>({
    query,
    variables,
    context,
    requestPolicy: "network-only",
  });
  // Dựng điểm theo data chứ không theo một mảng tạo mới mỗi lần vẽ, để khung bản đồ chỉ vẽ lại khi dữ liệu đổi.
  const placed = useMemo(() => pointsOf(layer, data?.rows.slice(0, limitOf(layer)) ?? []), [layer, data]);
  return { ...placed, more: (data?.rows.length ?? 0) > limitOf(layer), fetching, error, reload };
}

function Legend({ layer }: { layer: Layer }) {
  const items =
    "fixed" in layer.color
      ? [{ color: layer.color.fixed, label: layer.label }]
      : [...layer.color.steps, { color: MISSING_COLOR, label: MISSING_LABEL }];
  return (
    <Group gap="md">
      {"by" in layer.color && <Text size="sm">{layer.color.label}:</Text>}
      {items.map((item) => (
        <Group key={item.label} gap={6}>
          <ColorSwatch color={swatch(item.color)} size={14} aria-hidden />
          <Text size="sm">{item.label}</Text>
        </Group>
      ))}
    </Group>
  );
}

/** Chú giải của vùng: tên mọi vùng, để người không xem được bản đồ vẫn biết bản đồ có những vùng nào. */
function AreaLegend({ areas }: { areas: Areas }) {
  return (
    <Group gap={6}>
      <ColorSwatch color={swatch(areas.color)} size={14} aria-hidden />
      <Text size="sm">
        {areas.label}: {areas.items.map((area) => area.name).join(", ")}
      </Text>
    </Group>
  );
}

type LayerProps = { layer: Layer; selected?: string; onPoints: (id: string, points: Point[]) => void };

function LayerSection({ layer, selected, onPoints }: LayerProps) {
  const { points, unplaced, more, fetching, error, reload } = useLayer(layer);
  // Báo điểm lên khung bản đồ chung mỗi khi tập điểm của lớp đổi.
  useEffect(() => onPoints(layer.id, points), [layer.id, points, onPoints]);
  const fields = layer.fields ?? [];
  return (
    <Stack gap="xs" aria-label={layer.label} component="section">
      <Title order={2} size="h4">
        {layer.label}
      </Title>
      <Legend layer={layer} />
      {error && (
        <ErrorNotice
          title={`Không đọc được lớp ${layer.label}`}
          error={error}
          onRetry={() => reload({ requestPolicy: "network-only" })}
        />
      )}
      {fetching && points.length === 0 && <Loading what={`lớp ${layer.label}`} inline />}
      {!fetching && !error && points.length === 0 && unplaced === 0 && <Empty title="Không có điểm nào." />}
      {unplaced > 0 && <Text size="sm">{unplaced} dòng chưa có tọa độ nên không hiện trên bản đồ.</Text>}
      {more && (
        <Text size="sm">
          Lớp có hơn {limitOf(layer)} dòng; chỉ hiện {limitOf(layer)} dòng đầu.
        </Text>
      )}
      {/* Nhãn khung cuộn không lặp tên lớp: khối của lớp đã là vùng mang tên lớp, e2e tìm vùng theo tên đó. */}
      {points.length > 0 && (
        <TableScroll label="Danh sách điểm" minWidth={480}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tên</Table.Th>
                <Table.Th>Màu</Table.Th>
                {fields.map((field) => (
                  <Table.Th key={field.name}>{field.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {points.map((point) => (
                <Table.Tr key={point.key} bg={point.key === selected ? "gray.1" : undefined}>
                  <Table.Td>{point.title}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <ColorSwatch color={swatch(point.color)} size={12} aria-hidden />
                      {point.colorLabel}
                    </Group>
                  </Table.Td>
                  {fields.map((field) => (
                    <Table.Td key={field.name}>{fieldText(field, valueAt(point.row, field.name))}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </TableScroll>
      )}
    </Stack>
  );
}

export function MapPanel({ config }: { config: MapConfig }) {
  const { getToken } = useSession();
  const [byLayer, setByLayer] = useState<Record<string, Point[]>>({});
  const [selected, setSelected] = useState<string>();
  const onPoints = useCallback(
    (id: string, points: Point[]) =>
      setByLayer((current) => (current[id] === points ? current : { ...current, [id]: points })),
    [],
  );
  const problems = mapProblems(config);
  // Token được làm mới vài phút một lần; so theo danh sách vai trò để các lớp không bị coi là mới mỗi lần làm mới.
  const roles = rolesOf(getToken()).join(" ");
  const layers = useMemo(() => visibleLayers(config, roles.split(" ")), [config, roles]);
  const points = useMemo(() => layers.flatMap((layer) => byLayer[layer.id] ?? []), [layers, byLayer]);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình bản đồ sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  return (
    <Stack>
      <PageHeader title={config.title} />
      <Paper withBorder radius="md">
        <CanvasBoundary>
          <Suspense fallback={<Loading what="bản đồ" />}>
            <MapCanvas points={points} areas={config.areas} selected={selected} onSelect={setSelected} />
          </Suspense>
        </CanvasBoundary>
      </Paper>
      {config.note && <Text size="sm">{config.note}</Text>}
      {config.areas && <AreaLegend areas={config.areas} />}
      {layers.map((layer) => (
        <LayerSection key={layer.id} layer={layer} selected={selected} onPoints={onPoints} />
      ))}
    </Stack>
  );
}
