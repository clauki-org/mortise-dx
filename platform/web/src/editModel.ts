// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Những gì chế độ Chỉnh sửa (ADR 0070) hiện cho một mục: nhãn, ẩn, thứ tự, kiểu của chính mục; khối của trang; cột,
// trường của danh mục và biểu mẫu; khối và thẻ số của bảng điều hành. Mọi danh sách dựng từ cấu hình gốc của gói cộng
// phần chỉnh (đã lưu và đang chờ), không từ cấu hình đã trộn: phần đã ẩn mất khỏi cấu hình đã trộn, mà quản trị vẫn cần
// thấy để hiện lại. Chỉ đưa ra điều overrideTargets() nhận, để giao diện không mời làm điều CSDL sẽ từ chối. Không có
// React ở đây.

import type { CatalogConfig } from "./catalog";
import { VIEW_LABELS, viewsOf } from "./catalogViews";
import { ITEM_TARGET, type ItemOverride, mergeConfig, ordered, overrideTargets } from "./configOverrides";
import type { Card, DashboardConfig, Level } from "./dashboardConfig";
import type { MenuItem } from "./menu";
import { variantsOf } from "./page";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
// Cột của chính bảng; trường qua quan hệ (có dấu chấm) chỉ đổi được nhãn, như overrideTargets().
const IDENTIFIER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Phần chỉnh của một đích trong danh sách phần chỉnh của mục. */
const valueAt = (own: ItemOverride[], kind: string, target: string) =>
  own.find((row) => row.kind === kind && row.target === target)?.value;

/** Số thứ tự đã chỉnh của từng đích trong mục. */
function orderKeys(own: ItemOverride[]): Map<string, number> {
  const keys = new Map<string, number>();
  for (const row of own)
    if (row.kind === "order" && Number.isInteger(row.value)) keys.set(row.target, row.value as number);
  return keys;
}

/** Phần chỉnh của riêng mục `entry`. */
export const ownOverrides = (overrides: ItemOverride[], entry: Pick<MenuItem, "app" | "item">) =>
  overrides.filter((row) => row.app === entry.app && row.item === entry.item);

// Chữ của từng kiểu; danh mục dùng chữ của nút "Kiểu hiển thị" để quản trị thấy cùng một tên ở hai nơi.
const OTHER_VARIANT_LABELS: Record<string, string> = {
  full: "Đầy đủ",
  compact: "Gọn",
  map: "Bản đồ",
  list: "Danh sách",
};
export const variantLabel = (variant: string) =>
  (VIEW_LABELS as Record<string, string>)[variant] ?? OTHER_VARIANT_LABELS[variant] ?? variant;

/**
 * Kiểu vẽ được của một mục: danh mục chỉ có Kanban, Lịch khi cấu hình khai mục của chúng (thiếu thì giao diện âm thầm
 * về bảng), thành phần khác theo enum của schema.
 */
export function usableVariants(entry: Pick<MenuItem, "component" | "config">): string[] {
  if (entry.component === "catalog" && isObject(entry.config)) return viewsOf(entry.config as CatalogConfig);
  return [...variantsOf(entry.component)];
}

export type ItemModel = {
  label: string;
  hidden: boolean;
  /** Kiểu của chính mục, khi cấu hình gốc khai `variant`; undefined là không đổi được. */
  variant?: string;
  variants: string[];
};

export function itemModel(entry: MenuItem, own: ItemOverride[]): ItemModel {
  const label = valueAt(own, "label", ITEM_TARGET);
  const canVariant = overrideTargets(entry.component, entry.config, "variant").includes(ITEM_TARGET);
  const base = isObject(entry.config) ? entry.config.variant : undefined;
  const chosen = valueAt(own, "variant", ITEM_TARGET) ?? base;
  return {
    label: typeof label === "string" ? label : entry.label,
    hidden: valueAt(own, "hidden", ITEM_TARGET) === true,
    ...(canVariant ? { variant: String(chosen) } : {}),
    variants: canVariant ? usableVariants(entry) : [],
  };
}

