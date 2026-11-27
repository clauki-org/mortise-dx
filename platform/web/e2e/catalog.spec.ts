// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Menu của gói và trang danh mục trên trình duyệt: cán bộ xã A mở mục menu do gói cơ sở vật chất xã khai, thấy cơ
// sở mình được phân công, không thấy cơ sở chưa phân công của chính xã A hay cơ sở của xã B, mở chi tiết và danh
// sách tòa, mở lại thẳng đường dẫn chi tiết. Trang dựng hoàn toàn từ cấu hình của gói; giao diện không có mã riêng
// cho gói. Cần gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu nên không cần
// `make seed-demo`.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";

type Created = { id: string };
type Facility = { admin: string; id: string };

/** Quản trị xã tạo một cơ sở; trả id. */
async function facility(request: APIRequestContext, admin: string, code: string, name: string) {
  const data = await graphql<{ row: Created }>(
    request,
    admin,
    `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
    { code, name },
    ADMIN,
  );
  return data.row.id;
}

/**
 * Xóa các cơ sở bài đã tạo: tòa trước, cơ sở sau (RESTRICT); phân công đi theo cơ sở (CASCADE). Mỗi bước tự bắt lỗi
 * để một bước hỏng không chặn các bước sau; trả danh sách lỗi để nơi gọi quyết định có báo hay không.
 */
async function cleanUp(request: APIRequestContext, created: Facility[]): Promise<string[]> {
  const problems: string[] = [];
  const attempt = async (label: string, admin: string, query: string, id: string) => {
    try {
      await graphql(request, admin, query, { id }, ADMIN);
    } catch (error) {
      problems.push(`${label} ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  for (const { admin, id } of created) {
    await attempt(
      "xóa tòa của cơ sở",
      admin,
      `mutation($id: uuid!) { delete_${PREFIX}_buildings(where: {facility_id: {_eq: $id}}) { affected_rows } }`,
      id,
    );
    await attempt("xóa cơ sở", admin, `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`, id);
  }
  return problems;
}

test("cán bộ xã A mở danh mục cơ sở từ menu của gói, chỉ thấy cơ sở được phân công của xã mình", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e").replaceAll(" ", "-");
  const ownName = `Trụ sở kiểm thử ${code}`;
  const created: Facility[] = [];
  let passed = false;
  try {
    const ownId = await facility(request, "admin.a", `${code}-a`, ownName);
    created.push({ admin: "admin.a", id: ownId });
    // Cùng xã A nhưng không phân công cho user.a: phải bị quyền theo phân công chặn, không chỉ quyền theo tenant.
    created.push({
      admin: "admin.a",
      id: await facility(request, "admin.a", `${code}-c`, `Trụ sở chưa phân công ${code}`),
    });
    created.push({ admin: "admin.b", id: await facility(request, "admin.b", `${code}-b`, `Trụ sở xã khác ${code}`) });

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
    await openMenuItem(page, "Cơ sở nhà, đất");
    await expect(page.getByRole("heading", { level: 1, name: "Cơ sở nhà, đất" })).toBeVisible();

    await page.getByRole("textbox", { name: "Tìm" }).fill(code);
    await page.getByRole("button", { name: "Tìm" }).click();
    // Khẳng định phủ định chỉ có nghĩa sau khi kết quả tìm đã hiện.
    await expect(page.getByRole("link", { name: `${code}-a` })).toBeVisible();
    await expect(page.getByText(`${code}-c`)).toHaveCount(0);
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
    passed = true;
  } finally {
    const problems = await cleanUp(request, created);
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
    if (passed) {
      expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    } else if (problems.length > 0) {
      console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
    }
  }
});
