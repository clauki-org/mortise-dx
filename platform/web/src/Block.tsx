// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Một khối trên trang (ADR 0061): vẽ thành phần của một mục menu hay khối của gói với cấu hình của mục, kiểu chọn ở
// trang đè lên kiểu của mục. Mỗi khối có ranh giới lỗi riêng: lỗi lúc vẽ một khối chỉ thành lời báo chung (States.tsx)
// trong khối đó, các khối khác và khung trang vẫn chạy. Không có ranh giới này thì lỗi lên tới màn hình lỗi của router
// và cả trang mất.

import { Alert, Paper, Stack } from "@mantine/core";
import { Component, type ReactNode } from "react";
import { BlockContext } from "./blockContext";
import { itemPath, type MenuItem } from "./menu";
import { COMPONENTS } from "./PackagePage";
import { withVariant } from "./page";
import { ErrorNotice } from "./States";

type Failure = { error?: Error };

/** Lời báo khi khối hỏng lúc vẽ; tách riêng để kiểm thử được mà không cần gây lỗi trong trình duyệt. */
export function BlockFailure({ label, error }: { label: string; error: Error }) {
  return (
    <ErrorNotice title={`Khối "${label}" gặp lỗi`} error={error}>
      Các khối khác trên trang vẫn dùng được. Tải lại trang để thử lại khối này.
    </ErrorNotice>
  );
}

export class BlockBoundary extends Component<{ label: string; children: ReactNode }, Failure> {
  state: Failure = {};

  static getDerivedStateFromError(error: unknown): Failure {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <BlockFailure label={this.props.label} error={this.state.error} />;
  }
}

function BlockBody({ entry, variant }: { entry: MenuItem; variant?: string }) {
  // Trang lồng trang có thể chứa chính nó và vẽ không bao giờ xong; make check-fast đã chặn, đây là lớp đỡ cho dữ
  // liệu không qua bước kiểm đó.
  const render = entry.component === "page" ? undefined : COMPONENTS.get(entry.component);
  if (!render) {
    return (
      <Alert color="yellow" title="Chưa mở được khối này">
        Giao diện chưa có thành phần "{entry.component}" cho khối trên trang.
      </Alert>
    );
  }
  const config = withVariant(entry.config, entry.component, variant);
  return <>{render(config, itemPath(entry), entry.app, entry.item)}</>;
}

/** Khối của mục `entry`; `variant` là kiểu chọn ở trang, bỏ trống thì dùng kiểu trong cấu hình của mục. */
export function Block({ entry, variant }: { entry: MenuItem; variant?: string }) {
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-label={entry.label}>
      <Stack>
        <BlockBoundary label={entry.label}>
          <BlockContext value={{ app: entry.app, item: entry.item }}>
            <BlockBody entry={entry} variant={variant} />
          </BlockContext>
        </BlockBoundary>
      </Stack>
    </Paper>
  );
}
