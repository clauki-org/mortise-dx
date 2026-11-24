// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần danh mục: danh sách và màn hình chi tiết của một loại đối tượng, hiển thị hoàn toàn theo cấu hình
// của gói (contracts/catalog.schema.json). Thành phần không biết nó nằm ở trang nào: nơi gọi đưa cấu hình và địa
// chỉ gốc, mọi đường dẫn bên dưới địa chỉ gốc do thành phần tự đọc. Ở đây không có tên bảng, tên cột hay chữ của
// một lĩnh vực nào.

import { Alert, Group, Stack, Title } from "@mantine/core";
import { useLocation, useSearchParams } from "react-router";
import { CatalogExport } from "./CatalogExport";
import { CatalogRecord } from "./CatalogRecord";
import { CatalogTable } from "./CatalogTable";
import { type CatalogConfig, configProblems, problemText, resolvePath } from "./catalog";
import { readState, writeState } from "./catalogQuery";

type Props = {
  config: CatalogConfig;
  /** Địa chỉ của trang chứa thành phần, không có dấu / ở cuối. Danh sách nằm ở đây, chi tiết nằm bên dưới. */
  basePath: string;
};

export function Catalog({ config, basePath }: Props) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const problems = configProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình danh mục sai">
        {problemText(problems)}
      </Alert>
    );
  }
  // Đọc địa chỉ thô của trình duyệt thay vì tham số của router: router đổi %2F thành / trước khi trả tham số, nên
  // một khóa chứa dấu / sẽ bị hiểu thành hai đoạn đường dẫn.
  const segments = pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) {
    const state = readState(params);
    return (
      <Stack>
        {/* Nút xuất chỉ ở danh sách ngoài cùng; bảng đối tượng con trong màn hình chi tiết không xuất (ADR 0038). */}
        <Group justify="space-between" align="flex-end">
          <Title order={1} size="h2">
            {config.title}
          </Title>
          <CatalogExport config={config} state={state} />
        </Group>
        <CatalogTable config={config} path={basePath} state={state} onChange={(next) => setParams(writeState(next))} />
      </Stack>
    );
  }
  const steps = resolvePath(config, segments);
  if (!steps) {
    return (
      <Alert color="yellow" title="Không có trang này">
        Đường dẫn không khớp với cấu hình của danh mục.
      </Alert>
    );
  }
  // Mỗi dòng một cây riêng: chuyển sang dòng khác thì trạng thái tìm, lọc, trang của các bảng con bắt đầu lại.
  return <CatalogRecord key={pathname} config={config} basePath={basePath} steps={steps} />;
}
