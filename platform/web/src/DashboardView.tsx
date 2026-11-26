// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần vẽ của bảng điều hành, nhận dòng đã đọc làm tham số, không gọi mạng: thẻ số (cỡ lớn ở khối chính), biểu đồ
// cột ngang có số trên từng thanh và thang chung, bảng số liệu thu gọn, và mục "Xem cách tính" gồm cách tính cùng
// nguyên văn câu truy vấn đã gửi (ADR 0033, ADR 0045). Tách khỏi DashboardPanel.tsx (đọc dữ liệu) để kiểm thử được
// cách vẽ bằng react-dom/server. Ở đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Box, Code, Group, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import type { ReactNode } from "react";
import {
  barMarks,
  type Card,
  type Chart,
  categoryText,
  columnsOf,
  NO_DATA,
  numberText,
  type Panel,
  type PanelQuery,
  panelRole,
  type Row,
  scaleTop,
  sentText,
  sourceKind,
} from "./dashboardConfig";

const swatch = (color: string) => `var(--mantine-color-${color}-6)`;

/**
 * Nhãn của một nhóm thanh: nhãn trong choices; không có thì mã máy đổi thành "<nhãn trục> <số thứ tự>", mã gốc vẫn
 * nằm trong bảng số liệu thu gọn.
 */
function axisText(chart: Chart, value: unknown, index: number, ordinal: boolean): string {
  const text = categoryText(chart, value);
  const named = chart.x.choices?.some((choice) => choice.value === String(value));
  return ordinal && !named ? `${chart.x.label} ${index + 1}` : text;
}

/** Phần phụ thu gọn: mở bằng chuột hay bàn phím (phần tử details của trình duyệt), đóng sẵn. */
function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box component="details">
      <Box component="summary" style={{ cursor: "pointer" }}>
        <Text span size="sm" fw={500}>
          {label}
        </Text>
      </Box>
      <Stack gap={4} mt="xs">
        {children}
      </Stack>
    </Box>
  );
}

// Chữ của thẻ là nhãn, rồi số liền đơn vị trong một phần tử: tìm "1.234 m²" trên trang thì khớp đúng một số.
function CardBox({ card, row, large }: { card: Card; row: Row; large: boolean }) {
  const text = numberText(row[card.column], card.format);
  return (
    <Paper withBorder radius="md" p="md" role="group" aria-label={card.label}>
      <Stack gap={4}>
        <Text size="sm">{card.label}</Text>
        <Text fz={large ? "h1" : "xl"} fw={700} lh={1.2}>
          {text}
          {card.unit && text !== NO_DATA ? ` ${card.unit}` : ""}
        </Text>
      </Stack>
    </Paper>
  );
}

/**
 * Thẻ số cần đúng một dòng: không dòng là chưa có số liệu (`empty`); nhiều dòng là cấu hình sai, không chọn đại một
 * dòng. `large` là thẻ của khối chính.
 */
export function CardsView({
  cards,
  rows,
  empty = NO_DATA,
  large = false,
}: {
  cards: Card[];
  rows: Row[];
  empty?: string;
  large?: boolean;
}) {
  const [row] = rows;
  if (!row) return <Text>{empty}.</Text>;
  if (rows.length > 1) {
    return (
      <Alert color="red" title="Cấu hình khối sai">
        Nguồn trả nhiều hơn một dòng, mà thẻ số cần đúng một dòng. Báo người quản trị thêm điều kiện where cho khối,
        hoặc dùng biểu đồ.
      </Alert>
    );
  }
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: Math.min(cards.length, 4) }}>
      {cards.map((card) => (
        <CardBox key={card.column + card.label} card={card} row={row} large={large} />
      ))}
    </SimpleGrid>
  );
}

// Cột trái là thanh, cột phải là số của thanh; thang ở dòng cuối nằm đúng dưới cột thanh.
const BAR_GRID = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 8, alignItems: "center" };

