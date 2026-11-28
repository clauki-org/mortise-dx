// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sửa dòng và thêm dòng con ngay trên màn hình chi tiết của danh mục (detail.edit, add của đối tượng con, ADR 0054),
// qua gói cơ sở vật chất xã. Cán bộ phụ trách xã A sửa địa chỉ của một cơ sở thử; trong lúc biểu mẫu thứ hai đang
// mở, lần sửa qua API của cùng cán bộ đổi tên cơ sở, nên lần lưu ở biểu mẫu bị báo và tải lại, không ghi đè. Ở bảng
// "Tòa nhà" bấm "Thêm tòa": mã cơ sở điền sẵn, không sửa được, tòa mới thuộc đúng cơ sở. Cán bộ xã B không thấy
// cơ sở. Cần gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn cơ sở thử.

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const CONFLICT = "Dòng này đã có người sửa hoặc bạn không còn quyền sửa";

type Facility = { name: string; address: string | null; updated_at: string };

async function facility(request: APIRequestContext, username: string, id: string): Promise<Facility | undefined> {
  const data = await graphql<{ rows: Facility[] }>(
    request,
    username,
    `query($id: uuid!) { rows: ${PREFIX}_facilities(where: {id: {_eq: $id}}) { name address updated_at } }`,
    { id },
  );
  return data.rows[0];
}

async function openFacility(page: Page, code: string, name: string) {
  await openMenuItem(page, "Cơ sở nhà, đất");
  await page.getByRole("textbox", { name: "Tìm" }).fill(code);
  await page.getByRole("button", { name: "Tìm" }).click();
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("cán bộ xã A sửa cơ sở, sửa đồng thời bị báo không ghi đè, thêm tòa với mã cơ sở điền sẵn", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-sua").replaceAll(" ", "-");
  const name = `Trụ sở thử ${code}`;
  let facilityId: string | undefined;
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name, address: "Thôn 1"}) { id } }`,
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

    await page.goto("/");
    await signIn(page, "user.a");
    await openFacility(page, code, name);

    // Sửa: giá trị điền sẵn từ dòng, chỉ địa chỉ đổi.
    await page.getByRole("button", { name: "Sửa", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Sửa cơ sở" });
    await expect(dialog.getByRole("textbox", { name: "Tên cơ sở" })).toHaveValue(name);
    await dialog.getByRole("textbox", { name: "Địa chỉ" }).fill("Thôn 9, xã A");
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Đã lưu cơ sở.")).toBeVisible();
    // Ô của màn hình chi tiết, không phải dòng của khối bản đồ cơ sở (ADR 0068) cũng có cột địa chỉ.
    await expect(page.getByRole("definition").getByText("Thôn 9, xã A")).toBeVisible();
    expect((await facility(request, "user.a", facilityId))?.address).toBe("Thôn 9, xã A");

    // Sửa đồng thời: biểu mẫu mở rồi, người khác (ở đây cùng tài khoản qua API) đổi tên trước khi lưu.
    await page.getByRole("button", { name: "Sửa", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Sửa cơ sở" });
    await expect(dialog.getByRole("textbox", { name: "Địa chỉ" })).toHaveValue("Thôn 9, xã A");
    const renamed = `${name} (đổi qua API)`;
    await graphql(
      request,
      "user.a",
      `mutation($id: uuid!, $n: String!) { update_${PREFIX}_facilities(where: {id: {_eq: $id}}, _set: {name: $n}) { affected_rows } }`,
      { id: facilityId, n: renamed },
    );
    await dialog.getByRole("textbox", { name: "Địa chỉ" }).fill("Thôn 10, xã A");
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(dialog.getByText(CONFLICT)).toBeVisible();
    // Biểu mẫu tải lại giá trị mới nhất; dòng trong CSDL giữ lần sửa của người kia, địa chỉ không đổi.
    await expect(dialog.getByRole("textbox", { name: "Tên cơ sở" })).toHaveValue(renamed);
    await expect(dialog.getByRole("textbox", { name: "Địa chỉ" })).toHaveValue("Thôn 9, xã A");
    expect(await facility(request, "user.a", facilityId)).toMatchObject({ name: renamed, address: "Thôn 9, xã A" });
    // Lưu lại sau khi đã thấy giá trị mới thì qua.
    await dialog.getByRole("textbox", { name: "Địa chỉ" }).fill("Thôn 10, xã A");
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(page.getByText("Đã lưu cơ sở.")).toBeVisible();
    expect(await facility(request, "user.a", facilityId)).toMatchObject({ name: renamed, address: "Thôn 10, xã A" });

    // Thêm tòa: mã cơ sở điền sẵn, không sửa được; tòa mới hiện ngay trong bảng con.
    await page.getByRole("button", { name: "Thêm tòa" }).click();
    dialog = page.getByRole("dialog", { name: "Thêm tòa nhà" });
    const parent = dialog.getByRole("textbox", { name: "Cơ sở nhà, đất" });
    await expect(parent).toHaveValue(code);
    await expect(parent).not.toBeEditable();
    await dialog.getByRole("textbox", { name: "Mã tòa" }).fill("E2E");
    await dialog.getByRole("textbox", { name: "Tên tòa" }).fill("Nhà thử");
    await dialog.getByRole("button", { name: "Thêm", exact: true }).click();
    await expect(page.getByText("Đã thêm tòa nhà.")).toBeVisible();
    await expect(page.getByRole("link", { name: "E2E" })).toBeVisible();
    const buildings = await graphql<{ rows: { facility_id: string }[] }>(
      request,
      "user.a",
      `query($f: uuid!) { rows: ${PREFIX}_buildings(where: {facility_id: {_eq: $f}}) { facility_id } }`,
      { f: facilityId },
    );
    expect(buildings.rows).toEqual([{ facility_id: facilityId }]);

    expect(await facility(request, "user.b", facilityId), "xã B không thấy cơ sở của xã A").toBeUndefined();
  } finally {
    // Tòa giữ cơ sở bằng khóa ngoại RESTRICT, nên xóa tòa trước rồi mới xóa cơ sở (kéo theo phân công).
    if (facilityId) {
      const id = facilityId;
      await graphql(
        request,
        "admin.a",
        `mutation($id: uuid!) { delete_${PREFIX}_buildings(where: {facility_id: {_eq: $id}}) { affected_rows } delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id },
        ADMIN,
      ).catch((error) => console.warn(`Dọn cơ sở thử chưa xong: ${error}`));
    }
  }
});
