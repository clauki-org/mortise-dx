// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểu Kanban của danh mục (ADR 0066): mỗi lựa chọn của kanban.field là một cột, mỗi dòng một thẻ. Khi gói khai
// kanban.move và token có vai trò của nó, thẻ chuyển sang cột khác bằng kéo thả hay nút "Chuyển sang" trên thẻ (đường
// cho bàn phím, trình đọc màn hình và điện thoại, nơi kéo thả của trình duyệt không chạy). Lệnh chuyển là lệnh sửa
// một cột có điều kiện cột version (formUpdate.ts, ADR 0054); cột bị khóa (kanban.locked) không nhận và không cho
// chuyển thẻ đi. CatalogTable.tsx giữ tìm, lọc, thứ tự và chọn kiểu; câu truy vấn ở catalogViews.ts.

import { Anchor, Box, Button, Group, Menu, Paper, Stack, Text, Title } from "@mantine/core";
import { type DragEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useClient, useQuery } from "urql";
import { useBlock } from "./blockContext";
import { CellValue, linkText } from "./CatalogRows";
import { type CatalogNode, type Field, fieldOf, keyOf, pageSize, type Row } from "./catalog";
import type { ListState } from "./catalogQuery";
import {
  type BoardColumn,
  boardColumns,
  boardQuery,
  boardVariables,
  canEnter,
  type KanbanConfig,
  moveTargets,
} from "./catalogViews";
import { updateError, updateMutation, updateWhere } from "./formUpdate";
import { rolesOf } from "./menu";
import { Empty, ErrorNotice, Loading } from "./States";
import { StatusBadge } from "./StatusBadge";
import { useSession } from "./session";

/** Lời báo khi lệnh chuyển không khớp dòng nào: cùng hai lý do với biểu mẫu sửa (ADR 0054). */
export const MOVE_CONFLICT =
  "Thẻ này đã có người sửa hoặc bạn không còn quyền sửa. Bảng đã tải lại; xem lại rồi chuyển lại.";

type Props = {
  config: CatalogNode;
  kanban: KanbanConfig;
  /** Trường của list.columns; trường đầu là liên kết tới chi tiết */
  columns: Field[];
  state: ListState;
  fixed?: Record<string, unknown>;
  path: string;
  label: string;
  onClear: () => void;
};

type Notice = { ok: boolean; text: string };
type Moving = { row: Row; from: BoardColumn };

