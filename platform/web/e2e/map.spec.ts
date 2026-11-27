// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bản đồ trụ sở trên trình duyệt (ADR 0024): cán bộ xã A mở mục menu do gói cơ sở vật chất xã khai, thấy trụ sở mình
// phụ trách tô theo phần vượt của xã A và cơ sở dôi dư mình phụ trách ở lớp màu xám, không thấy trụ sở của xã B và
// không truy vấn lớp của tỉnh; tỉnh thấy trụ sở đang dùng của cả hai xã qua view facility_rollup, truy vấn lớp đó với
// vai trò rollup_reader. Trang không vi phạm Content-Security-Policy, kể cả worker của MapLibre. Cần gói đã cài
// (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn dữ liệu nên không cần `make seed-demo`.

import { type APIRequestContext, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const MAP = "Bản đồ trụ sở";

/** Quản trị xã tạo một cơ sở có tọa độ, mặc định đang dùng; trả id. */
async function facility(
  request: APIRequestContext,
  admin: string,
  code: string,
  name: string,
  at: number,
  status: "in_use" | "surplus" = "in_use",
) {
  const data = await graphql<{ row: { id: string } }>(
    request,
    admin,
    `mutation($row: ${PREFIX}_facilities_insert_input!) { row: insert_${PREFIX}_facilities_one(object: $row) { id } }`,
    { row: { code, name, status, latitude: at, longitude: at } },
    ADMIN,
  );
  return data.row.id;
}

/** Quản trị xã A phân công user.a phụ trách một cơ sở: vai trò `user` chỉ đọc cơ sở mình được phân công. */
async function assign(request: APIRequestContext, facilityId: string, userId: string) {
  await graphql(
    request,
    "admin.a",
    `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
    { f: facilityId, u: userId },
    ADMIN,
  );
}

/** Nhãn màu mà cấu hình của gói gán cho phần vượt hiện tại của một xã, đọc qua API bằng quản trị xã đó. */
async function excessLabel(request: APIRequestContext, admin: string) {
  const data = await graphql<{ rows: { excess_m2: number }[] }>(
    request,
    admin,
    `{ rows: ${PREFIX}_area_summary { excess_m2 } }`,
    {},
    ADMIN,
  );
  return Number(data.rows[0]?.excess_m2) > 0 ? "Vượt tiêu chuẩn, định mức" : "Không vượt";
}

/** Ghi lại vi phạm CSP và vai trò Hasura mà trang gửi kèm từng truy vấn GraphQL. */
function watch(page: Page) {
  const violations: string[] = [];
  const roles: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().endsWith("/v1/graphql")) roles.push(request.headers()["x-hasura-role"] ?? "");
  });
  return { violations, roles };
}

async function openMap(page: Page, username: string) {
  await page.goto("/");
  await signIn(page, username);
  await openMenuItem(page, MAP);
  await expect(page.getByRole("heading", { level: 1, name: MAP })).toBeVisible();
}

test("xã A thấy trụ sở của mình tô theo phần vượt; tỉnh thấy trụ sở của các xã qua tổng hợp", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const code = uniqueTitle("e2e").replaceAll(" ", "-");
  const nameA = `Trụ sở bản đồ ${code}-a`;
  const nameB = `Trụ sở bản đồ ${code}-b`;
  const nameSurplus = `Cơ sở dôi dư bản đồ ${code}-s`;
  const created: { admin: string; id: string }[] = [];
  let province: BrowserContext | undefined;
  let passed = false;
  try {
    const idA = await facility(request, "admin.a", `${code}-a`, nameA, 0.6);
    created.push({ admin: "admin.a", id: idA });
    created.push({ admin: "admin.b", id: await facility(request, "admin.b", `${code}-b`, nameB, -0.6) });
    const idSurplus = await facility(request, "admin.a", `${code}-s`, nameSurplus, 0.5, "surplus");
    created.push({ admin: "admin.a", id: idSurplus });
    const userA = await subOf(request, "user.a");
    await assign(request, idA, userA);
    await assign(request, idSurplus, userA);
    const labelA = await excessLabel(request, "admin.a");
    const labelB = await excessLabel(request, "admin.b");

    const commune = watch(page);
    await openMap(page, "user.a");
    await expect(page.getByRole("button", { name: `${nameA}: ${labelA}` })).toBeVisible();
    await expect(page.getByRole("row", { name: nameA })).toBeVisible();
    // Cơ sở dôi dư không tính vào phần vượt nên nằm ở lớp riêng màu xám, không ở lớp tô theo phần vượt.
    const surplus = page.getByRole("button", { name: `${nameSurplus}: Cơ sở dôi dư` });
    await expect(surplus).toHaveAttribute("data-color", "gray");
    await expect(
      page.getByRole("region", { name: "Cơ sở dôi dư" }).getByRole("row", { name: nameSurplus }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Trụ sở đang dùng", exact: true }).getByText(nameSurplus),
    ).toHaveCount(0);
    // Khẳng định phủ định chỉ có nghĩa sau khi điểm của xã A đã hiện.
    await expect(page.getByText(nameB)).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Trụ sở đang dùng của các xã" })).toHaveCount(0);
    expect(commune.roles, "user.a không gửi vai trò nào ngoài mặc định").not.toContain("rollup_reader");
    expect(commune.violations, "vi phạm CSP").toEqual([]);

    // Ngữ cảnh trình duyệt riêng cho tỉnh: cùng ngữ cảnh thì cookie đăng nhập một lần của Keycloak đưa thẳng vào phiên
    // của user.a.
    const { baseURL, locale } = testInfo.project.use;
    province = await browser.newContext({ baseURL, locale });
    const leader = await province.newPage();
    const seen = watch(leader);
    await openMap(leader, "leader.tinh");
    const communes = leader.getByRole("region", { name: "Trụ sở đang dùng của các xã" });
    await expect(leader.getByRole("button", { name: `${nameA}: ${labelA}` })).toBeVisible();
    await expect(leader.getByRole("button", { name: `${nameB}: ${labelB}` })).toBeVisible();
    await expect(communes.getByRole("row", { name: nameB })).toBeVisible();
    expect(seen.roles, "lớp tổng hợp truy vấn với vai trò rollup_reader").toContain("rollup_reader");
    expect(seen.violations, "vi phạm CSP").toEqual([]);
    passed = true;
  } finally {
    await province?.close();
    const problems: string[] = [];
    for (const { admin, id } of created) {
      try {
        await graphql(
          request,
          admin,
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
