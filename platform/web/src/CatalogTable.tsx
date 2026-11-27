// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Danh sách của thành phần danh mục: ô tìm, ô lọc, thứ tự và phân trang, tất cả theo cấu hình của gói (catalog.ts,
// catalogQuery.ts); các dòng vẽ thành bảng hay thẻ ở CatalogRows.tsx, bảng Kanban ở CatalogKanban.tsx, lịch ở
// CatalogCalendar.tsx. Dùng cho màn hình danh sách và cho bảng đối tượng con trong màn hình chi tiết; nơi gọi giữ trạng
// thái (trên thanh địa chỉ hoặc trong bộ nhớ), truyền điều kiện cố định nếu có, và chỉ danh sách ngoài cùng có kiểu
// khác bảng.

import { Button, Group, Paper, Select, Stack, Text, TextInput } from "@mantine/core";
import type { FormEvent } from "react";
import { useQuery } from "urql";
import { CatalogCalendar } from "./CatalogCalendar";
import { CatalogKanban } from "./CatalogKanban";
import { RowsCards, RowsTable, ViewControls } from "./CatalogRows";
import { type CatalogNode, type Field, fieldOf, pageSize, type Row } from "./catalog";
import { type ListState, listVariables, rowsQuery, sortOf, type View } from "./catalogQuery";
import { type CalendarConfig, type KanbanConfig, viewOf } from "./catalogViews";
import { Empty, ErrorNotice, Loading } from "./States";

type Props = {
  config: CatalogNode;
  /** Tên của danh sách theo cấu hình (tiêu đề danh mục hay nhãn đối tượng con), dùng trong lời báo danh sách trống */
  label: string;
  /** Đường dẫn của danh sách này; màn hình chi tiết của một dòng là `${path}/${khóa}` */
  path: string;
  state: ListState;
  onChange: (state: ListState) => void;
  /** Điều kiện luôn áp, ví dụ chỉ lấy đối tượng con của một đối tượng cha */
  fixed?: Record<string, unknown>;
  /**
   * Kiểu người xem chọn được (ADR 0050, ADR 0066); chỉ danh sách ngoài cùng có, bảng đối tượng con giữ dạng bảng. Bỏ
   * trống là chỉ bảng, không có nút chọn kiểu.
   */
  views?: View[];
  /** Kiểu khi người xem chưa chọn (`variant` của danh mục, ADR 0061) */
  defaultView?: View;
  kanban?: KanbanConfig;
  calendar?: CalendarConfig;
};