/** Mục trên menu của cùng gói theo thứ tự sau phần chỉnh, để đưa mục lên, xuống. */
export function menuSiblings(items: MenuItem[], overrides: ItemOverride[], app: string) {
  const group = items.filter((entry) => entry.app === app && entry.on_menu !== false);
  const keys = new Map<string, number>();
  for (const row of overrides) {
    if (row.app === app && row.kind === "order" && row.target === ITEM_TARGET && Number.isInteger(row.value))
      keys.set(row.item, row.value as number);
  }
  return ordered(group, (entry) => entry.item, keys).map((entry) => ({
    target: entry.item,
    label: (valueAt(ownOverrides(overrides, entry), "label", ITEM_TARGET) as string | undefined) ?? entry.label,
  }));
}

export type BlockRow = {
  target: string;
  label: string;
  hidden: boolean;
  /** Khối thêm bằng phần chỉnh, không có trong cấu hình gốc: gỡ là xóa phần chỉnh đó. */
  added: boolean;
  variant?: string;
  variants: string[];
  /** Kiểu gói đặt cho khối; chọn lại kiểu này là xóa phần chỉnh kiểu. */
  baseVariant?: string;
};

/** Khối của trang (thành phần có `blocks`), theo thứ tự sau phần chỉnh; khối đã gỡ không có trong danh sách. */
export function blockRows(entry: MenuItem, own: ItemOverride[], items: MenuItem[]): BlockRow[] {
  const base = list(isObject(entry.config) ? entry.config.blocks : undefined);
  const names = base.map((block) => String(block.item));
  const added = own.filter((row) => row.kind === "block" && row.value === true && !names.includes(row.target));
  const rows = [
    ...base.map((block) => ({ target: String(block.item), baseVariant: block.variant, added: false })),
    ...added.map((row) => ({ target: row.target, baseVariant: undefined, added: true })),
  ]
    // Đích của khối là tên mục: mục đặt hai lần trên trang chỉ chỉnh được lần đặt đầu, như mergeConfig() áp.
    .filter((row, index, all) => all.findIndex((other) => other.target === row.target) === index)
    .filter((row) => valueAt(own, "block", row.target) !== false);
  return ordered(rows, (row) => row.target, orderKeys(own)).map((row) => {
    const item = items.find((candidate) => candidate.app === entry.app && candidate.item === row.target);
    const variants = item ? usableVariants(item) : [];
    const itemVariant = isObject(item?.config) ? item.config.variant : undefined;
    const chosen = valueAt(own, "variant", row.target) ?? row.baseVariant ?? itemVariant ?? variants[0];
    return {
      target: row.target,
      label: item?.label ?? row.target,
      hidden: valueAt(own, "hidden", row.target) === true,
      added: row.added,
      variants,
      ...(variants.length > 0 ? { variant: String(chosen) } : {}),
      ...(typeof row.baseVariant === "string" ? { baseVariant: row.baseVariant } : {}),
    };
  });
}

/**
 * Mục thêm được làm khối: mục khác của cùng gói (menu hay `blocks` của app.yaml), không phải trang (trang lồng trang
 * có thể tự chứa mình), chưa có trên trang. `removed` là khối gốc đã gỡ: thêm lại là xóa phần chỉnh gỡ.
 */
export function blockCandidates(entry: MenuItem, own: ItemOverride[], items: MenuItem[], rows: BlockRow[]) {
  const base = list(isObject(entry.config) ? entry.config.blocks : undefined).map((block) => String(block.item));
  return items
    .filter((item) => item.app === entry.app && item.item !== entry.item && item.component !== "page")
    .filter((item) => !rows.some((row) => row.target === item.item))
    .map((item) => ({
      target: item.item,
      label: item.label,
      removed: base.includes(item.item) && valueAt(own, "block", item.item) === false,
    }));
}

export type FieldRow = {
  target: string;
  /** Nhãn gói đặt, để gọi tên trường trong nhãn của ô nhập khi nhãn đang đổi. */
  baseLabel: string;
  label: string;
  hidden: boolean;
  canHide: boolean;
  canMove: boolean;
};

/**
 * Cột, trường của danh mục và biểu mẫu. Danh mục: cột đang hiện theo thứ tự của danh sách, rồi cột đang ẩn, rồi trường
 * qua quan hệ (chỉ đổi nhãn). Biểu mẫu: trường theo thứ tự sau phần chỉnh; trường bắt buộc không ẩn được.
 */