function Bars({ chart, rows, ordinal }: { chart: Chart; rows: Row[]; ordinal: boolean }) {
  const marks = barMarks(chart, rows);
  // Thanh và số cạnh thanh để nhìn nhanh; trình đọc màn hình đọc bảng số liệu ngay dưới, nên phần này ẩn khỏi nó.
  return (
    <Stack gap="sm" aria-hidden>
      {chart.y.length > 1 ? (
        <Group gap="md">
          {chart.y.map((series) => (
            <Group key={series.column} gap={6}>
              <Box w={12} h={12} style={{ background: swatch(series.color), borderRadius: 2 }} />
              <Text size="sm">{series.label}</Text>
            </Group>
          ))}
        </Group>
      ) : (
        <Text size="sm">{chart.y[0]?.label}</Text>
      )}
      {rows.map((row, index) => (
        // Dòng không có khóa riêng (view tổng hợp có thể không có cột id); thứ tự đã cố định bằng order_by.
        // biome-ignore lint/suspicious/noArrayIndexKey: xem chú thích trên
        <Box key={index}>
          <Text size="sm">{axisText(chart, row[chart.x.column], index, ordinal)}</Text>
          <Box style={{ ...BAR_GRID, rowGap: 2 }} mt={2}>
            {chart.y.map((series, at) => {
              const mark = marks[index]?.[at];
              return (
                <Box key={series.column} style={{ display: "contents" }}>
                  <Box h={12}>
                    {mark?.drawn && (
                      // Số 0 vẫn có vạch 2px để người xem thấy dòng có số, không phải thiếu dòng.
                      <Box
                        h={12}
                        style={{
                          width: `max(${mark.percent}%, 2px)`,
                          background: swatch(series.color),
                          borderRadius: "0 4px 4px 0",
                        }}
                      />
                    )}
                  </Box>
                  <Text size="xs" ta="right">
                    {mark?.text}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
      <Box style={BAR_GRID}>
        <Group justify="space-between" pt={2} style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Text size="xs">0</Text>
          <Text size="xs">{numberText(scaleTop(chart, rows))}</Text>
        </Group>
      </Box>
    </Stack>
  );
}

/**
 * Biểu đồ cột ngang và bảng số liệu của nó. Bảng là bản đọc được của biểu đồ, luôn có trong trang, thu gọn trong
 * "Xem bảng số liệu" vì các thanh đã ghi số.
 */
export function ChartView({
  chart,
  rows,
  title,
  empty = NO_DATA,
  ordinal = false,
}: {
  chart: Chart;
  rows: Row[];
  title: string;
  empty?: string;
  /** Giá trị trục là mã máy (ví dụ mã entity): thanh ghi số thứ tự thay cho mã khi choices không có nhãn */
  ordinal?: boolean;
}) {
  if (rows.length === 0) return <Text>{empty}.</Text>;
  return (
    <Stack gap="sm">
      <Bars chart={chart} rows={rows} ordinal={ordinal} />
      <Disclosure label="Xem bảng số liệu">
        {/* Bảng hẹp thì cuộn ngang trong khung này; khung nhận focus để người dùng bàn phím cuộn được. */}
        <Box tabIndex={0} role="group" aria-label={`Bảng số liệu của biểu đồ "${title}"`} style={{ overflowX: "auto" }}>
          <Table captionSide="top">
            <Table.Caption>Số liệu của biểu đồ "{title}"</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{chart.x.label}</Table.Th>
                {chart.y.map((series) => (
                  <Table.Th key={series.column}>{series.label}</Table.Th>
                ))}
                {(chart.details ?? []).map((detail) => (
                  <Table.Th key={detail.column}>{detail.label}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: như ở Bars, dòng không có khóa riêng
                <Table.Tr key={index}>
                  <Table.Th scope="row">{categoryText(chart, row[chart.x.column])}</Table.Th>
                  {chart.y.map((series) => (
                    <Table.Td key={series.column}>{numberText(row[series.column])}</Table.Td>
                  ))}
                  {(chart.details ?? []).map((detail) => (
                    <Table.Td key={detail.column}>
                      {detail.format ? numberText(row[detail.column], detail.format) : String(row[detail.column] ?? "")}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      </Disclosure>
    </Stack>
  );
}

const KIND_LABEL: Record<string, string> = {
  graphql: "GraphQL (Hasura), bằng token của người xem",
  workflow: "API quy trình (workflow-api), bằng token của người xem",
  context: "API dữ liệu thiết bị (context-api, NGSI-LD), bằng token của người xem",
};

/** Yêu cầu REST của khối: đường dẫn đã gửi qua cổng và các dòng giải thích thêm, ví dụ phần đếm trên trình duyệt. */
export type RestSent = { path: string; notes: string[] };

/**
 * Mục "Xem cách tính", một mục cho mỗi khối: cách tính của khối (method) và của từng thẻ, rồi phần "Nguồn" đủ để
 * người xem chạy lại đúng câu truy vấn hay yêu cầu và đối chiếu từng số. Tên bảng, cột, vai trò chỉ hiện ở đây.
 */
export function MethodDetails({ panel, request, rest }: { panel: Panel; request?: PanelQuery; rest?: RestSent }) {
  return (
    <Disclosure label="Xem cách tính">
      {panel.method && <Text size="sm">{panel.method}</Text>}
      {(panel.cards ?? []).map((card) => (
        <Text size="sm" key={card.column + card.label}>
          <Text span size="sm" fw={500}>
            {card.label}:
          </Text>{" "}
          {card.description}
        </Text>
      ))}
      <Text size="sm" fw={600} mt="xs">
        Nguồn
      </Text>
      <Text size="sm">Loại nguồn: {KIND_LABEL[sourceKind(panel)]}</Text>
      {panel.graphql && <Text size="sm">Bảng: {panel.graphql.field}</Text>}
      <Text size="sm">
        {panel.graphql ? "Cột" : "Giá trị"}: {columnsOf(panel).join(", ")}
      </Text>
      {/* Nguồn REST không gửi vai trò: workflow-api, context-api đọc vai trò và tenant từ token. */}
      <Text size="sm">
        {panel.graphql ? "Vai trò" : "Khối chỉ hiện với vai trò"}: {panelRole(panel)}
      </Text>
      {rest && (
        <>
          <Text size="sm">Yêu cầu đã gửi:</Text>
          <Code block>GET {rest.path}</Code>
          {rest.notes.map((note) => (
            <Text size="sm" key={note}>
              {note}
            </Text>
          ))}
        </>
      )}
      {request && (
        <>
          <Text size="sm">Câu truy vấn đã gửi:</Text>
          <Code block>{sentText(request.query)}</Code>
          <Text size="sm">Biến:</Text>
          <Code block>{JSON.stringify(request.variables)}</Code>
        </>
      )}
    </Disclosure>
  );
}
