// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bản nháp của chế độ Chỉnh sửa (ADR 0060, 0070): các thay đổi quản trị org đã chọn mà chưa lưu, cách gộp chúng, phần
// chỉnh sẽ có sau khi lưu, thứ tự ghi và câu mutation lên platform.config_overrides. Giao diện ở EditMode.tsx; các
// danh sách khối, trường, thẻ dựng từ bản nháp ở editModel.ts. Không có React ở đây để kiểm thử bằng hàm thuần.

import { ITEM_TARGET, type ItemOverride, type OverrideKind } from "./configOverrides";

type Place = { app: string; item: string };
type Key = Place & { kind: OverrideKind; target: string };

/**
 * Một thay đổi chờ lưu. `set` ghi (hay ghi đè) một phần chỉnh, `unset` xóa một phần chỉnh, `reset` là "Về mặc định":
 * xóa mọi phần chỉnh của mục. `note` là câu người dùng đọc trong danh sách chờ lưu.
 */
export type Change =
  | (Key & { type: "set"; value: unknown; note: string })
  | (Key & { type: "unset"; note: string })
  | (Place & { type: "reset"; note: string });

const sameItem = (a: Place, b: Place) => a.app === b.app && a.item === b.item;
const sameKey = (a: Key, b: Key) => sameItem(a, b) && a.kind === b.kind && a.target === b.target;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Khóa của một thay đổi, để gắn lời từ chối của CSDL với đúng dòng trong danh sách chờ lưu. */
export const changeKey = (change: Change) =>
  change.type === "reset"
    ? `${change.app}\u0000${change.item}`
    : `${change.app}\u0000${change.item}\u0000${change.kind}\u0000${change.target}`;

/** Phần chỉnh sẽ có sau khi lưu bản nháp: phần chỉnh đã lưu, áp lần lượt từng thay đổi. */
export function draftOverrides(saved: ItemOverride[], draft: Change[]): ItemOverride[] {
  let rows = [...saved];
  for (const change of draft) {
    if (change.type === "reset") {
      rows = rows.filter((row) => !sameItem(row, change));
      continue;
    }
    rows = rows.filter((row) => !sameKey(row, change));
    if (change.type === "set") {
      const { app, item, kind, target, value } = change;
      rows.push({ app, item, kind, target, value });
    }
  }
  return rows;
}

/**
 * Thêm thay đổi của một thao tác vào bản nháp. Thay đổi sau cùng của một đích thay thay đổi trước; "Về mặc định" bỏ
 * thay đổi trước đó của mục. Thay đổi không làm khác gì (ghi đúng giá trị đang có, xóa phần chỉnh không có) bị bỏ, để
 * danh sách chờ lưu chỉ có điều thật sự đổi: một lần đưa lên, đưa xuống ghi số cho mọi phần tử, phần lớn không đổi.
 */
export function addChanges(saved: ItemOverride[], draft: Change[], changes: Change[]): Change[] {
  let next = [...draft];
  for (const change of changes) {
    if (change.type === "reset") {
      next = [...next.filter((entry) => !sameItem(entry, change)), change];
      continue;
    }
    next = next.filter((entry) => entry.type === "reset" || !sameKey(entry, change));
    const now = draftOverrides(saved, next).find((row) => sameKey(row, change));
    const wanted = change.type === "set" ? change.value : undefined;
    // Bỏ thay đổi cũ của đích đã đưa đích về đúng giá trị muốn có (hoàn tác bằng tay) thì không cần thay đổi mới.
    if (same(now?.value, wanted)) continue;
    next.push(change);
  }
  return next;
}

/**
 * Thứ tự ghi: xóa trước ghi (một lần "Về mặc định" không được xóa phần vừa ghi sau nó), thêm khối (`block` true) trước
 * kiểu, thứ tự, ẩn của khối đó, vì trigger chỉ nhận đích là khối đã thêm khi dòng `block` đã có.
 */