export function fieldRows(entry: MenuItem, own: ItemOverride[]): FieldRow[] {
  const fields = list(isObject(entry.config) ? entry.config.fields : undefined);
  const labelOf = (field: Json) => {
    const value = valueAt(own, "label", String(field.name));
    return typeof value === "string" ? value : String(field.label ?? field.name);
  };
  const row = (field: Json, hidden: boolean, canHide: boolean, canMove: boolean): FieldRow => ({
    target: String(field.name),
    baseLabel: String(field.label ?? field.name),
    label: labelOf(field),
    hidden,
    canHide,
    canMove,
  });
  if (entry.component === "catalog") {
    const merged = mergeConfig("catalog", entry.config, own).config as CatalogConfig;
    const columns = merged.list?.columns ?? [];
    const byName = (name: string) => fields.find((field) => field.name === name);
    const shown = columns.flatMap((name) => {
      const field = byName(name);
      return field ? [row(field, false, columns.length > 1, true)] : [];
    });
    const rest = fields.filter((field) => !columns.includes(String(field.name)));
    return [
      ...shown,
      ...rest.filter((field) => IDENTIFIER_NAME.test(String(field.name))).map((field) => row(field, true, true, false)),
      ...rest
        .filter((field) => !IDENTIFIER_NAME.test(String(field.name)))
        .map((field) => row(field, false, false, false)),
    ];
  }
  const hideable = overrideTargets("form", entry.config, "hidden");
  return ordered(fields, (field) => String(field.name), orderKeys(own)).map((field) =>
    row(field, valueAt(own, "hidden", String(field.name)) === true, hideable.includes(String(field.name)), true),
  );
}

export type LevelRow = { key: "warn_when" | "bad_when"; operator: string; bound: number; label: string };
export type CardRow = { target: string; baseLabel: string; label: string; levels: LevelRow[] };
export type PanelRow = { target: string; baseLabel: string; label: string; hidden: boolean; cards: CardRow[] };

const OPERATORS = ["gt", "gte", "lt", "lte"] as const;

/** Mức của thẻ sau phần chỉnh ngưỡng: phép so và chữ của gói, số đã chỉnh nếu có. */
function levelRows(card: Card, override: unknown): LevelRow[] {
  const changed = isObject(override) ? override : {};
  return (["warn_when", "bad_when"] as const).flatMap((key) => {
    const level = card.tone?.[key] as Level | undefined;
    const operator = OPERATORS.find((name) => level?.[name] !== undefined);
    if (!level || !operator) return [];
    const edited = isObject(changed[key]) ? (changed[key] as Json)[operator] : undefined;
    const bound = typeof edited === "number" ? edited : (level[operator] as number);
    return [{ key, operator, bound, label: level.label }];
  });
}

/** Khối và thẻ số của bảng điều hành theo thứ tự sau phần chỉnh; khối đang ẩn vẫn có trong danh sách. */
export function panelRows(entry: MenuItem, own: ItemOverride[]): PanelRow[] {
  const config = (isObject(entry.config) ? entry.config : { panels: [] }) as DashboardConfig;
  const text = (target: string, fallback: string) => {
    const value = valueAt(own, "label", target);
    return typeof value === "string" ? value : fallback;
  };
  return ordered(config.panels ?? [], (panel) => panel.id, orderKeys(own)).map((panel) => ({
    target: panel.id,
    baseLabel: panel.title,
    label: text(panel.id, panel.title),
    hidden: valueAt(own, "hidden", panel.id) === true,
    cards: (panel.cards ?? []).map((card) => {
      const target = `${panel.id}.${card.column}`;
      return {
        target,
        baseLabel: card.label,
        label: text(target, card.label),
        levels: levelRows(card, valueAt(own, "threshold", target)),
      };
    }),
  }));
}

/** Giá trị ghi cho phần chỉnh ngưỡng: mọi mức gói khai, giữ phép so của gói, không kèm chữ. */
export function thresholdValue(levels: LevelRow[]): Record<string, Record<string, number>> {
  return Object.fromEntries(levels.map((level) => [level.key, { [level.operator]: level.bound }]));
}

// Chữ đọc được của phép so, cạnh ô nhập số của ngưỡng.
export const OPERATOR_TEXT: Record<string, string> = { gt: "lớn hơn", gte: "từ", lt: "nhỏ hơn", lte: "tới" };
