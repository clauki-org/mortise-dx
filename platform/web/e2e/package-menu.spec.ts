// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu của mọi gói đã cài trên trình duyệt: với mỗi mục menu mà cán bộ xã A thấy qua GraphQL, nhãn của mục có trên
// menu, bấm vào thì mở đúng trang của mục, trang biểu mẫu và bảng điều hành hiện tiêu đề theo cấu hình (bảng điều hành
// đọc được số liệu của mọi khối hiện ra), và trang danh mục hiện tiêu đề, cột theo cấu hình của gói, tải được dữ liệu,
// chuyển được sang dạng thẻ và về; có dòng thì mở chi tiết dòng đầu, thấy mọi trường thành ô, cùng các bảng con. Bài
// đọc mục và cấu hình từ platform_menu_items nên không biết gói nào hay từ ngữ của lĩnh vực nào: gói mới cài vào được
// kiểm mà không phải sửa bài. Bài không kiểm một gói cụ thể có mục menu; việc đó thuộc smoke của từng gói. Cần ít nhất
// một gói có mục menu đã cài (`make app-install`). Trang gồm khối (ADR 0061) được kiểm tiêu đề và không có khối hỏng.

import { expect, test } from "@playwright/test";
import { graphql, openMenuItem, signIn } from "./support.ts";

type Field = { name: string; label: string };
type CatalogConfig = {
  title: string;
  fields: Field[];
  list: { columns: string[] };
  detail?: { children?: { label: string }[]; text?: { field: string; title: string } };
};
type MenuItem = {
  app: string;
  item: string;
  label: string;
  component: string;
  config: unknown;
  roles: string[] | null;
  on_menu: boolean;
};

const USER = "user.a";

/** Thoát ký tự đặc biệt của biểu thức chính quy trong nhãn của gói (nhãn có thể chứa ngoặc, như "(m²)"). */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Vai trò realm của tài khoản cán bộ demo; mục chỉ dành cho vai trò khác thì giao diện không hiện, bài bỏ qua.
const ROLE = "user";

const MENU_QUERY =
  "{ platform_menu_items(order_by: [{ app: asc }, { position: asc }]) { app item label component config roles on_menu } }";

test("mỗi mục menu của gói đã cài hiện trên menu và mở được trang theo cấu hình của gói", async ({ page, request }) => {
  const data = await graphql<{ platform_menu_items: MenuItem[] }>(request, USER, MENU_QUERY);
  // Khối chỉ đặt trên trang (on_menu false, ADR 0061) không có trên menu; trang chứa nó kiểm khối đó.
  const items = data.platform_menu_items.filter(
    (entry) => entry.on_menu && (!entry.roles?.length || entry.roles.includes(ROLE)),
  );
  expect(items.length, "cần ít nhất một gói có mục menu đã cài (make app-install APP=<gói>)").toBeGreaterThan(0);

  await page.goto("/");
  await signIn(page, USER);
  for (const entry of items) {
    await test.step(`${entry.app} / ${entry.item}`, async () => {
      await openMenuItem(page, entry.label);
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
      // Bảng điều hành: tiêu đề theo cấu hình, không báo cấu hình sai, khối nào hiện cũng đọc được số liệu.
      if (entry.component === "dashboard") {
        await expect(
          page.getByRole("heading", { level: 1, name: (entry.config as { title: string }).title }),
        ).toBeVisible();
        await expect(page.getByLabel(/^Đang tải/)).toHaveCount(0);
        await expect(page.getByText("Cấu hình bảng điều hành sai")).toHaveCount(0);
        await expect(page.getByText("Không đọc được số liệu", { exact: false })).toHaveCount(0);
        return;
      }
      // Trang gồm khối: một h1 theo cấu hình, không khối nào hỏng lúc vẽ hay thiếu thành phần.
      if (entry.component === "page") {
        await expect(page.getByRole("heading", { level: 1 })).toHaveText((entry.config as { title: string }).title);
        await expect(page.getByLabel(/^Đang tải/)).toHaveCount(0);
        await expect(page.getByText(/^Khối ".*" gặp lỗi$/)).toHaveCount(0);
        await expect(page.getByText("Chưa mở được khối này")).toHaveCount(0);
        return;
      }
      // Thành phần khác danh mục, biểu mẫu và bảng điều hành chỉ kiểm nhãn và đường dẫn ở trên.
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
      // Công tắc Bảng/Thẻ (ADR 0050): dạng thẻ hiện cùng liên kết của dòng đầu, rồi về dạng bảng mặc định.
      const first = (await table.getByRole("link").first().textContent()) ?? "";
      const views = page.getByRole("radiogroup", { name: "Kiểu hiển thị" });
      await views.getByText("Thẻ", { exact: true }).click();
      await expect(page).toHaveURL(/view=cards/);
      await expect(table).toHaveCount(0);
      // Cột đầu không nhất thiết duy nhất (danh sách đọc chéo đơn vị có thể mở đầu bằng tên đơn vị), nên chỉ đòi thẻ đầu.
      await expect(page.getByRole("listitem").getByRole("link", { name: first, exact: true }).first()).toBeVisible();
      await views.getByText("Bảng", { exact: true }).click();
      await expect(table).toBeVisible();
      // Dòng đầu mở màn hình chi tiết: khóa của dòng và cột nối về cha do cấu hình chọn (có thể là cột chữ thay vì
      // id), nên chi tiết và từng bảng con phải đọc được dữ liệu, không báo lỗi hay "không tìm thấy".
      await table.getByRole("link").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // Mọi trường thành một ô nhãn, giá trị của lưới chi tiết (dt trong dl), trừ trường của detail.text: trường đó
      // hiện thành khối riêng có tiêu đề và không lặp lại trong lưới.
      const text = config.detail?.text;
      if (text) await expect(page.getByRole("region", { name: text.title })).toBeVisible();
      for (const field of config.fields.filter((f) => f.name !== text?.field)) {
        await expect(
          page.locator("dl > div > dt").filter({ hasText: new RegExp(`^${escapeRegExp(field.label)}$`) }),
        ).toHaveCount(1);
      }
      for (const child of config.detail?.children ?? []) {
        await expect(page.getByRole("heading", { level: 2, name: child.label })).toBeVisible();
      }
      await expect(page.getByLabel("Đang tải")).toHaveCount(0);
      await expect(page.getByText("Không tải được dữ liệu")).toHaveCount(0);
      await expect(page.getByText("Không tìm thấy dòng này")).toHaveCount(0);
    });
  }
});
