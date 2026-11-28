// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình soạn cấu hình gói trên trình duyệt (ADR 0071): quản trị xã A (tenant con) mở "Soạn cấu hình gói" từ nhóm
// "Chung", gõ nhu cầu và gửi; có mô hình thì hiện kết quả của bước kiểm kèm dòng ghi mô hình đã soạn (độ đúng của bản
// nháp đo riêng ở docs/assistant-eval/), chưa có mô hình thì hiện thông điệp chỉ cách bật. Cán bộ không thấy mục,
// mở thẳng đường dẫn thì được báo không có quyền. Cần `make seed`.

import { expect, test } from "@playwright/test";
import { openMenuItem, signIn } from "./support.ts";

test("quản trị đơn vị con gửi nhu cầu: bản nháp hay thông điệp chỉ cách bật mô hình", async ({ page }) => {
  // Hai lượt viết của mô hình chung một hạn ASSISTANT_TIMEOUT_SECONDS; cổng chờ tối đa 200 giây.
  test.setTimeout(200_000);
  await page.goto("/");
  await signIn(page, "admin.a");
  await openMenuItem(page, "Soạn cấu hình gói");
  await expect(page.getByRole("heading", { level: 1, name: "Soạn cấu hình gói" })).toBeVisible();

  const submit = page.getByRole("button", { name: "Soạn bản nháp" });
  await expect(submit).toBeDisabled();
  await page
    .getByLabel("Nhu cầu")
    .fill("Cần danh sách đối tượng có mã, tên, trạng thái và một biểu mẫu để thêm đối tượng mới.");
  await submit.click();

  // Dòng "Soạn bởi ..." hiện với mọi kết quả có gọi mô hình: qua bước kiểm, còn lỗi hay mô hình từ chối.
  const drafted = page.getByText(/^Soạn bởi .+, (chạy tại chỗ|qua API )/);
  const notRunning = page.getByRole("alert").filter({ hasText: "make ai-up" });
  await expect(drafted.or(notRunning)).toBeVisible({ timeout: 190_000 });
});

test("cán bộ không thấy mục, mở thẳng đường dẫn thì được báo không có quyền", async ({ page }) => {
  await page.goto("/");
  await signIn(page, "user.a");
  const nav = page.getByRole("navigation", { name: "Menu chính" });
  await expect(nav.getByRole("link", { name: "Việc của tôi", includeHidden: true })).toBeAttached();
  await expect(nav.getByRole("link", { name: "Soạn cấu hình gói", includeHidden: true })).toHaveCount(0);

  await page.goto("/package-drafts");
  await expect(page.getByText("Chỉ quản trị đơn vị mở được trang này")).toBeVisible();
  await expect(page.getByRole("button", { name: "Soạn bản nháp" })).toHaveCount(0);
});