export function CatalogTable(props: Props) {
  const { config, label, path, state, onChange, fixed, views = [], defaultView, kanban, calendar } = props;
  const columns = config.list.columns.map((name) => fieldOf(config, name)).filter((field) => field !== undefined);
  const size = pageSize(config);
  const sort = sortOf(config, state);
  const view = viewOf(views, state.view, defaultView);
  const own = view === "kanban" || view === "calendar";
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Row[] }>({
    query: rowsQuery(config, config.list.columns),
    variables: listVariables(config, state, fixed),
    // Hiện ngay kết quả đã tải rồi đọc lại từ máy chủ: quay về danh sách sau khi dữ liệu đổi không thấy bản cũ mãi.
    requestPolicy: "cache-and-network",
    // Kanban và lịch đọc theo câu riêng của chúng; đọc thêm trang danh sách là một yêu cầu thừa.
    pause: own,
  });
  const rows = data?.rows.slice(0, size) ?? [];
  const hasNext = (data?.rows.length ?? 0) > size;
  const cards = view === "cards";
  const filtering = state.search.trim() !== "" || Object.keys(state.filters).length > 0;

  // Đổi điều kiện tìm, lọc hay thứ tự thì về trang đầu: trang đang xem có thể không còn tồn tại.
  const change = (patch: Partial<ListState>) => onChange({ ...state, page: 0, ...patch });
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    change({ search: String(new FormData(event.currentTarget).get("q") ?? "") });
  };
  const filter = (name: string, value: string | null) => {
    const { [name]: _removed, ...rest } = state.filters;
    change({ filters: value === null ? rest : { ...rest, [name]: value } });
  };
  const toggleSort = (field: Field) =>
    change({
      sort: { field: field.name, direction: sort.field === field.name && sort.direction === "asc" ? "desc" : "asc" },
    });

  return (
    <Stack gap="sm">
      <Group align="flex-end">
        {(config.list.search?.length ?? 0) > 0 && (
          // Tìm khi bấm Enter hoặc nút, không tìm theo từng phím: mỗi lần tìm là một truy vấn tới máy chủ.
          <form onSubmit={search}>
            <Group gap="xs" align="flex-end">
              <TextInput key={state.search} name="q" defaultValue={state.search} aria-label="Tìm" placeholder="Tìm" />
              <Button type="submit" variant="light">
                Tìm
              </Button>
            </Group>
          </form>
        )}
        {(config.list.filters ?? []).map((name) => {
          const field = fieldOf(config, name);
          return (
            field?.choices && (
              <Select
                key={name}
                aria-label={`Lọc theo ${field.label}`}
                placeholder={field.label}
                // Chỉ giá trị và chữ: Select của Mantine không biết tone, khóa lạ có thể thành thuộc tính của phần tử.
                data={field.choices.map(({ value, label }) => ({ value, label }))}
                value={state.filters[name] ?? null}
                onChange={(value) => filter(name, value)}
                clearable
              />
            )
          );
        })}
        {views.length > 1 && (
          <ViewControls
            columns={columns}
            views={views}
            view={view}
            sort={sort}
            // Đổi kiểu hiển thị giữ trang đang xem: cùng dòng, chỉ khác cách vẽ.
            onView={(next) => onChange({ ...state, view: next === (defaultView ?? "table") ? undefined : next })}
            onSort={(next) => change({ sort: next })}
          />
        )}
      </Group>
      {view === "kanban" && kanban && (
        <CatalogKanban
          config={config}
          kanban={kanban}
          columns={columns}
          state={state}
          fixed={fixed}
          path={path}
          label={label}
          onClear={() => change({ search: "", filters: {} })}
        />
      )}
      {view === "calendar" && calendar && (
        <CatalogCalendar
          config={config}
          calendar={calendar}
          state={state}
          fixed={fixed}
          path={path}
          label={label}
          onClear={() => change({ search: "", filters: {} })}
        />
      )}
      {!own && error && (
        <ErrorNotice
          title="Không tải được dữ liệu"
          error={error}
          onRetry={() => reload({ requestPolicy: "network-only" })}
        />
      )}
      {/* Lỗi mà chưa có dữ liệu thì không vẽ bảng rỗng: lời "chưa có dòng nào" lúc đó là sai. */}
      {!own &&
        !(error && !data) &&
        (cards && rows.length > 0 ? (
          <RowsCards config={config} columns={columns} rows={rows} path={path} />
        ) : (
          <Paper withBorder radius="md">
            {!data && fetching ? (
              <Loading />
            ) : rows.length === 0 ? (
              filtering ? (
                <Empty
                  title="Không có dòng nào khớp điều kiện tìm và lọc."
                  action={
                    <Button variant="light" size="xs" onClick={() => change({ search: "", filters: {} })}>
                      Bỏ điều kiện tìm và lọc
                    </Button>
                  }
                />
              ) : (
                <Empty title="Chưa có dòng nào." hint={`${label} chưa có dữ liệu mà tài khoản này được xem.`} />
              )
            ) : (
              <RowsTable
                config={config}
                columns={columns}
                rows={rows}
                path={path}
                label={label}
                sort={sort}
                onSort={toggleSort}
              />
            )}
          </Paper>
        ))}
      {!own && (state.page > 0 || hasNext) && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {rows.length > 0 ? `Dòng ${state.page * size + 1}–${state.page * size + rows.length}` : ""}
          </Text>
          <Group gap="xs">
            <Button
              variant="default"
              disabled={state.page === 0}
              onClick={() => onChange({ ...state, page: state.page - 1 })}
            >
              Trang trước
            </Button>
            <Button variant="default" disabled={!hasNext} onClick={() => onChange({ ...state, page: state.page + 1 })}>
              Trang sau
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}
