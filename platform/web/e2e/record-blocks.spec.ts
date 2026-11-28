// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khối trong chi tiết một dòng (ADR 0068) trên trình duyệt: cán bộ xã A bấm tên trụ sở trên bản đồ thì mở chi tiết cơ
// sở (liên kết chung tới chi tiết dòng); chi tiết có khối "Vị trí cơ sở" chỉ có cơ sở đang xem, gửi điều kiện id của
// cơ sở trong truy vấn, và khối hồ sơ rà soát chỉ có hồ sơ của cơ sở đó, lọc ở workflow-api bằng biến facilityId. Cần
// gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu nên không cần `make seed-demo`.

import { type APIRequestContext, expect, test } from "@playwright/test";
import { dropInstance, graphql, openMenuItem, signIn, subOf, token, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";

/** Quản trị xã A tạo một cơ sở đang dùng có tọa độ trong xã A và phân công user.a phụ trách; trả id. */
async function facility(request: APIRequestContext, code: string, name: string, longitude: number) {
  const created = await graphql<{ row: { id: string } }>(
    request,
    "admin.a",
    `mutation($row: ${PREFIX}_facilities_insert_input!) { row: insert_${PREFIX}_facilities_one(object: $row) { id } }`,
    { row: { code, name, status: "in_use", latitude: 20.44, longitude } },
    ADMIN,
  );
  await graphql(
    request,
    "admin.a",
    `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
    { f: created.row.id, u: await subOf(request, "user.a") },
    ADMIN,
  );
  return created.row.id;
}

/** user.a lập hồ sơ rà soát cho một cơ sở qua API, với cùng biến mà nút trên màn hình chi tiết gửi; trả mã quy trình. */
async function review(request: APIRequestContext, facilityId: string, title: string): Promise<string> {
  const response = await request.post("/v1/workflow/processes/facilities-review/instances", {
    headers: { Authorization: `Bearer ${await token(request, "user.a")}` },
    data: { variables: { title, facilityId, excessM2: 0 } },
  });
  expect(response.ok(), "user.a lập được hồ sơ rà soát").toBeTruthy();
  return (await response.json()).id;
}

test("chấm bản đồ mở chi tiết cơ sở; khối trong chi tiết chỉ có cơ sở đó và hồ sơ của nó", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e").replaceAll(" ", "-");
  const name = `Trụ sở khối ${code}-a`;
  const other = `Trụ sở khối ${code}-b`;
  const facilities: string[] = [];
  const instances: string[] = [];
  let passed = false;
  try {
    const id = await facility(request, `${code}-a`, name, 106.39);
    facilities.push(id);
    const otherId = await facility(request, `${code}-b`, other, 106.385);
    facilities.push(otherId);
    instances.push(await review(request, id, `Rà soát ${name}`));
    instances.push(await review(request, otherId, `Rà soát ${other}`));

    const queries: string[] = [];
    page.on("request", (call) => {
      if (call.url().endsWith("/v1/graphql")) queries.push(call.postData() ?? "");
    });
    const caseLists: URL[] = [];
    page.on("request", (call) => {
      if (call.url().includes("/v1/workflow/cases?")) caseLists.push(new URL(call.url()));
    });

    await page.goto("/");
    await signIn(page, "user.a");
    await openMenuItem(page, "Bản đồ trụ sở");
    await page.getByRole("region", { name: "Trụ sở đang dùng", exact: true }).getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/apps/facilities-commune/facilities/${id}$`));

    const location = page.getByRole("region", { name: "Vị trí cơ sở", exact: true });
    await expect(location.getByRole("heading", { level: 2, name: "Vị trí trên bản đồ" })).toBeVisible();
    await expect(location.getByRole("row", { name })).toBeVisible();
    // Khẳng định phủ định chỉ có nghĩa sau khi điểm của cơ sở đang xem đã hiện.
    await expect(location.getByText(other)).toHaveCount(0);
    expect(
      queries.some((body) => body.includes(`{"id":{"_eq":"${id}"}}`)),
      "khối gửi điều kiện id",
    ).toBeTruthy();

    // Vùng ngoài là khối; bảng hồ sơ bên trong là vùng cuộn mang cùng tên (TableScroll.tsx).
    const reviews = page.getByRole("region", { name: "Hồ sơ rà soát đã lập", exact: true }).first();
    await expect(reviews.getByRole("link", { name: `Rà soát ${name}` })).toBeVisible();
    await expect(reviews.getByText(`Rà soát ${other}`)).toHaveCount(0);
    const filtered = caseLists.find((url) => url.searchParams.get("variable_name") === "facilityId");
    expect(filtered?.searchParams.get("variable_value"), "theo dõi hồ sơ lọc theo cơ sở đang xem").toBe(id);
    passed = true;
  } finally {
    const problems: string[] = [];
    for (const instance of instances) {
      try {
        await dropInstance(request, instance);
      } catch (error) {
        problems.push(`xóa hồ sơ ${instance}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const id of facilities) {
      try {
        await graphql(
          request,
          "admin.a",
          `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
          { id },
          ADMIN,
        );
      } catch (error) {
        problems.push(`xóa cơ sở ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Bài đã hỏng thì lỗi gốc là lỗi cần đọc: ném lỗi dọn ở đây sẽ thay mất nó, nên chỉ in ra.
    if (passed) expect(problems, "dọn dữ liệu kiểm thử").toEqual([]);
    else if (problems.length > 0) console.warn(`Dọn dữ liệu kiểm thử chưa xong:\n${problems.join("\n")}`);
  }
});
