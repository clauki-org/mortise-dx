// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang "Ứng dụng" (ADR 0065): câu truy vấn danh sách gói và trạng thái của org, câu ghi bật, tắt, ai là quản trị org,
// và lý do một nút bật, tắt bị khóa. Lý do tính trước trên trình duyệt từ chính danh sách đọc được, để quản trị thấy
// vì sao trước khi bấm; trigger của platform.app_states vẫn kiểm lại khi ghi. Phần vẽ ở AppsPage.tsx. Không có React ở
// đây để kiểm thử bằng hàm thuần, và không có tên gói nào: tên đọc từ bảng.

import type { CombinedError } from "urql";

/** Một gói đã cài, với trạng thái của tenant gốc của người xem. */
export type PackageRow = {
  app: string;
  name: string;
  description: string | null;
  requires: string[];
  enabled: boolean;
};

export type PackagesData = { platform_apps_by_tenant: PackageRow[] };

export const PACKAGES_QUERY =
  "query { platform_apps_by_tenant(order_by: { name: asc }) { app name description requires enabled } }";

export const SET_PACKAGE_STATE = `mutation SetPackageState($app: String!, $enabled: Boolean!) {
  insert_platform_app_states_one(
    object: { app: $app, enabled: $enabled }
    on_conflict: { constraint: app_states_pkey, update_columns: [enabled] }
  ) { app enabled }
}`;

// Kiểu mà mutation trả về; menu, trang chủ và danh sách gói khai kiểu này để urql đọc lại sau mỗi lần bật, tắt, không
// phải tải lại trang mới thấy menu đổi.
export const PACKAGE_STATE_TYPENAME = "platform_app_states";

// Khai ở mức module: urql so context theo tham chiếu, một đối tượng mới mỗi lần vẽ thì truy vấn chạy lại mãi.
export const PACKAGES_CONTEXT = { role: "tenant_admin", additionalTypenames: [PACKAGE_STATE_TYPENAME] };

// parent_id của chính tenant trong token; vai trò user đọc được cột này (core/hasura/tables.yaml).
export const TENANT_QUERY = "query { core_tenants { id parent_id } }";
export type TenantData = { core_tenants: { id: string; parent_id: string | null }[] };

/**
 * Quản trị org: tenant_admin của tenant không có cha. Chỉ để hiện hay ẩn trang trên menu; quyền thật do Hasura kiểm.
 * Chưa đọc được tenant thì coi như không phải, để menu không hiện mục rồi rút lại.
 */
export function isOrgAdmin(roles: string[], tenants: TenantData["core_tenants"] | undefined): boolean {
  return roles.includes("tenant_admin") && tenants?.length === 1 && tenants[0]?.parent_id === null;
}

const nameOf = (rows: PackageRow[], app: string) => {
  const row = rows.find((candidate) => candidate.app === app);
  return row ? row.name : `${app} (chưa cài)`;
};

/**
 * Vì sao chưa đổi được trạng thái của gói `app`; null là đổi được. Tắt: gói đang bật nào cần nó. Bật: gói nó cần nào
 * chưa cài hay đang tắt. Cùng hai luật với platform.app_states_guard().
 */
export function blockedReason(rows: PackageRow[], app: string): string | null {
  const row = rows.find((candidate) => candidate.app === app);
  if (!row) return null;
  if (row.enabled) {
    const users = rows.filter((other) => other.app !== app && other.enabled && other.requires.includes(app));
    if (users.length === 0) return null;
    return `Gói đang bật ${users.map((other) => other.name).join(", ")} cần gói này; tắt các gói đó trước.`;
  }
  const missing = row.requires.filter((needed) => !rows.some((other) => other.app === needed && other.enabled));
  if (missing.length === 0) return null;
  return `Gói này cần ${missing.map((needed) => nameOf(rows, needed)).join(", ")}; bật các gói đó trước.`;
}

/** Tên hiển thị của các gói mà gói cần, theo thứ tự khai; gói cần chưa cài thì ghi rõ. */
export const requiredNames = (rows: PackageRow[], row: PackageRow) => row.requires.map((app) => nameOf(rows, app));

/**
 * Lời từ chối của CSDL khi ghi (trigger nói lý do bằng tiếng Việt). Hasura đặt trước câu của PostgreSQL một cụm như
 * "Check constraint violation."; bỏ cụm đó để người đọc chỉ thấy lý do. Lỗi không phải từ chối thì trả null để nơi
 * gọi hiện lời báo lỗi chung.
 */
export function refusalText(error: CombinedError | undefined): string | null {
  const message = error?.graphQLErrors[0]?.message;
  if (!message) return null;
  return message.replace(/^[A-Za-z ]*violation\.\s*/, "");
}
