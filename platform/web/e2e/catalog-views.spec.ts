// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểu Kanban và Lịch của danh mục (ADR 0066), qua danh mục cơ sở của gói cơ sở vật chất xã. Cán bộ phụ trách xã A
// chuyển thẻ cơ sở thử sang "Dôi dư" chỉ bằng bàn phím (nút "Chuyển sang"), rồi kéo thả về "Đang sử dụng"; lần chuyển
// sau khi người khác đã sửa cơ sở qua API bị báo, tình trạng trong CSDL không đổi. Lịch theo ngày tạo hiện cơ sở ở ô
// hôm nay, theo tháng và theo tuần. Cán bộ xã B không thấy cơ sở. Axe đo cả hai kiểu khi có thẻ thử trên trang (lỗi
// WCAG 2.1 A, AA mức critical, serious làm bài hỏng, như visual.spec.ts). Cần gói đã cài
// (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn cơ sở thử.

import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { graphql, openMenuItem, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const CONFLICT = "Thẻ này đã có người sửa hoặc bạn không còn quyền sửa";

async function statusOf(request: APIRequestContext, username: string, id: string): Promise<string | undefined> {
  const data = await graphql<{ rows: { status: string }[] }>(
    request,
    username,
    `query($id: uuid!) { rows: ${PREFIX}_facilities(where: {id: {_eq: $id}}) { status } }`,
    { id },
  );
  return data.rows[0]?.status;
}

/** Lỗi trợ năng chặn của trang đang mở, cùng mức với visual.spec.ts. */
async function blocking(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return result.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

async function openView(page: Page, code: string, view: "Kanban" | "Lịch") {
  await openMenuItem(page, "Cơ sở nhà, đất");
  await page.getByRole("textbox", { name: "Tìm" }).fill(code);
  await page.getByRole("button", { name: "Tìm" }).click();
  await page.getByRole("radiogroup", { name: "Kiểu hiển thị" }).getByText(view, { exact: true }).click();
}

test("cán bộ xã A chuyển thẻ bằng bàn phím và kéo thả, lần chuyển trùng bị báo, lịch hiện cơ sở ở hôm nay", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-kanban").replaceAll(" ", "-");
  const name = `Trụ sở thử ${code}`;
  let facilityId: string | undefined;
  try {
    const created = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($code: String!, $name: String!) { row: insert_${PREFIX}_facilities_one(object: {code: $code, name: $name, status: "in_use"}) { id } }`,
      { code, name },
      ADMIN,
    );
    facilityId = created.row.id;
    const id = facilityId;
    await graphql(
      request,
      "admin.a",
      `mutation($f: uuid!, $u: String!) { insert_${PREFIX}_facility_assignments_one(object: {facility_id: $f, user_id: $u, duty: "custodian"}) { id } }`,
      { f: id, u: await subOf(request, "user.a") },
      ADMIN,
    );

    await page.goto("/");
    await signIn(page, "user.a");
    await openView(page, code, "Kanban");
    await expect(page).toHaveURL(/view=kanban/);
    const board = page.getByRole("region", { name: "Cơ sở nhà, đất" });
    await expect(board.getByRole("heading", { name: "Đang sử dụng" })).toBeVisible();
    await expect(board.getByRole("heading", { name: "Dôi dư" })).toBeVisible();
    const status = page.getByRole("status").filter({ hasText: /chuyển/ });
    const card = (column: string) => board.getByRole("list", { name: column }).getByRole("link", { name: code });
    await expect(card("Đang sử dụng")).toBeVisible();
    expect(await blocking(page), "lỗi trợ năng của Kanban").toEqual([]);

    // Bàn phím: Tab tới nút của thẻ, Enter mở danh sách cột, mũi tên và Enter chọn.
    const moveButton = page.getByRole("button", { name: `Chuyển sang: ${code}` });
    await moveButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Dôi dư" })).toBeVisible();
    // Danh sách hiện trước lúc Mantine nhận phím mũi tên trong nó (đo trong trace: mũi tên bấm 6 ms sau khi danh sách
    // hiện thì không mục nào nhận tiêu điểm, Enter không chọn gì). Bấm lại tới khi mục nhận tiêu điểm, vẫn chỉ bằng
    // bàn phím.
    await expect(async () => {
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Dôi dư" })).toBeFocused({ timeout: 500 });
    }).toPass({ timeout: 5000 });
    await page.keyboard.press("Enter");
    await expect(status).toHaveText(`Đã chuyển "${code}" sang "Dôi dư".`);
    // Thẻ hiện ở cột mới là lúc bảng đã tải lại xong, với cột version mới.
    await expect(card("Dôi dư")).toBeVisible();
    await expect.poll(() => statusOf(request, "user.a", id)).toBe("surplus");

    // Kéo thả về cột "Đang sử dụng".
    const item = board.getByRole("listitem").filter({ has: page.getByRole("link", { name: code, exact: true }) });
    await item.dragTo(board.getByRole("heading", { name: "Đang sử dụng" }));
    await expect(status).toHaveText(`Đã chuyển "${code}" sang "Đang sử dụng".`);
    await expect(card("Đang sử dụng")).toBeVisible();
    await expect.poll(() => statusOf(request, "user.a", id)).toBe("in_use");

    // Người khác sửa cơ sở sau khi bảng đã tải: lần chuyển không khớp cột version, bị báo, tình trạng giữ nguyên.
    await graphql(
      request,
      "user.a",
      `mutation($id: uuid!, $n: String!) { update_${PREFIX}_facilities(where: {id: {_eq: $id}}, _set: {name: $n}) { affected_rows } }`,
      { id, n: `${name} (đổi qua API)` },
    );
    await moveButton.click();
    await page.getByRole("menuitem", { name: "Dôi dư" }).click();
    await expect(page.getByRole("status").filter({ hasText: CONFLICT })).toBeVisible();
    await expect(card("Đang sử dụng")).toBeVisible();
    expect(await statusOf(request, "user.a", id)).toBe("in_use");

    // Lịch theo ngày tạo: cơ sở vừa tạo nằm ở ô hôm nay, theo tháng và theo tuần.
    await page.getByRole("radiogroup", { name: "Kiểu hiển thị" }).getByText("Lịch", { exact: true }).click();
    await expect(page).toHaveURL(/view=calendar/);
    const today = page.locator('[aria-current="date"]');
    await expect(today.getByRole("link", { name: `${name} (đổi qua API)` })).toBeVisible();
    expect(await blocking(page), "lỗi trợ năng của lịch theo tháng").toEqual([]);
    await page.getByRole("radiogroup", { name: "Lịch theo" }).getByText("Tuần", { exact: true }).click();
    await expect(today.getByRole("link", { name: `${name} (đổi qua API)` })).toBeVisible();

    expect(await statusOf(request, "user.b", id), "xã B không thấy cơ sở của xã A").toBeUndefined();
  } finally {
    if (facilityId) {
      const id = facilityId;
      await graphql(
        request,
        "admin.a",
        `mutation($id: uuid!) { delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id },
        ADMIN,
      ).catch((error) => console.warn(`Dọn cơ sở thử chưa xong: ${error}`));
    }
  }
});
