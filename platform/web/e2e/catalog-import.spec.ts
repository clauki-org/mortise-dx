// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Nạp phòng của một tòa từ tệp Excel (import của đối tượng con, ADR 0064), qua gói cơ sở vật chất xã. Cán bộ phụ
// trách xã A mở tòa thử, tải tệp mẫu (đúng tiêu đề cột), chọn tệp có dòng thiếu diện tích và hai dòng trùng mã: xem
// trước chỉ đúng dòng, cột và không cho nạp. Tệp đã sửa nhưng trong lúc xem trước có người thêm một phòng trùng mã qua
// API: lệnh nạp bị từ chối và không phòng nào vào. Chọn lại tệp thì xem trước báo mã đã có; bỏ dòng đó thì nạp được cả
// lần, mọi phòng thuộc đúng tòa. Cùng lúc kiểm hộp thoại không có lỗi axe chặn và không vi phạm CSP (thư
// viện đọc Excel chạy trong trang). Cần gói đã cài (`make app-install APP=facilities-commune`); bài tự tạo và tự dọn
// cơ sở thử.

import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { readSheet } from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";
import { graphql, openMenuItem, signIn, subOf, uniqueTitle } from "./support.ts";

const ADMIN = "tenant_admin";
const PREFIX = "app_facilities_commune";
const HEADER = ["Mã phòng", "Tên phòng", "Tầng", "Loại diện tích", "Diện tích thông thủy (m²)"];

type Line = [string, string, number | null, string, number | string | null];

/** Tệp .xlsx như cán bộ điền trong Excel: dòng tiêu đề của tệp mẫu rồi các dòng phòng. */
async function workbook(lines: Line[]): Promise<Buffer> {
  const cell = (value: string | number | null) =>
    value === null ? null : typeof value === "number" ? { value, type: Number } : { value, type: String };
  return writeExcelFile([HEADER.map(cell), ...lines.map((line) => line.map(cell))]).toBuffer();
}

async function rooms(request: APIRequestContext, buildingId: string): Promise<{ code: string }[]> {
  const data = await graphql<{ rows: { code: string }[] }>(
    request,
    "user.a",
    `query($b: uuid!) { rows: ${PREFIX}_rooms(where: {building_id: {_eq: $b}}, order_by: {code: asc}) { code } }`,
    { b: buildingId },
  );
  return data.rows;
}

async function choose(dialog: Locator, name: string, content: Buffer) {
  const mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: content });
}

