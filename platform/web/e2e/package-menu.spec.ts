// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu của mọi gói đã cài trên trình duyệt: với mỗi mục menu mà cán bộ xã A thấy qua GraphQL, nhãn của mục có trên
// menu, bấm vào thì mở đúng trang của mục, trang biểu mẫu hiện tiêu đề theo cấu hình, và trang danh mục hiện tiêu
// đề, cột theo cấu hình của gói, tải được dữ liệu; có dòng thì mở chi tiết dòng đầu cùng các bảng con. Bài đọc mục và cấu hình từ platform_menu_items nên không
// biết gói nào hay từ ngữ của lĩnh vực nào: gói mới cài vào được kiểm mà không phải sửa bài. Bài không kiểm một gói
// cụ thể có mục menu; việc đó thuộc smoke của từng gói. Cần ít nhất một gói có mục menu đã cài (`make app-install`).

import { expect, test } from "@playwright/test";
import { graphql, signIn } from "./support.ts";

type Field = { name: string; label: string };
type CatalogConfig = {
  title: string;
  fields: Field[];
  list: { columns: string[] };
  detail?: { children?: { label: string }[] };
};
type MenuItem = {
  app: string;
  item: string;
  label: string;
  component: string;
  config: unknown;
  roles: string[] | null;
};

const USER = "user.a";
// Vai trò realm của tài khoản cán bộ demo; mục chỉ dành cho vai trò khác thì giao diện không hiện, bài bỏ qua.
const ROLE = "user";

const MENU_QUERY =
  "{ platform_menu_items(order_by: [{ app: asc }, { position: asc }]) { app item label component config roles } }";

test("mỗi mục menu của gói đã cài hiện trên menu và mở được trang theo cấu hình của gói", async ({ page, request }) => {
  const data = await graphql<{ platform_menu_items: MenuItem[] }>(request, USER, MENU_QUERY);
  const items = data.platform_menu_items.filter((entry) => !entry.roles?.length || entry.roles.includes(ROLE));
  expect(items.length, "cần ít nhất một gói có mục menu đã cài (make app-install APP=<gói>)").toBeGreaterThan(0);

  await page.goto("/");
  await signIn(page, USER);
  for (const entry of items) {
    await test.step(`${entry.app} / ${entry.item}`, async () => {
      await page.getByRole("link", { name: entry.label, exact: true }).click();
      // Danh sách giữ tìm, lọc, trang trên chuỗi truy vấn, nên chỉ so phần đường dẫn.
      await expect(page).toHaveURL(new RegExp(`/apps/${entry.app}/${entry.item}(\\?.*)?$`));
      // Mọi mục phải mở được thành phần của nó, không rơi vào thông báo giao diện chưa có thành phần.
      await expect(page.getByText("Chưa mở được mục này")).toHaveCount(0);
      // Biểu mẫu: tiêu đề theo cấu hình, ô nhập hoặc lời báo vai trò, không báo cấu hình sai.
      if (entry.component === "form") {
        await expect(
          page.getByRole("heading", { level: 1, name: (entry.config as { title: string }).title }),
        ).toBeVisible();
        await expect(page.getByText("Cấu hình biểu mẫu sai")).toHaveCount(0);
        return;
      }
      // Thành phần khác danh mục và biểu mẫu chỉ kiểm nhãn và đường dẫn ở trên.
      if (entry.component !== "catalog") return;
      const config = entry.config as CatalogConfig;
      await expect(page.getByRole("heading", { level: 1, name: config.title })).toBeVisible();
      // Bảng đã tải (có dòng) hoặc báo chưa có dòng nào; cả hai đều là đã đọc được dữ liệu qua quyền của người dùng.
      const table = page.getByRole("table");
      await expect(table.or(page.getByText("Chưa có dòng nào."))).toBeVisible();
      await expect(page.getByText("Không tải được dữ liệu")).toHaveCount(0);
      if (!(await table.isVisible())) return;
      for (const column of config.list.columns) {
        const label = config.fields.find((field) => field.name === column)?.label ?? column;
        await expect(table.getByRole("columnheader", { name: label })).toBeVisible();
      }
      // Dòng đầu mở màn hình chi tiết: khóa của dòng và cột nối về cha do cấu hình chọn (có thể là cột chữ thay vì
      // id), nên chi tiết và từng bảng con phải đọc được dữ liệu, không báo lỗi hay "không tìm thấy".
      await table.getByRole("link").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      for (const child of config.detail?.children ?? []) {
        await expect(page.getByRole("heading", { level: 2, name: child.label })).toBeVisible();
      }
      await expect(page.getByLabel("Đang tải")).toHaveCount(0);
      await expect(page.getByText("Không tải được dữ liệu")).toHaveCount(0);
      await expect(page.getByText("Không tìm thấy dòng này")).toHaveCount(0);
    });
  }
});
