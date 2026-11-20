// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu của gói và trang danh mục trên trình duyệt: cán bộ xã A mở mục menu do gói cơ sở vật chất xã khai, thấy cơ
// sở mình được phân công, không thấy cơ sở của xã B, mở chi tiết và danh sách tòa, mở lại thẳng đường dẫn chi tiết.
// Trang dựng hoàn toàn từ cấu hình của gói; giao diện không có mã riêng cho gói. Cần gói đã cài
// (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu nên không cần `make seed-demo`.

import { expect, test } from "@playwright/test";
import { graphql, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";

type Created = { id: string };

/** Quản trị xã tạo một cơ sở; trả id. */
async function facility(request: Parameters<typeof graphql>[0], admin: string, code: string, name: string) {
  const data = await graphql<{ row: Created }>(
    request,
    admin,
    `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
    { code, name },
    ADMIN,
  );
  return data.row.id;
}

test("cán bộ xã A mở danh mục cơ sở từ menu của gói, chỉ thấy cơ sở được phân công của xã mình", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e").replace(" ", "-");
  const ownName = `Trụ sở kiểm thử ${code}`;
  const ownId = await facility(request, "admin.a", `${code}-a`, ownName);
  const otherId = await facility(request, "admin.b", `${code}-b`, `Trụ sở xã khác ${code}`);
  try {
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!) { insert_${PREFIX}_buildings_one(object: {facility_id: $f, code: "T1", name: "Tòa kiểm thử"}) { id } }`,
      { f: ownId },
      ADMIN,
    );
    // Phân công so với sub trong token của cán bộ (ADR 0015).
    const sub = await subOf(request, "user.a");
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: ownId, u: sub },
      ADMIN,
    );

    await page.goto("/");
    await signIn(page, "user.a");
    await page.getByRole("link", { name: "Cơ sở nhà, đất" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Cơ sở nhà, đất" })).toBeVisible();

    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    await expect(page.getByRole("link", { name: `${code}-a` })).toBeVisible();
    await expect(page.getByText(`${code}-b`)).toHaveCount(0);

    await page.getByRole("link", { name: `${code}-a` }).click();
    await expect(page.getByRole("heading", { level: 1, name: ownName })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Tòa nhà" })).toBeVisible();
    await expect(page.getByRole("link", { name: "T1" })).toBeVisible();

    // Mở lại thẳng đường dẫn chi tiết (dấu trang, tin nhắn): trang phải chờ menu tải xong rồi mới vẽ, không báo
    // "không có trang".
    const detail = page.url();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: ownName })).toBeVisible();
    expect(page.url()).toBe(detail);
  } finally {
    // Tòa trước, cơ sở sau (RESTRICT); phân công đi theo cơ sở.
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!) { delete_${PREFIX}_buildings(where: {facility_id: {_eq: $f}}) { affected_rows } }`,
      { f: ownId },
      ADMIN,
    );
    for (const [admin, id] of [
      ["admin.a", ownId],
      ["admin.b", otherId],
    ] as const) {
      await graphql(
        request,
        admin,
        `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id },
        ADMIN,
      );
    }
  }
});
