// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trường tùy chỉnh trên trình duyệt (ADR 0059), qua gói cơ sở vật chất xã: quản trị tỉnh (tenant gốc) mở hộp thoại
// "Trường tùy chỉnh" từ danh mục cơ sở và thêm một trường lựa chọn; gửi giá trị ngoài danh sách qua API thì CSDL từ
// chối kèm lý do; cán bộ phụ trách xã A chọn giá trị trong biểu mẫu "Sửa", danh mục và màn hình chi tiết hiện giá trị đó.
// Trường không bắt buộc: một trường bắt buộc còn sót lại khi bài hỏng giữa chừng sẽ chặn mọi lần thêm cơ sở ở các xã
// của tỉnh. Mã trường mang tiền tố e2e_cf_ và được dọn trước và sau bài. Cần gói đã cài
// (`make app-install APP=facilities-commune`).

import { type APIRequestContext, expect, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, token, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const SOURCE = `${PREFIX}_facilities`;

async function dropFields(request: APIRequestContext) {
  await graphql(
    request,
    "admin.tinh",
    `mutation($s: String!, $p: String!) { delete_platform_custom_fields(where: {source: {_eq: $s}, code: {_like: $p}}) { affected_rows } }`,
    // Dấu gạch dưới là ký tự đại diện của LIKE; thoát để chỉ khớp đúng tiền tố.
    { s: SOURCE, p: "e2e\\_cf\\_%" },
    ADMIN,
  );
}

async function customOf(request: APIRequestContext, id: string): Promise<Record<string, unknown> | undefined> {
  const data = await graphql<{ rows: { custom: Record<string, unknown> }[] }>(
    request,
    "user.a",
    `query($id: uuid!) { rows: ${PREFIX}_facilities(where: {id: {_eq: $id}}) { custom } }`,
    { id },
  );
  return data.rows[0]?.custom;
}

test("quản trị tỉnh thêm trường lựa chọn, CSDL từ chối giá trị sai, cán bộ xã A chọn giá trị trong biểu mẫu sửa", async ({
  page,
  browser,
  request,
}) => {
  const run = Date.now().toString(36);
  const fieldCode = `e2e_cf_${run}`;
  const label = `Hãng tấm pin ${run}`;
  const code = uniqueTitle("e2e-tt").replaceAll(" ", "-");
  const name = `Trụ sở thử ${code}`;
  let facilityId: string | undefined;
  await dropFields(request);
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name}) { id } }`,
      { code, name },
      ADMIN,
    );
    facilityId = created.row.id;
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: facilityId, u: await subOf(request, "user.a") },
      ADMIN,
    );

    // Quản trị tỉnh thêm trường từ hộp thoại của danh mục; bảng đầu (cơ sở) được chọn sẵn.
    await page.goto("/");
    await signIn(page, "admin.tinh");
    await openMenuItem(page, "Cơ sở nhà, đất");
    await page.getByRole("button", { name: "Trường tùy chỉnh" }).click();
    const dialog = page.getByRole("dialog", { name: "Trường tùy chỉnh" });
    await dialog.getByRole("textbox", { name: "Mã" }).fill(fieldCode);
    await dialog.getByRole("textbox", { name: "Nhãn" }).fill(label);
    await dialog.getByRole("combobox", { name: "Kiểu" }).click();
    await page.getByRole("option", { name: "Lựa chọn" }).click();
    await dialog.getByRole("textbox", { name: "Các lựa chọn" }).fill("Hãng A\nHãng B");
    await dialog.getByRole("button", { name: "Thêm trường" }).click();
    await expect(dialog.getByText(`Đã thêm trường "${label}".`)).toBeVisible();
    await expect(dialog.getByRole("button", { name: `Sửa trường ${label}` })).toBeVisible();

    // Giá trị ngoài danh sách gửi thẳng qua API: CSDL từ chối, lý do có nhãn của trường.
    const response = await request.post("/v1/graphql", {
      headers: { Authorization: `Bearer ${await token(request, "user.a")}`, "X-Hasura-Role": "user" },
      data: {
        query: `mutation($id: uuid!, $c: jsonb!) { update_${PREFIX}_facilities(where: {id: {_eq: $id}}, _set: {custom: $c}) { affected_rows } }`,
        variables: { id: facilityId, c: { [fieldCode]: "Hãng C" } },
      },
    });
    const body: { errors?: { message: string }[] } = await response.json();
    expect(body.errors?.[0]?.message).toContain(`Trường "${label}" (${fieldCode}) phải là một trong`);
    expect(await customOf(request, facilityId)).toEqual({});

    // Cán bộ phụ trách xã A chọn giá trị trong biểu mẫu sửa; chi tiết và danh mục hiện giá trị đó.
    const { baseURL, locale } = test.info().project.use;
    const context = await browser.newContext({ baseURL, locale });
    const officer = await context.newPage();
    await officer.goto("/");
    await signIn(officer, "user.a");
    await openMenuItem(officer, "Cơ sở nhà, đất");
    await expect(officer.getByRole("columnheader", { name: label })).toBeVisible();
    await officer.getByRole("textbox", { name: "Tìm" }).fill(code);
    await officer.getByRole("button", { name: "Tìm" }).click();
    await officer.getByRole("link", { name: code }).click();
    await expect(officer.getByRole("heading", { level: 1, name })).toBeVisible();
    await officer.getByRole("button", { name: "Sửa", exact: true }).click();
    const form = officer.getByRole("dialog", { name: "Sửa cơ sở" });
    await form.getByRole("combobox", { name: label }).click();
    await officer.getByRole("option", { name: "Hãng B" }).click();
    await form.getByRole("button", { name: "Lưu" }).click();
    await expect(officer.getByText("Đã lưu cơ sở.")).toBeVisible();
    await expect(officer.getByRole("definition").filter({ hasText: "Hãng B" })).toBeVisible();
    expect(await customOf(request, facilityId)).toEqual({ [fieldCode]: "Hãng B" });
    await context.close();
  } finally {
    await dropFields(request).catch((error) => console.warn(`Dọn trường thử chưa xong: ${error}`));
    if (facilityId) {
      await graphql(
        request,
        "admin.a",
        `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id: facilityId },
        ADMIN,
      ).catch((error) => console.warn(`Dọn cơ sở thử chưa xong: ${error}`));
    }
  }
});
