// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Gói vận hành hiện trường trên trình duyệt cỡ điện thoại: nhân viên mở phiếu công việc từ menu, cập nhật trạng thái
// bằng nút "Cập nhật" (ADR 0054), đính kèm ảnh hiện trường (ADR 0041), trang không cuộn ngang; bản đồ hiện điểm lắp
// đặt ở lớp của giai đoạn của nó, kèm ghi chú vị trí hư cấu. Chạy bằng tài khoản của tenant `dmt` khi bản cài có (mẫu
// cài dien-mat-troi, #244), không thì bằng tài khoản xã A, vì bộ cài nạp gói cho mọi tenant. Gói chưa cài
// (`make app-install APP=field-ops`) thì bài bỏ qua. Bài tự tạo và tự dọn dữ liệu nên không cần dữ liệu demo.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_field_ops";
// Pixel 7 của Playwright: bề rộng điện thoại phổ biến, cùng cỡ với dự án "mobile" của playwright.config.ts.
const PHONE = { width: 412, height: 915 };

/** Đuôi tên tài khoản demo: dmt khi bản cài có admin.dmt, không thì a (xã A). */
async function accountSuffix(request: APIRequestContext): Promise<string> {
  const response = await request.post("/auth/realms/mortise/protocol/openid-connect/token", {
    form: {
      grant_type: "password",
      client_id: "mortise-test",
      username: "admin.dmt",
      password: process.env.DEMO_USER_PASSWORD ?? "",
    },
  });
  return response.ok() ? "dmt" : "a";
}

async function installed(request: APIRequestContext, user: string): Promise<boolean> {
  const data = await graphql<{ rows: { item: string }[] }>(
    request,
    user,
    `{ rows: platform_menu_items(where: {app: {_eq: "field-ops"}}, limit: 1) { item } }`,
  );
  return data.rows.length > 0;
}

test("nhân viên cập nhật phiếu và đính kèm ảnh trên điện thoại; bản đồ hiện điểm theo giai đoạn", async ({
  page,
  request,
}) => {
  const suffix = await accountSuffix(request);
  const admin = `admin.${suffix}`;
  const user = `user.${suffix}`;
  test.skip(!(await installed(request, user)), "gói field-ops chưa cài trên bản cài này");

  const code = uniqueTitle("e2e-hien-truong").replaceAll(" ", "-");
  const siteName = `Điểm thử ${code}`;
  const title = `Thay công tơ ${code}`;
  let passed = false;
  try {
    await graphql(
      request,
      admin,
      `mutation($code: String!, $name: String!) {
        insert_${PREFIX}_customers_one(object: {code: $code, name: "Khách thử"}) { code }
        insert_${PREFIX}_sites_one(object: {code: $code, customer_code: $code, name: $name, status: "operating",
          latitude: 20.44, longitude: 106.41}) { code } }`,
      { code, name: siteName },
      ADMIN,
    );
    await graphql(
      request,
      user,
      `mutation($code: String!, $title: String!) { insert_${PREFIX}_work_orders_one(object: {code: $code,
        site_code: $code, kind: "repair", title: $title, assignee: "Kỹ thuật viên thử"}) { id } }`,
      { code, title },
    );

    await page.setViewportSize(PHONE);
    await page.goto("/");
    await signIn(page, user);
    await openMenuItem(page, "Phiếu công việc");
    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    await page.getByRole("link", { name: code }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    await page.getByRole("button", { name: "Cập nhật", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cập nhật phiếu công việc" });
    await dialog.getByRole("combobox", { name: "Trạng thái" }).click();
    await page.getByRole("option", { name: "Đang làm" }).click();
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Đã lưu phiếu công việc.")).toBeVisible();
    const saved = await graphql<{ rows: { status: string }[] }>(
      request,
      user,
      `query($code: String!) { rows: ${PREFIX}_work_orders(where: {code: {_eq: $code}}) { status } }`,
      { code },
    );
    expect(saved.rows).toEqual([{ status: "in_progress" }]);

    const photo = "anh-hien-truong.png";
    await page.locator('input[type="file"]').setInputFiles({
      name: photo,
      mimeType: "image/png",
      buffer: Buffer.from(`anh thu ${code}`),
    });
    await page.getByRole("textbox", { name: "Ghi chú" }).fill("Công tơ trước khi thay");
    await page.getByRole("button", { name: "Đính kèm ảnh, biên bản" }).click();
    await expect(page.getByText(`Tệp ${photo} đã được gắn vào dòng này.`)).toBeVisible();
    await expect(page.getByRole("cell", { name: "Công tơ trước khi thay" })).toBeVisible();
    // Tệp e2e biên dịch không có thư viện kiểu DOM, nên đọc kích thước qua globalThis.
    type Viewport = { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
    const overflow = await page.evaluate(() => {
      const view = globalThis as unknown as Viewport;
      return view.document.documentElement.scrollWidth - view.innerWidth;
    });
    expect(overflow, "trang chi tiết phiếu không cuộn ngang trên điện thoại").toBeLessThanOrEqual(0);

    await openMenuItem(page, "Bản đồ điểm lắp đặt");
    await expect(page.getByRole("heading", { level: 1, name: "Bản đồ điểm lắp đặt" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Đang vận hành" }).getByRole("row", { name: siteName }),
    ).toBeVisible();
    await expect(page.getByText("Khách hàng và vị trí điểm lắp đặt là hư cấu, chỉ để minh họa.")).toBeVisible();
    passed = true;
  } finally {
    // Phiếu kéo theo dòng ảnh (CASCADE); điểm và khách hàng giữ nhau bằng RESTRICT nên xóa theo thứ tự.
    let problem = "";
    try {
      await graphql(
        request,
        admin,
        `mutation($code: String!) {
          delete_${PREFIX}_work_orders(where: {code: {_eq: $code}}) { affected_rows }
          delete_${PREFIX}_sites(where: {code: {_eq: $code}}) { affected_rows }
          delete_${PREFIX}_customers(where: {code: {_eq: $code}}) { affected_rows } }`,
        { code },
        ADMIN,
      );
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: lỗi dọn khi đó chỉ in ra.
    if (passed) expect(problem, "dọn dữ liệu kiểm thử").toBe("");
    else if (problem) console.warn(`Dọn dữ liệu kiểm thử chưa xong: ${problem}`);
  }
});
