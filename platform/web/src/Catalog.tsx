// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần danh mục: danh sách và màn hình chi tiết của một loại đối tượng, hiển thị hoàn toàn theo cấu hình
// của gói (contracts/catalog.schema.json). Thành phần không biết nó nằm ở trang nào: nơi gọi đưa cấu hình và địa
// chỉ gốc, mọi đường dẫn bên dưới địa chỉ gốc do thành phần tự đọc. Ở đây không có tên bảng, tên cột hay chữ của
// một lĩnh vực nào.

import { Alert, Stack } from "@mantine/core";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { recordWhere, useBlock } from "./blockContext";
import { CatalogExport } from "./CatalogExport";
import { CatalogRecord } from "./CatalogRecord";
import { CatalogTable } from "./CatalogTable";
import { type CatalogConfig, configProblems, problemText, resolvePath } from "./catalog";
import { emptyState, readState, writeState } from "./catalogQuery";
import { viewOf, viewProblems, viewsOf } from "./catalogViews";
import { PageHeader } from "./PageHeader";

/** Kiểu của danh sách ngoài cùng: kiểu vẽ được và kiểu mặc định; Kanban, Lịch thiếu mục cấu hình thì về bảng. */
const listViews = (config: CatalogConfig) => {
  const views = viewsOf(config);
  return {
    views,
    defaultView: viewOf(views, config.variant, undefined),
    kanban: config.kanban,
    calendar: config.calendar,
  };
};

type Props = {
  config: CatalogConfig;
  /** Địa chỉ của trang chứa thành phần, không có dấu / ở cuối. Danh sách nằm ở đây, chi tiết nằm bên dưới. */
  basePath: string;
  /** Gói và mục của danh mục: chi tiết dòng tìm khối của gói (detail.blocks, ADR 0068) theo đây */
  app: string;
  item: string;
};

/**
 * Danh sách đặt trong một khối của trang (ADR 0061): trạng thái tìm, lọc, trang nằm trong bộ nhớ vì thanh địa chỉ là
 * của trang và có thể có khối danh mục khác cùng trang. Dòng vẫn dẫn tới màn hình chi tiết dưới địa chỉ của mục.
 * Trong chi tiết một dòng (ADR 0068), danh sách chỉ có dòng thuộc dòng đang xem khi gói gắn bảng này.
 */
function BlockList({ config, basePath }: Pick<Props, "config" | "basePath">) {
  const [state, setState] = useState(emptyState);
  const fixed = recordWhere(useBlock(), config.source);
  return (
    <Stack>
      <PageHeader title={config.title} />
      <CatalogTable
        config={config}
        label={config.title}
        path={basePath}
        state={state}
        onChange={setState}
        {...listViews(config)}
        fixed={fixed}
      />
    </Stack>
  );
}

export function Catalog({ config, basePath, app, item }: Props) {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const block = useBlock();
  const problems = [...configProblems(config), ...viewProblems(config)];
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình danh mục sai">
        {problemText(problems)}
      </Alert>
    );
  }
  if (block) return <BlockList config={config} basePath={basePath} />;
  // Đọc địa chỉ thô của trình duyệt thay vì tham số của router: router đổi %2F thành / trước khi trả tham số, nên
  // một khóa chứa dấu / sẽ bị hiểu thành hai đoạn đường dẫn.
  const segments = pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 0) {
    const state = readState(params);
    return (
      <Stack>
        {/* Nút xuất chỉ ở danh sách ngoài cùng; bảng đối tượng con trong màn hình chi tiết không xuất (ADR 0052). */}
        <PageHeader title={config.title} action={<CatalogExport config={config} state={state} />} />
        <CatalogTable
          config={config}
          label={config.title}
          path={basePath}
          state={state}
          onChange={(next) => setParams(writeState(next))}
          {...listViews(config)}
        />
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
  return <CatalogRecord key={pathname} config={config} basePath={basePath} steps={steps} app={app} item={item} />;
}
