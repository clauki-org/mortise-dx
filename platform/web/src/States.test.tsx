// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm ba trạng thái dùng chung (States.tsx): nhãn đang tải luôn bắt đầu bằng "Đang tải", khối lỗi là role="alert",
// lời dễ hiểu đứng trước và thông điệp gốc nằm trong phần "Chi tiết kỹ thuật" đóng sẵn, nút "Thử lại" chỉ có khi nơi
// gọi tải lại được. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { Empty, ErrorNotice, Loading } from "./States";

const render = (node: ReactNode) => renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);

describe("Loading", () => {
  it("nhãn bắt đầu bằng Đang tải", () => {
    expect(render(<Loading />)).toContain('aria-label="Đang tải"');
    expect(render(<Loading what="hồ sơ" inline />)).toContain('aria-label="Đang tải hồ sơ"');
  });
});

describe("Empty", () => {
  it("hiện câu chính, việc nên làm và nút", () => {
    const html = render(
      <Empty title="Chưa có dòng nào." hint="Thêm dòng mới." action={<button type="button">X</button>} />,
    );
    expect(html).toContain("Chưa có dòng nào.");
    expect(html).toContain("Thêm dòng mới.");
    expect(html).toContain("<button");
  });
});

describe("ErrorNotice", () => {
  it("lời dễ hiểu trong khối alert, nguyên văn sau Chi tiết kỹ thuật", () => {
    const html = render(
      <ErrorNotice title="Không tải được dữ liệu" error={new ApiError(502, "Máy chủ trả lỗi 502", false)} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Không tải được dữ liệu");
    expect(html).toContain("Máy chủ đang gặp sự cố");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Chi tiết kỹ thuật<\/summary>.*Máy chủ trả lỗi 502/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).not.toContain(">Thử lại<");
  });

  it("có nút Thử lại khi tải lại được", () => {
    expect(render(<ErrorNotice title="T" error={new Error("x")} onRetry={() => undefined} />)).toContain(">Thử lại<");
  });
});
