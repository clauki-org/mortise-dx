// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình chi tiết của thành phần danh mục: mọi trường của một dòng theo thứ tự gói khai, xếp thành lưới ô (ADR
// 0050), bảng của từng loại đối tượng con (detail.children) kèm nút thêm dòng con, nút sửa dòng (detail.edit, ADR
// 0054), nút khởi tạo quy trình (detail.actions), tài liệu đính kèm (detail.documents) và đường về các đối tượng cha. Catalog.tsx mở màn hình này sau khi đã kiểm cấu hình và đọc đường dẫn thành các chặng
// từ đối tượng ngoài cùng tới dòng đang xem.

import { Alert, Anchor, Box, Breadcrumbs, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "urql";
import { CatalogActions } from "./CatalogActions";
import { CatalogDocuments } from "./CatalogDocuments";
import { CatalogForm } from "./CatalogForm";
import { CellValue } from "./CatalogRows";
import { CatalogTable } from "./CatalogTable";
import {
  type CatalogConfig,
  type Child,
  display,
  fieldOf,
  fieldValue,
  keyOf,
  type Row,
  type Step,
  titleField,
} from "./catalog";
import { chainQuery, chainVariables, emptyState } from "./catalogQuery";
import { PageHeader } from "./PageHeader";
import { ErrorNotice, Loading } from "./States";

/** Tiêu đề của một dòng theo cấu hình; trường tiêu đề trống thì dùng giá trị khóa. */
function titleOf(step: Step, row: Row): string {
  const field = fieldOf(step.node, titleField(step.node));
  return (field && display(field, row[field.name])) || step.key;
}

type ChildrenProps = { child: Child; path: string; parentKey: unknown; parent: { label: string; text: string } };

/** Ô chỉ đọc của biểu mẫu thêm dòng con: tên bảng cha làm nhãn, giá trị của trường add.parent (bỏ trống là tiêu đề). */
function parentShown(step: Step, child: Child, row: Row, label: string) {
  const name = child.add?.parent ?? titleField(step.node);
  const field = fieldOf(step.node, name);
  const value = fieldValue(row, name);
  return { label, text: (field ? display(field, value) : String(value ?? "")) || step.key };
}

function Children({ child, path, parentKey, parent }: ChildrenProps) {
  const [state, setState] = useState(emptyState);
  // Dựng lại bảng sau khi thêm dòng: bảng đang trống không mang kiểu của bảng con trong kết quả, nên urql không tự
  // biết phải đọc lại, và lời "chưa có dòng nào" sẽ còn đó dù vừa thêm.
  const [added, setAdded] = useState(0);
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-start">
        <Title order={2} size="h4">
          {child.label}
        </Title>
        {child.add && (
          <CatalogForm
            label={child.add.label}
            form={child.add.form}
            target={{ kind: "insert", via: child.via, parentKey, shown: parent }}
            onSaved={() => setAdded((count) => count + 1)}
          />
        )}
      </Group>
      <CatalogTable
        key={added}
        config={child}
        label={child.label}
        path={path}
        state={state}
        onChange={setState}
        fixed={{ [child.via]: { _eq: parentKey } }}
      />
    </Stack>
  );
}

type Props = {
  config: CatalogConfig;
  basePath: string;
  /** Các chặng từ đối tượng ngoài cùng tới dòng đang xem; chặng cuối là dòng này */
  steps: Step[];
};

export function CatalogRecord({ config, basePath, steps }: Props) {
  const current = steps[steps.length - 1];
  if (!current) throw new Error("CatalogRecord cần ít nhất một chặng");
  const [{ data, fetching, error }, reload] = useQuery<Record<string, Row[]>>({
    query: chainQuery(steps),
    variables: chainVariables(steps),
    // Hiện ngay kết quả đã tải rồi đọc lại từ máy chủ, để dòng vừa đổi ở nơi khác không hiện bản cũ mãi.
    requestPolicy: "cache-and-network",
  });
  if (error) {
    return (
      <ErrorNotice
        title="Không tải được dữ liệu"
        error={error}
        onRetry={() => reload({ requestPolicy: "network-only" })}
      />
    );
  }
  if (!data && fetching) return <Loading />;
  const rows = steps.map((_, index) => data?.[`s${index}`]?.[0]);
  const row = rows[rows.length - 1];
  if (!row || rows.some((found) => found === undefined)) {
    return (
      <Stack align="flex-start">
        <Alert color="yellow" title="Không tìm thấy dòng này">
          Dòng đã bị xóa, đường dẫn sai, hoặc dòng thuộc đơn vị khác.
        </Alert>
        <Anchor component={Link} to={basePath}>
          Về {config.title}
        </Anchor>
      </Stack>
    );
  }
  const node = current.node;
  // Tên của loại đối tượng đang xem: tiêu đề danh mục ở chặng đầu, nhãn của bảng con ở các chặng sau.
  const label = steps.length === 1 ? config.title : ((node as Child).label ?? config.title);
  const here = `${basePath}/${current.path}`;

  return (
    <Stack>
      <PageHeader
        before={
          <Breadcrumbs>
            <Anchor component={Link} to={basePath}>
              {config.title}
            </Anchor>
            {steps.slice(0, -1).map((step, index) => (
              <Anchor key={step.path} component={Link} to={`${basePath}/${step.path}`}>
                {titleOf(step, rows[index] ?? {})}
              </Anchor>
            ))}
          </Breadcrumbs>
        }
        title={titleOf(current, row)}
        action={
          <Group align="flex-start">
            <CatalogActions node={node} row={row} />
            {node.detail?.edit && (
              <CatalogForm
                label={node.detail.edit.label}
                form={node.detail.edit.form}
                target={{ kind: "update", key: keyOf(node), keyValue: row[keyOf(node)] }}
                onSaved={() => reload({ requestPolicy: "network-only" })}
                // Nút đầu của màn hình chi tiết là nút chính (ADR 0047): không có nút quy trình nào thì là nút sửa.
                primary={(node.detail?.actions ?? []).length === 0}
              />
            )}
          </Group>
        }
      />
      {/* Mỗi trường một ô (ADR 0050): danh sách định nghĩa để trình đọc màn hình đọc nhãn rồi giá trị như bảng dọc cũ. */}
      <SimpleGrid component="dl" cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" m={0}>
        {node.fields.map((field) => (
          <Paper key={field.name} withBorder radius="md" px="md" py="sm">
            <Text component="dt" size="sm" c="dimmed">
              {field.label}
            </Text>
            <Box component="dd" m={0} mt={4} fw={600} style={{ overflowWrap: "anywhere" }}>
              <CellValue field={field} value={fieldValue(row, field.name)} />
            </Box>
          </Paper>
        ))}
      </SimpleGrid>
      {node.detail?.documents && <CatalogDocuments config={node.detail.documents} recordKey={row[keyOf(node)]} />}
      {(node.detail?.children ?? []).map((child) => (
        <Children
          key={child.id}
          child={child}
          path={`${here}/${child.id}`}
          parentKey={row[keyOf(node)]}
          parent={parentShown(current, child, row, label)}
        />
      ))}
    </Stack>
  );
}
