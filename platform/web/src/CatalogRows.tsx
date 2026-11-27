// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hai cách vẽ các dòng đã tải của một danh sách danh mục (ADR 0050): bảng và thẻ. CatalogTable.tsx giữ trạng thái,
// truy vấn, ô tìm, ô lọc và phân trang, rồi chọn một trong hai; ở đây chỉ vẽ, không gọi mạng, nên kiểm được bằng
// react-dom/server. Cả hai cách lấy cột từ list.columns, cột đầu là liên kết tới màn hình chi tiết, giá trị có tone
// thành nhãn StatusBadge có chữ.

import {
  Anchor,
  Box,
  Group,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { Link } from "react-router";
import { type CatalogNode, display, type Field, keyOf, type Row, type Sort, toneOf } from "./catalog";
import { VIEW_LABELS, type View } from "./catalogViews";
import { StatusBadge } from "./StatusBadge";
import { Blank, keepTogether, TableScroll } from "./TableScroll";

/** Một giá trị của dòng: nhãn có màu khi gói khai tone cho lựa chọn đó, không thì chữ, trống thì gạch mờ. */
export function CellValue({ field, value }: { field: Field; value: unknown }) {
  const text = display(field, value);
  if (text === "") return <Blank />;
  const tone = toneOf(field, value);
  return tone ? <StatusBadge tone={tone}>{text}</StatusBadge> : text;
}

type RowsProps = {
  config: CatalogNode;
  /** Các trường của list.columns theo thứ tự khai; trường đầu là liên kết tới màn hình chi tiết */
  columns: Field[];
  rows: Row[];
  /** Đường dẫn của danh sách; màn hình chi tiết của một dòng là `${path}/${khóa}` */
  path: string;
};

/** Chữ của liên kết ở cột đầu; giá trị trống thì dùng khóa để dòng vẫn mở được. */
export function linkText(config: CatalogNode, field: Field, row: Row): { key: string; text: string } {
  const key = String(row[keyOf(config)]);
  return { key, text: display(field, row[field.name]) || key };
}

type TableProps = RowsProps & {
  label: string;
  sort: Required<Sort>;
  onSort: (field: Field) => void;
};

export function RowsTable({ config, columns, rows, path, label, sort, onSort }: TableProps) {
  return (
    <TableScroll label={label} minWidth={480}>
      <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead>
          <Table.Tr>
            {columns.map((field) => {
              const sorted = sort.field === field.name;
              return (
                <Table.Th
                  key={field.name}
                  ta={field.type === "number" ? "right" : undefined}
                  aria-sort={sorted ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {/* Nút không viền, không đệm: tiêu đề thẳng hàng với giá trị trong cột. */}
                  <UnstyledButton fw={600} fz="sm" onClick={() => onSort(field)} title="Sắp xếp theo cột này">
                    {field.label}
                    {/* Mũi tên chỉ lặp lại điều aria-sort đã nói cho trình đọc màn hình. */}
                    {sorted && <span aria-hidden="true">&nbsp;{sort.direction === "asc" ? "↑" : "↓"}</span>}
                  </UnstyledButton>
                </Table.Th>
              );
            })}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => {
            const [first, ...rest] = columns;
            if (!first) return null;
            const { key, text } = linkText(config, first, row);
            return (
              <Table.Tr key={key}>
                <Table.Td
                  ta={first.type === "number" ? "right" : undefined}
                  style={keepTogether(text) ? { whiteSpace: "nowrap" } : undefined}
                >
                  <Anchor component={Link} to={`${path}/${encodeURIComponent(key)}`} fw={600}>
                    {text}
                  </Anchor>
                </Table.Td>
                {rest.map((field) => {
                  const shown = display(field, row[field.name]);
                  return (
                    <Table.Td
                      key={field.name}
                      ta={field.type === "number" ? "right" : undefined}
                      style={keepTogether(shown) ? { whiteSpace: "nowrap" } : undefined}
                    >
                      <CellValue field={field} value={row[field.name]} />
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </TableScroll>
  );
}

/**
 * Mỗi dòng một thẻ: cột đầu là liên kết như ở bảng (cùng tên truy cập, nên đường đi bằng bàn phím và e2e không đổi),
 * các cột sau là cặp nhãn, giá trị. Thẻ là mục của một danh sách để trình đọc màn hình báo số thẻ; không có nút riêng
 * để mở, vì liên kết đã mở được và thêm nút là thêm một điểm dừng Tab cho mỗi dòng.
 */
export function RowsCards({ config, columns, rows, path }: RowsProps) {
  const [first, ...rest] = columns;
  if (!first) return null;
  return (
    <SimpleGrid component="ul" cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" p={0} m={0} style={{ listStyle: "none" }}>
      {rows.map((row) => {
        const { key, text } = linkText(config, first, row);
        return (
          <Paper component="li" key={key} withBorder radius="md" p="md">
            <Anchor component={Link} to={`${path}/${encodeURIComponent(key)}`} fw={800} fz="lg">
              {text}
            </Anchor>
            <Box component="dl" m={0} mt="sm">
              {rest.map((field) => (
                <Box key={field.name} mt="xs">
                  <Text component="dt" size="sm" c="dimmed">
                    {field.label}
                  </Text>
                  <Box component="dd" m={0}>
                    <CellValue field={field} value={row[field.name]} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

type ControlsProps = {
  columns: Field[];
  /** Kiểu vẽ được, theo thứ tự hiện; bảng và thẻ luôn có, Kanban và Lịch khi cấu hình khai (ADR 0066) */
  views: View[];
  view: View;
  sort: Required<Sort>;
  onView: (view: View) => void;
  onSort: (sort: Sort) => void;
};

/**
 * Nút chọn kiểu và ô "Sắp theo". Ô sắp xếp chỉ hiện ở dạng thẻ và Kanban, vì dạng bảng sắp bằng tiêu đề cột và lịch
 * xếp theo ngày; cùng một thứ tự của trạng thái danh sách, nên thứ tự do máy chủ xếp và giữ nguyên khi chuyển dạng.
 */
export function ViewControls({ columns, views, view, sort, onView, onSort }: ControlsProps) {
  const options = columns.flatMap((field) => [
    { value: field.name, label: `${field.label}, tăng dần` },
    { value: `-${field.name}`, label: `${field.label}, giảm dần` },
  ]);
  return (
    <Group gap="sm" align="flex-end" ml="auto">
      {(view === "cards" || view === "kanban") && (
        <Select
          label="Sắp theo"
          data={options}
          value={`${sort.direction === "desc" ? "-" : ""}${sort.field}`}
          allowDeselect={false}
          onChange={(value) =>
            value && onSort({ field: value.replace(/^-/, ""), direction: value.startsWith("-") ? "desc" : "asc" })
          }
        />
      )}
      {/* Nhóm nút chọn một (radiogroup): một điểm dừng Tab, phím mũi tên đổi lựa chọn, tên nhóm đọc được. */}
      <SegmentedControl
        aria-label="Kiểu hiển thị"
        data={views.map((value) => ({ value, label: VIEW_LABELS[value] }))}
        value={view}
        onChange={(value) => onView(views.find((candidate) => candidate === value) ?? "table")}
      />
    </Group>
  );
}