export function saveOrder(draft: Change[]): Change[] {
  const rank = (change: Change) => {
    if (change.type === "reset") return 0;
    if (change.type === "unset") return 1;
    return change.kind === "block" ? 2 : 3;
  };
  return draft
    .map((change, index) => ({ change, index }))
    .sort((a, b) => rank(a.change) - rank(b.change) || a.index - b.index)
    .map((entry) => entry.change);
}

/** Thay đổi đưa phần tử thứ `index` lên (-1) hay xuống (1): ghi số thứ tự cho mọi phần tử, như ordered() đòi hỏi. */
export function moveChanges(
  place: Place,
  targets: { target: string; label: string }[],
  index: number,
  step: -1 | 1,
): Change[] {
  const to = index + step;
  if (index < 0 || to < 0 || to >= targets.length) return [];
  const next = [...targets];
  const [moved] = next.splice(index, 1);
  if (!moved) return [];
  next.splice(to, 0, moved);
  return next.map((entry, position) => ({
    type: "set",
    ...place,
    kind: "order",
    target: entry.target,
    value: position,
    note: `Thứ tự: "${entry.label}" ở vị trí ${position + 1}`,
  }));
}

/**
 * Đưa một mục lên, xuống trên menu: thứ tự trên menu là phần chỉnh `order` của từng mục anh em với đích rỗng, nên mỗi
 * thay đổi thuộc về mục được ghi số, không phải mục đang mở.
 */
export function menuMoveChanges(
  app: string,
  siblings: { target: string; label: string }[],
  index: number,
  step: -1 | 1,
): Change[] {
  return moveChanges({ app, item: "" }, siblings, index, step).flatMap((change) =>
    change.type === "set" ? [{ ...change, item: change.target, target: ITEM_TARGET }] : [],
  );
}

// Ghi bằng vai trò tenant_admin; quyền Hasura lấy tenant gốc từ token và chỉ nhận tenant không có cha. Kiểu trả về
// khớp additionalTypenames của truy vấn phần chỉnh trong PackagePage.tsx, nên trang đọc lại sau mỗi lần ghi.
export const SET_OVERRIDE = `mutation SetOverride($app: String!, $item: String!, $kind: String!, $target: String!, $value: jsonb!) {
  insert_platform_config_overrides_one(
    object: { app: $app, item: $item, kind: $kind, target: $target, value: $value }
    on_conflict: { constraint: config_overrides_pkey, update_columns: [value] }
  ) { app item kind target }
}`;

export const UNSET_OVERRIDE = `mutation UnsetOverride($app: String!, $item: String!, $kind: String!, $target: String!) {
  delete_platform_config_overrides(
    where: { app: { _eq: $app }, item: { _eq: $item }, kind: { _eq: $kind }, target: { _eq: $target } }
  ) { affected_rows }
}`;

// "Về mặc định" luôn lọc theo cả gói và mục: thiếu một điều kiện thì xóa phần chỉnh của mục khác.
export const RESET_ITEM = `mutation ResetItem($app: String!, $item: String!) {
  delete_platform_config_overrides(where: { app: { _eq: $app }, item: { _eq: $item } }) { affected_rows }
}`;

// Khai ở mức module: urql so context theo tham chiếu.
export const EDIT_CONTEXT = {
  role: "tenant_admin",
  additionalTypenames: ["platform_config_overrides", "platform_config_overrides_mutation_response"],
};

/** Câu mutation và biến của một thay đổi. */
export function mutationOf(change: Change): { query: string; variables: Record<string, unknown> } {
  const { app, item } = change;
  if (change.type === "reset") return { query: RESET_ITEM, variables: { app, item } };
  const { kind, target } = change;
  if (change.type === "unset") return { query: UNSET_OVERRIDE, variables: { app, item, kind, target } };
  return { query: SET_OVERRIDE, variables: { app, item, kind, target, value: change.value } };
}