export function CatalogKanban({ config, kanban, columns, state, fixed, path, label, onClear }: Props) {
  const field = fieldOf(config, kanban.field);
  const board = useMemo(() => (field ? boardColumns(field, kanban) : []), [field, kanban]);
  const [{ data, fetching, error }, reload] = useQuery<Record<string, Row[]>>({
    query: boardQuery(config, kanban, board),
    variables: boardVariables(config, kanban, board, state, fixed),
    requestPolicy: "cache-and-network",
  });
  const client = useClient();
  const { getToken } = useSession();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // Chặn lần chuyển thứ hai ngay lập tức: trạng thái pending chỉ đổi ở lần vẽ sau, nên thả hai lần liền nhau vẫn lọt.
  const sending = useRef(false);
  const [dragging, setDragging] = useState<Moving | null>(null);
  const role = kanban.move?.role ?? "user";
  // Nút chỉ là lối vào; token thiếu vai trò thì Hasura từ chối mọi lệnh gửi kèm vai trò đó.
  const movable = kanban.move !== undefined && rolesOf(getToken()).includes(role);
  const size = pageSize(config);
  const key = keyOf(config);

  const move = async ({ row, from }: Moving, to: BoardColumn) => {
    const version = kanban.move?.version;
    if (!version || sending.current || !moveTargets(board, from).includes(to)) return;
    sending.current = true;
    const text = linkText(config, columns[0] ?? { name: key, label: key }, row).text;
    setPending(String(row[key]));
    const where = updateWhere(key, row[key], version, row[version]);
    const context = { role, additionalTypenames: [config.source] };
    const set = { [kanban.field]: to.value };
    const result = await client.mutation(updateMutation(config.source), { where, set }, context).toPromise();
    if (result.error) {
      const fields = field ? [{ name: field.name, label: field.label }] : [];
      setNotice({ ok: false, text: `Chưa chuyển được "${text}": ${updateError(result.error, role, fields)}` });
    } else if (result.data?.result?.affected_rows !== 1) setNotice({ ok: false, text: MOVE_CONFLICT });
    else setNotice({ ok: true, text: `Đã chuyển "${text}" sang "${to.label}".` });
    sending.current = false;
    setPending(null);
    reload({ requestPolicy: "network-only" });
  };

  if (error && !data) {
    return (
      <ErrorNotice
        title="Không tải được dữ liệu"
        error={error}
        onRetry={() => reload({ requestPolicy: "network-only" })}
      />
    );
  }
  if (!data && fetching) {
    return (
      <Paper withBorder radius="md">
        <Loading />
      </Paper>
    );
  }
  const total = board.reduce((sum, column) => sum + (data?.[column.alias]?.length ?? 0), 0);
  if (total === 0) return <BoardEmpty state={state} label={label} onClear={onClear} />;
  // Cột cuối (giá trị trống hay ngoài choices) chỉ hiện khi có thẻ: luôn hiện thì gói nào cũng thấy một cột thừa.
  const shown = board.filter((column) => column.value !== undefined || (data?.[column.alias]?.length ?? 0) > 0);
  return (
    <Stack gap="sm">
      {/* Vùng báo luôn có trong trang để trình đọc màn hình đọc lời báo mới sau mỗi lần chuyển. */}
      {/* Chữ thường, không màu riêng: lời báo tự nói được hay chưa được, và giữ tương phản như chữ của trang. */}
      <Text role="status" size="sm" fw={notice ? 600 : undefined}>
        {notice?.text}
      </Text>
      <Box
        role="region"
        aria-label={label}
        tabIndex={0}
        style={{ display: "flex", gap: "var(--mantine-spacing-md)", overflowX: "auto", alignItems: "flex-start" }}
      >
        {shown.map((column) => (
          <BoardLane
            key={column.alias}
            column={column}
            rows={(data?.[column.alias] ?? []).slice(0, size)}
            more={(data?.[column.alias]?.length ?? 0) > size}
            lane={{ config, kanban, columns, path, board, movable, pending, dragging }}
            onDrag={setDragging}
            onMove={move}
          />
        ))}
      </Box>
    </Stack>
  );
}

function BoardEmpty({ state, label, onClear }: Pick<Props, "state" | "label" | "onClear">) {
  const filtering = state.search.trim() !== "" || Object.keys(state.filters).length > 0;
  return (
    <Paper withBorder radius="md">
      {filtering ? (
        <Empty
          title="Không có dòng nào khớp điều kiện tìm và lọc."
          action={
            <Button variant="light" size="xs" onClick={onClear}>
              Bỏ điều kiện tìm và lọc
            </Button>
          }
        />
      ) : (
        <Empty title="Chưa có dòng nào." hint={`${label} chưa có dữ liệu mà tài khoản này được xem.`} />
      )}
    </Paper>
  );
}

type Lane = Pick<Props, "config" | "kanban" | "columns" | "path"> & {
  board: BoardColumn[];
  movable: boolean;
  pending: string | null;
  dragging: Moving | null;
};

type LaneProps = {
  column: BoardColumn;
  rows: Row[];
  more: boolean;
  lane: Lane;
  onDrag: (moving: Moving | null) => void;
  onMove: (moving: Moving, to: BoardColumn) => void;
};

