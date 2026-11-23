// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trợ lý hỏi dữ liệu trên trình duyệt (ADR 0027): cán bộ mở mục menu mẫu của lõi, bấm một câu mẫu và thấy bảng do giao
// diện vẽ cùng câu truy vấn đã chạy. Câu mẫu chạy không qua mô hình, nên bài chạy được khi chưa bật Ollama. Cần
// `make seed` (văn bản mẫu và mục menu mẫu của lõi).

import { expect, test } from "@playwright/test";
import { signIn } from "./support.ts";

test("câu mẫu chạy ngay, hiện bảng văn bản mẫu và câu truy vấn đã chạy", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "user.a");
  await page.getByRole("link", { name: "Hỏi dữ liệu mẫu" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hỏi dữ liệu" })).toBeVisible();

  await page.getByRole("button", { name: "Đơn vị mình có những văn bản mẫu nào?" }).click();

  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Tên văn bản" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Quy chế mẫu về đặt phòng họp (hư cấu)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Câu truy vấn đã chạy" })).toBeVisible();
  await expect(page.getByText("platform_knowledge_documents(where:")).toBeVisible();
});
