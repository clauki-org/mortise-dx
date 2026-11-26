// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bảng của thành phần danh mục: ô tìm, ô lọc, cột sắp xếp được và phân trang, tất cả theo cấu hình của gói
// (catalog.ts, catalogQuery.ts). Dùng cho màn hình danh sách và cho bảng đối tượng con trong màn hình chi tiết; nơi gọi giữ trạng
// thái (trên thanh địa chỉ hoặc trong bộ nhớ) và truyền điều kiện cố định nếu có.

import { Anchor, Button, Group, Paper, Select, Stack, Table, Text, TextInput, UnstyledButton } from "@mantine/core";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "urql";
import { type CatalogNode, display, type Field, fieldOf, keyOf, pageSize, type Row } from "./catalog";
import { type ListState, listVariables, rowsQuery, sortOf } from "./catalogQuery";
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
};

export function CatalogTable({ config, label, path, state, onChange, fixed }: Props) {
  const columns = config.list.columns.map((name) => fieldOf(config, name)).filter((field) => field !== undefined);
  const size = pageSize(config);
  const sort = sortOf(config, state);
  const [{ data, fetching, error }, reload] = useQuery<{ rows: Row[] }>({
    query: rowsQuery(config, config.list.columns),
    variables: listVariables(config, state, fixed),
    // Hiện ngay kết quả đã tải rồi đọc lại từ máy chủ: quay về danh sách sau khi dữ liệu đổi không thấy bản cũ mãi.
    requestPolicy: "cache-and-network",
  });
  const rows = data?.rows.slice(0, size) ?? [];
  const hasNext = (data?.rows.length ?? 0) > size;
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
                data={field.choices}
                value={state.filters[name] ?? null}
                onChange={(value) => filter(name, value)}
                clearable
              />
            )
          );
        })}
      </Group>
      {error && (
        <ErrorNotice
          title="Không tải được dữ liệu"
          error={error}
          onRetry={() => reload({ requestPolicy: "network-only" })}
        />
      )}
      {/* Lỗi mà chưa có dữ liệu thì không vẽ bảng rỗng: lời "chưa có dòng nào" lúc đó là sai. */}
      {!(error && !data) && (
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
            <Table.ScrollContainer minWidth={480}>
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
                          <UnstyledButton
                            fw={700}
                            fz="sm"
                            onClick={() => toggleSort(field)}
                            title="Sắp xếp theo cột này"
                          >
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
                    const key = String(row[keyOf(config)]);
                    return (
                      <Table.Tr key={key}>
                        {columns.map((field, index) => (
                          <Table.Td key={field.name} ta={field.type === "number" ? "right" : undefined}>
                            {index === 0 ? (
                              <Anchor component={Link} to={`${path}/${encodeURIComponent(key)}`} fw={500}>
                                {display(field, row[field.name]) || key}
                              </Anchor>
                            ) : (
                              display(field, row[field.name])
                            )}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>
      )}
      {(state.page > 0 || hasNext) && (
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