function BoardLane({ column, rows, more, lane, onDrag, onMove }: LaneProps) {
  const inBlock = useBlock() !== null;
  const { dragging } = lane;
  // Chỉ cột nhận được thẻ đang kéo mới gọi preventDefault: trình duyệt hiện dấu cấm ở cột khác, nhìn là biết.
  const accepts = dragging !== null && dragging.from !== column && canEnter(column) && !dragging.from.locked;
  const over = (event: DragEvent) => {
    if (accepts) event.preventDefault();
  };
  const drop = (event: DragEvent) => {
    if (!accepts || !dragging) return;
    event.preventDefault();
    onDrag(null);
    onMove(dragging, column);
  };
  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      miw={260}
      maw={320}
      style={accepts ? { outline: "2px dashed var(--mantine-primary-color-filled)", outlineOffset: 2 } : undefined}
      onDragOver={over}
      onDrop={drop}
    >
      <Group justify="space-between" gap="xs" mb="xs" wrap="nowrap">
        <Title order={inBlock ? 3 : 2} size="h5">
          {column.tone ? <StatusBadge tone={column.tone}>{column.label}</StatusBadge> : column.label}
        </Title>
        <Text size="sm" c="dimmed">
          {more ? `Hơn ${rows.length} thẻ` : `${rows.length} thẻ`}
        </Text>
      </Group>
      {column.locked && (
        <Text size="xs" c="dimmed" mb="xs">
          Giá trị do quy trình đặt, không chuyển tay được.
        </Text>
      )}
      {/* Danh sách mang tên cột để trình đọc màn hình và e2e biết thẻ đang ở cột nào. */}
      <Stack component="ul" aria-label={column.label} gap="xs" p={0} m={0} style={{ listStyle: "none" }}>
        {rows.map((row) => (
          <BoardCard
            key={String(row[keyOf(lane.config)])}
            row={row}
            column={column}
            lane={lane}
            onDrag={onDrag}
            onMove={onMove}
          />
        ))}
      </Stack>
      {more && (
        <Text size="xs" c="dimmed" mt="xs">
          Cột còn thẻ chưa hiện; tìm hay lọc để thu hẹp.
        </Text>
      )}
    </Paper>
  );
}

type CardProps = Pick<LaneProps, "column" | "lane" | "onDrag" | "onMove"> & { row: Row };

function BoardCard({ row, column, lane, onDrag, onMove }: CardProps) {
  const { config, kanban, columns, path, board, movable, pending } = lane;
  const [first, ...rest] = columns;
  if (!first) return null;
  const { key, text } = linkText(config, first, row);
  const targets = movable ? moveTargets(board, column) : [];
  const busy = pending === key;
  return (
    <Paper
      component="li"
      withBorder
      radius="sm"
      p="sm"
      draggable={targets.length > 0 && pending === null}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData("text/plain", text);
        event.dataTransfer.effectAllowed = "move";
        onDrag({ row, from: column });
      }}
      onDragEnd={() => onDrag(null)}
      style={targets.length > 0 ? { cursor: "grab" } : undefined}
    >
      <Anchor component={Link} to={`${path}/${encodeURIComponent(key)}`} fw={700}>
        {text}
      </Anchor>
      <Box component="dl" m={0} mt={4}>
        {rest
          .filter((field) => field.name !== kanban.field)
          .map((field) => (
            <Group key={field.name} gap={6} mt={2} wrap="nowrap" align="baseline">
              <Text component="dt" size="xs" c="dimmed">
                {field.label}:
              </Text>
              <Text component="dd" size="sm" m={0}>
                <CellValue field={field} value={row[field.name]} />
              </Text>
            </Group>
          ))}
      </Box>
      {targets.length > 0 && (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            {/* Tên truy cập chứa chữ hiện trên nút và tên thẻ: mỗi thẻ một nút, đọc riêng vẫn biết nút của thẻ nào. */}
            <Button size="compact-xs" variant="default" mt="xs" loading={busy} aria-label={`Chuyển sang: ${text}`}>
              Chuyển sang
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {targets.map((target) => (
              <Menu.Item key={target.alias} onClick={() => onMove({ row, from: column }, target)}>
                {target.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Paper>
  );
}
