// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểu Lịch của danh mục (ADR 0066): mỗi dòng hiện ở ngày của calendar.field, xem theo tháng (lưới bảy cột, tuần bắt
// đầu từ thứ hai) hay theo tuần (danh sách bảy ngày, đọc được trên điện thoại). Lịch chỉ đọc: bấm một dòng mở chi tiết
// như ở bảng. Câu truy vấn lấy dòng trong khoảng ngày đang xem, cùng tìm, lọc của danh sách (catalogViews.ts); dòng có
// giá trị không đọc được thành ngày hiện ở danh sách riêng thay vì biến mất.

import { Anchor, Box, Button, Group, Paper, SegmentedControl, Stack, Table, Text, Title } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "urql";
import { useBlock } from "./blockContext";
import { type CatalogNode, display, fieldOf, keyOf, type Row } from "./catalog";
import type { ListState } from "./catalogQuery";
import {
  CALENDAR_LIMIT,
  type CalendarConfig,
  type CalendarMode,
  calendarDays,
  calendarQuery,
  calendarTitle,
  calendarVariables,
  dayKey,
  dayOf,
  rangeLabel,
  shiftCursor,
} from "./catalogViews";
import { Empty, ErrorNotice, Loading } from "./States";
import { TableScroll } from "./TableScroll";

const WEEKDAYS = ["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"];
const SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

type Props = {
  config: CatalogNode;
  calendar: CalendarConfig;
  state: ListState;
  fixed?: Record<string, unknown>;
  path: string;
  label: string;
  onClear: () => void;
  /** Ngày hôm nay; bài kiểm đặt ngày cố định để lịch không đổi theo ngày chạy */
  today?: Date;
};

export function CatalogCalendar({ config, calendar, state, fixed, path, label, onClear, today = new Date() }: Props) {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(today);
  const field = fieldOf(config, calendar.field) ?? { name: calendar.field, label: calendar.field, type: "date" };
  const days = calendarDays(mode, cursor);
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Row[] }>({
    query: calendarQuery(config, calendar),
    variables: calendarVariables(config, calendar, field, state, days, fixed),
    requestPolicy: "cache-and-network",
  });
  const rows = data?.rows.slice(0, CALENDAR_LIMIT) ?? [];
  const range = rangeLabel(mode, cursor, days);
  const keys = new Set(days.map(dayKey));
  const byDay = new Map<string, Row[]>();
  const unplaced: Row[] = [];
  for (const row of rows) {
    const day = dayOf(field, row[calendar.field]);
    if (day && keys.has(day)) byDay.set(day, [...(byDay.get(day) ?? []), row]);
    else unplaced.push(row);
  }
  const entry = { config, calendar, path };
  const word = mode === "month" ? "Tháng" : "Tuần";

  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="sm">
        <Group gap="xs">
          <Button variant="default" onClick={() => setCursor(shiftCursor(mode, cursor, -1))}>
            {word} trước
          </Button>
          <Button variant="default" onClick={() => setCursor(today)}>
            Hôm nay
          </Button>
          <Button variant="default" onClick={() => setCursor(shiftCursor(mode, cursor, 1))}>
            {word} sau
          </Button>
        </Group>
        {/* Khoảng đang xem đọc lên sau mỗi lần bấm trước, sau: không có nó người dùng trình đọc màn hình không biết đã tới đâu. */}
        <Text fw={700} aria-live="polite">
          {range}
        </Text>
        <SegmentedControl
          aria-label="Lịch theo"
          data={[
            { value: "month", label: "Tháng" },
            { value: "week", label: "Tuần" },
          ]}
          value={mode}
          onChange={(value) => setMode(value === "week" ? "week" : "month")}
        />
      </Group>
      {error && !data ? (
        <ErrorNotice
          title="Không tải được dữ liệu"
          error={error}
          onRetry={() => reload({ requestPolicy: "network-only" })}
        />
      ) : !data && fetching ? (
        <Paper withBorder radius="md">
          <Loading />
        </Paper>
      ) : rows.length === 0 ? (
        <CalendarEmpty state={state} label={label} onClear={onClear} />
      ) : (
        <>
          {mode === "month" ? (
            <MonthGrid
              days={days}
              cursor={cursor}
              today={today}
              byDay={byDay}
              label={`${label}, ${range}`}
              entry={entry}
            />
          ) : (
            <WeekList days={days} today={today} byDay={byDay} entry={entry} />
          )}
          {(data?.rows.length ?? 0) > CALENDAR_LIMIT && (
            <Text size="sm" c="dimmed">
              Lịch chỉ hiện {CALENDAR_LIMIT} dòng đầu của khoảng này; tìm hay lọc để thu hẹp.
            </Text>
          )}
          {unplaced.length > 0 && <Unplaced rows={unplaced} entry={entry} />}
        </>
      )}
    </Stack>
  );
}

