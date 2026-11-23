// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần vẽ của bảng điều hành, nhận dòng đã đọc làm tham số, không gọi mạng: thẻ số, biểu đồ cột ngang kèm bảng số
// liệu, và mục "Nguồn" ghi nguyên văn câu truy vấn đã gửi. Tách khỏi DashboardPanel.tsx (đọc dữ liệu) để kiểm thử
// được cách vẽ bằng react-dom/server. Ở đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Box, Code, Group, Paper, SimpleGrid, Stack, Table, Text } from "@mantine/core";
import {
  barPercents,
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
  sentText,
  sourceKind,
} from "./dashboardConfig";

const swatch = (color: string) => `var(--mantine-color-${color}-6)`;

function CardBox({ card, row }: { card: Card; row: Row }) {
  const text = numberText(row[card.column], card.format);
  return (
    <Paper withBorder radius="md" p="md" role="group" aria-label={card.label}>
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          {card.label}
        </Text>
        <Text size="xl" fw={700}>
          {text}
          {card.unit && text !== NO_DATA ? ` ${card.unit}` : ""}
        </Text>
        <Text size="xs">Cách tính: {card.description}</Text>
      </Stack>
    </Paper>
  );
}

/**
 * Thẻ số cần đúng một dòng: không dòng là chưa có số liệu (`empty`); nhiều dòng là cấu hình sai, không chọn đại một
 * dòng.
 */
export function CardsView({ cards, rows, empty = NO_DATA }: { cards: Card[]; rows: Row[]; empty?: string }) {
  const [row] = rows;
  if (!row) return <Text c="dimmed">{empty}.</Text>;
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
        <CardBox key={card.column + card.label} card={card} row={row} />
      ))}
    </SimpleGrid>
  );
}

function Bars({ chart, rows }: { chart: Chart; rows: Row[] }) {
  const percents = barPercents(chart, rows);
  // Thanh chỉ để nhìn nhanh; trình đọc màn hình đọc bảng số liệu ngay dưới, nên phần này ẩn khỏi nó.
  return (
    <Stack gap="xs" aria-hidden>
      <Group gap="md">
        {chart.y.map((series) => (
          <Group key={series.column} gap={6}>
            <Box w={12} h={12} style={{ background: swatch(series.color), borderRadius: 2 }} />
            <Text size="sm">{series.label}</Text>
          </Group>
        ))}
      </Group>
      {rows.map((row, index) => (
        // Dòng không có khóa riêng (view tổng hợp có thể không có cột id); thứ tự đã cố định bằng order_by.
        // biome-ignore lint/suspicious/noArrayIndexKey: xem chú thích trên
        <Box key={index}>
          <Text size="sm">{categoryText(chart, row[chart.x.column])}</Text>
          {chart.y.map((series, at) => (
            <Box
              key={series.column}
              h={10}
              mt={2}
              style={{ width: `${percents[index]?.[at] ?? 0}%`, background: swatch(series.color), borderRadius: 2 }}
            />
          ))}
        </Box>
      ))}
    </Stack>
  );
}

/** Biểu đồ cột ngang và bảng số liệu của nó; bảng là bản đọc được của biểu đồ, luôn hiện. */
export function ChartView({
  chart,
  rows,
  title,
  empty = NO_DATA,
}: {
  chart: Chart;
  rows: Row[];
  title: string;
  empty?: string;
}) {
  if (rows.length === 0) return <Text c="dimmed">{empty}.</Text>;
  return (
    <Stack gap="sm">
      <Bars chart={chart} rows={rows} />
      <Table.ScrollContainer minWidth={480}>
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
      </Table.ScrollContainer>
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

/** Mục "Nguồn": đủ để người xem chạy lại đúng câu truy vấn hay yêu cầu và đối chiếu từng số. */
export function SourceDetails({ panel, request, rest }: { panel: Panel; request?: PanelQuery; rest?: RestSent }) {
  return (
    <Box component="details">
      <Box component="summary" style={{ cursor: "pointer" }}>
        <Text span size="sm">
          Nguồn
        </Text>
      </Box>
      <Stack gap={4} mt="xs">
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
      </Stack>
    </Box>
  );
}
