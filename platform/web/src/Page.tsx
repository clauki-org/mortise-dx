// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần trang (ADR 0061, contracts/page.schema.json): tiêu đề, đoạn giới thiệu và các khối theo thứ tự gói khai,
// mỗi khối là một mục menu hay khối của chính gói (Block.tsx). Khối không biết nhau và đọc dữ liệu bằng token của
// người xem như khi đứng riêng. Mục dành cho vai trò khác không có trong menu của người xem nên khối của nó không hiện,
// không để lại lời báo lộ menu của người khác.

import { Alert, Stack } from "@mantine/core";
import { Block } from "./Block";
import { findItem } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { PageHeader } from "./PageHeader";
import { type PageConfig, pageProblems } from "./page";
import { Empty } from "./States";

export function Page({ config, app }: { config: PageConfig; app: string }) {
  const { items } = usePackageMenu();
  const problems = pageProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình trang sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  const blocks = config.blocks.flatMap((block) => {
    const entry = findItem(items, app, block.item);
    return entry ? [{ entry, variant: block.variant }] : [];
  });
  return (
    <Stack>
      <PageHeader title={config.title} description={config.description} />
      {blocks.length === 0 && <Empty title="Trang chưa có khối nào mà tài khoản này được xem." />}
      {/* Khóa theo vị trí: một mục được đặt nhiều lần với kiểu khác nhau, nên item không duy nhất. */}
      {blocks.map(({ entry, variant }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: danh sách khối cố định theo cấu hình, không đổi thứ tự khi vẽ.
        <Block key={index} entry={entry} variant={variant} />
      ))}
    </Stack>
  );
}