function CalendarEmpty({ state, label, onClear }: Pick<Props, "state" | "label" | "onClear">) {
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
        <Empty
          title="Chưa có dòng nào."
          hint={`${label} chưa có dòng nào trong khoảng ngày này mà tài khoản này được xem.`}
        />
      )}
    </Paper>
  );
}

type Entry = { config: CatalogNode; calendar: CalendarConfig; path: string };

/** Các dòng của một ngày: mỗi dòng một liên kết tới chi tiết, chữ là trường tiêu đề của lịch, trống thì là khóa. */
function DayRows({ rows, entry }: { rows: Row[]; entry: Entry }) {
  const name = calendarTitle(entry.config, entry.calendar);
  const titleField = fieldOf(entry.config, name) ?? { name, label: name };
  return (
    <Stack component="ul" gap={2} p={0} m={0} style={{ listStyle: "none" }}>
      {rows.map((row) => {
        const key = String(row[keyOf(entry.config)]);
        return (
          <li key={key}>
            <Anchor component={Link} to={`${entry.path}/${encodeURIComponent(key)}`} size="sm">
              {display(titleField, row[name]) || key}
            </Anchor>
          </li>
        );
      })}
    </Stack>
  );
}

type GridProps = { days: Date[]; today: Date; byDay: Map<string, Row[]>; entry: Entry };

function MonthGrid({ days, cursor, today, byDay, label, entry }: GridProps & { cursor: Date; label: string }) {
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const now = dayKey(today);
  return (
    <TableScroll label={label} minWidth={640}>
      <Table withColumnBorders layout="fixed" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            {SHORT.map((short, index) => (
              <Table.Th key={short}>
                <abbr title={WEEKDAYS[index]} style={{ textDecoration: "none" }}>
                  {short}
                </abbr>
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {weeks.map((week) => (
            <Table.Tr key={dayKey(week[0] ?? today)}>
              {week.map((day) => {
                const key = dayKey(day);
                const outside = day.getMonth() !== cursor.getMonth();
                return (
                  <Table.Td key={key} valign="top" h={96} aria-current={key === now ? "date" : undefined}>
                    {/* Hôm nay có chữ đi kèm, không chỉ đậm hơn: màu hay độ đậm một mình không đủ để nhận ra. */}
                    <Text size="sm" fw={key === now ? 800 : 400} c={outside ? "dimmed" : undefined}>
                      {day.getDate()}
                      {key === now && " (hôm nay)"}
                    </Text>
                    <DayRows rows={byDay.get(key) ?? []} entry={entry} />
                  </Table.Td>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </TableScroll>
  );
}

function WeekList({ days, today, byDay, entry }: GridProps) {
  const inBlock = useBlock() !== null;
  const now = dayKey(today);
  return (
    <Stack gap="xs">
      {days.map((day, index) => {
        const key = dayKey(day);
        const rows = byDay.get(key) ?? [];
        return (
          <Paper key={key} withBorder radius="md" p="sm" aria-current={key === now ? "date" : undefined}>
            <Title order={inBlock ? 3 : 2} size="h6">
              {WEEKDAYS[index]} {String(day.getDate()).padStart(2, "0")}/{String(day.getMonth() + 1).padStart(2, "0")}
              {key === now && " (hôm nay)"}
            </Title>
            {rows.length > 0 ? (
              <DayRows rows={rows} entry={entry} />
            ) : (
              <Text size="sm" c="dimmed">
                Không có dòng nào.
              </Text>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}

function Unplaced({ rows, entry }: { rows: Row[]; entry: Entry }) {
  const inBlock = useBlock() !== null;
  return (
    <Box>
      <Title order={inBlock ? 3 : 2} size="h6">
        Không xếp được vào lịch
      </Title>
      <Text size="sm" c="dimmed" mb={4}>
        Giá trị ngày của các dòng này không đọc được.
      </Text>
      <DayRows rows={rows} entry={entry} />
    </Box>
  );
}