async function openBuilding(page: Page, code: string, name: string) {
  await openMenuItem(page, "Cơ sở nhà, đất");
  await page.getByRole("textbox", { name: "Tìm" }).fill(code);
  await page.getByRole("button", { name: "Tìm" }).click();
  await page.getByRole("link", { name: code }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.getByRole("link", { name: "NLV" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nhà làm việc thử" })).toBeVisible();
}

test("cán bộ xã A nạp phòng từ tệp Excel: xem trước báo lỗi theo dòng, nạp cả tệp hoặc không dòng nào", async ({
  page,
  request,
}) => {
  const code = uniqueTitle("e2e-nap").replaceAll(" ", "-");
  const name = `Trụ sở thử ${code}`;
  let facilityId: string | undefined;
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
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
    const building = await graphql<{ row: { id: string } }>(
      request,
      "admin.a",
      `mutation($f: uuid!) { row: insert_${PREFIX}_buildings_one(object: {facility_id: $f, code: "NLV", name: "Nhà làm việc thử"}) { id } }`,
      { f: facilityId },
      ADMIN,
    );
    const buildingId = building.row.id;

    await page.goto("/");
    await signIn(page, "user.a");
    await openBuilding(page, code, name);
    await page.getByRole("button", { name: "Nạp từ tệp" }).click();
    const dialog = page.getByRole("dialog", { name: "Nạp phòng từ tệp" });

    // Tệp mẫu: trang đầu chỉ có dòng tiêu đề, đúng nhãn của các trường.
    const [saved] = await Promise.all([
      page.waitForEvent("download"),
      dialog.getByRole("button", { name: "Tải tệp mẫu (.xlsx)" }).click(),
    ]);
    const chunks: Buffer[] = [];
    for await (const chunk of await saved.createReadStream()) chunks.push(chunk as Buffer);
    expect(await readSheet(Buffer.concat(chunks))).toEqual([HEADER]);

    // Dòng 3 thiếu diện tích, dòng 2 và 4 trùng mã: xem trước chỉ đúng chỗ, nút nạp bị khóa.
    await choose(
      dialog,
      "phong.xlsx",
      await workbook([
        ["P101", "Phòng làm việc 1", 1, "Làm việc", 18.5],
        ["P102", "Phòng họp", 1, "Sử dụng chung", null],
        ["P101", "Phòng làm việc 2", 2, "Làm việc", "20,5"],
        ["P104", "Kho lưu trữ", 1, "Chuyên dùng", 12],
      ]),
    );
    // Cả hai dòng mang mã trùng đều được báo, mỗi dòng chỉ tới dòng kia; dòng 5 không có lỗi.
    await expect(dialog.getByText("3 trong 4 dòng có lỗi")).toBeVisible();
    await expect(dialog.getByText("Lỗi: Bắt buộc nhập")).toBeVisible();
    await expect(dialog.getByText("Lỗi: Trùng với dòng 4")).toBeVisible();
    await expect(dialog.getByText("Lỗi: Trùng với dòng 2")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Nạp", exact: true })).toBeDisabled();
    // Cùng ngưỡng chặn với visual.spec.ts: WCAG 2.1 A, AA ở mức critical, serious.
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    const blocking = axe.violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))
      .filter((violation) => violation.tags.some((tag) => ["wcag2a", "wcag2aa", "wcag21aa"].includes(tag)))
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
    expect(blocking, "lỗi trợ năng chặn trong hộp nạp tệp").toEqual([]);

    // Tệp đã sửa; trong lúc xem trước, một phòng P103 được thêm qua API. Lệnh nạp bị từ chối cả lần.
    const fixed: Line[] = [
      ["P101", "Phòng làm việc 1", 1, "Làm việc", 18.5],
      ["P102", "Phòng họp", 1, "Sử dụng chung", 36],
      ["P103", "Phòng làm việc 2", 2, "Làm việc", "20,5"],
    ];
    await choose(dialog, "phong-sua.xlsx", await workbook(fixed));
    await expect(dialog.getByText("3 dòng hợp lệ")).toBeVisible();
    await graphql(
      request,
      "user.a",
      `mutation($b: uuid!) { insert_${PREFIX}_rooms_one(object: {building_id: $b, code: "P103", name: "Kho", area_type: "shared", clear_area_m2: 6}) { id } }`,
      { b: buildingId },
    );
    await dialog.getByRole("button", { name: "Nạp 3 dòng" }).click();
    await expect(dialog.getByText("Đã có dòng mang cùng mã")).toBeVisible();
    expect(await rooms(request, buildingId)).toEqual([{ code: "P103" }]);

    // Chọn lại tệp: kiểm trùng với phòng đã có của tòa báo trước khi gửi; bỏ dòng đó thì nạp được.
    await choose(dialog, "phong-sua.xlsx", await workbook(fixed));
    await expect(dialog.getByText("Lỗi: Đã có trong danh sách hiện tại")).toBeVisible();
    await choose(dialog, "phong-cuoi.xlsx", await workbook(fixed.slice(0, 2)));
    await dialog.getByRole("button", { name: "Nạp 2 dòng" }).click();
    await expect(page.getByText("Đã nạp phòng. Số dòng đã thêm: 2.")).toBeVisible();
    await expect(page.getByRole("link", { name: "P101" })).toBeVisible();
    expect(await rooms(request, buildingId)).toEqual([{ code: "P101" }, { code: "P102" }, { code: "P103" }]);
    expect(violations, "đọc tệp Excel không vi phạm CSP").toEqual([]);
  } finally {
    // Phòng giữ tòa, tòa giữ cơ sở bằng khóa ngoại RESTRICT: xóa từ dưới lên (cơ sở kéo theo phân công).
    if (facilityId) {
      const id = facilityId;
      await graphql(
        request,
        "admin.a",
        `mutation($id: uuid!) { delete_${PREFIX}_rooms(where: {building: {facility_id: {_eq: $id}}}) { affected_rows } delete_${PREFIX}_buildings(where: {facility_id: {_eq: $id}}) { affected_rows } delete_${PREFIX}_facilities_by_pk(id: $id) { id } }`,
        { id },
        ADMIN,
      ).catch((error) => console.warn(`Dọn cơ sở thử chưa xong: ${error}`));
    }
  }
});
