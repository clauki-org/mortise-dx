// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trợ lý hỏi dữ liệu trên trình duyệt (ADR 0027, ADR 0034): cán bộ mở mục menu mẫu của lõi, bấm một câu mẫu và thấy
// bảng do giao diện vẽ cùng câu truy vấn đã chạy; câu mẫu chạy không qua mô hình, nên bài đầu chạy được khi chưa có mô
// hình. Bài thứ hai gõ câu hỏi tự do: có mô hình thì hiện dòng ghi mô hình đã viết câu (kết quả hay lời từ chối đều
// được, độ đúng đo bằng bộ câu hỏi riêng); chưa có mô hình thì hiện thông điệp chỉ cách bật. Cần `make seed`.

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

test("câu hỏi gõ tự do: mô hình viết câu truy vấn, hay thông điệp chỉ cách bật mô hình", async ({ page }) => {
  // Mô hình trên CPU có thể mất tới ASSISTANT_TIMEOUT_SECONDS cho hai lượt viết; cổng chờ tối đa 200 giây.
  test.setTimeout(200_000);
  await page.goto("/");
  await signIn(page, "user.a");
  await page.getByRole("link", { name: "Hỏi dữ liệu mẫu" }).click();

  await page.getByLabel("Câu hỏi").fill("Đơn vị mình có bao nhiêu văn bản mẫu?");
  await page.getByRole("button", { name: "Hỏi", exact: true }).click();

  // Dòng "Câu truy vấn do ... viết" hiện với mọi kết quả có gọi mô hình, kể cả khi mô hình từ chối (không có khối câu).
  const written = page.getByText(/^Câu truy vấn do .+ viết, (chạy tại chỗ|qua API )/);
  const notRunning = page.getByRole("alert").filter({ hasText: "make ai-up" });
  await expect(written.or(notRunning)).toBeVisible({ timeout: 190_000 });
});
