// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nút "Xuất" trên màn hình danh sách của thành phần danh mục (ADR 0052): chọn CSV, Excel hay PDF. Đọc qua client
// GraphQL của trang, tức bằng token của người đang đăng nhập: tệp chỉ chứa dòng Hasura cho người đó đọc, như trên màn
// hình. Dựng tệp và tải về ngay trong trình duyệt, không qua dịch vụ nào khác. Bảng xuất ở catalogExport.ts; Excel
// và PDF ở catalogExportOffice.ts.

import { Alert, Button, Menu } from "@mantine/core";
import { useState } from "react";
import { useClient } from "urql";
import type { CatalogConfig, Row } from "./catalog";
import {
  buildCsv,
  describeConditions,
  type ExportTable,
  exportTable,
  exportVariables,
  fileName,
  readAll,
  TooManyRows,
} from "./catalogExport";
import { pdfBlob, xlsxBlob } from "./catalogExportOffice";
import { type ListState, rowsQuery } from "./catalogQuery";
import { withCustomColumn } from "./customFields";
import { useSession } from "./session";
import { useCustomFields } from "./useCustomFields";

type Format = { label: string; extension: string; write: (table: ExportTable) => Promise<Blob> };

const FORMATS: Format[] = [
  {
    label: "CSV",
    extension: "csv",
    write: async (table) => new Blob([buildCsv(table)], { type: "text/csv;charset=utf-8" }),
  },
  { label: "Excel (.xlsx)", extension: "xlsx", write: xlsxBlob },
  { label: "PDF", extension: "pdf", write: pdfBlob },
];

export function CatalogExport({ config, state }: { config: CatalogConfig; state: ListState }) {
  const client = useClient();
  const { user } = useSession();
  const custom = useCustomFields(config.source);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (format: Format) => {
    setBusy(true);
    setProblem(null);
    try {
      const query = rowsQuery(config, withCustomColumn(config.list.columns, custom.fields));
      const rows = await readAll(async (limit) => {
        // network-only: tệp phải là dữ liệu lúc bấm, không phải bản đã lưu khi xem các trang trước.
        const result = await client
          .query<{ rows: Row[] }>(query, exportVariables(config, state, limit), { requestPolicy: "network-only" })
          .toPromise();
        if (result.error || !result.data) throw new Error(result.error?.message ?? "Không đọc được dữ liệu");
        return result.data.rows;
      });
      const exportedAt = new Date();
      const table = exportTable(
        config,
        {
          title: config.title,
          source: config.source,
          tenant: tenantOf(user.profile),
          user: user.profile.preferred_username ?? user.profile.sub,
          exportedAt,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          conditions: describeConditions(config, state),
        },
        rows,
        custom.fields,
      );
      download(await format.write(table), fileName(config.title, exportedAt, format.extension));
    } catch (error) {
      // Đọc hay dựng tệp lỗi thì không tải tệp nào: một tệp thiếu dòng trông vẫn như tệp đủ.
      if (error instanceof TooManyRows) setProblem(error.message);
      else {
        const reason = error instanceof Error ? error.message : String(error);
        setProblem(`${reason}. Thử xuất lại; nếu vẫn lỗi, báo người quản trị kiểm quyền đọc của mục này.`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Menu position="bottom-end">
        {/* Chờ định nghĩa trường tùy chỉnh: xuất trước lúc đó thì tệp thiếu cột mà màn hình sắp hiện. */}
        <Menu.Target>
          <Button variant="default" loading={busy || !custom.settled}>
            Xuất
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {FORMATS.map((format) => (
            <Menu.Item key={format.extension} onClick={() => run(format)}>
              {format.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      {problem && (
        <Alert color="red" title="Không xuất được tệp" withCloseButton onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}
    </>
  );
}

// Đơn vị lấy từ claim `tenant` của token (contracts/token-claims.schema.json), để người nhận biết tệp của đơn vị nào.
function tenantOf(profile: Record<string, unknown>): string {
  const tenant = profile.tenant;
  return Array.isArray(tenant) && typeof tenant[0] === "string" ? tenant[0] : "";
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Trình duyệt đã bắt đầu tải khi click trả về; giải phóng ngay thì một số trình duyệt hủy tải, nên chờ một nhịp.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
