// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Áp phần chỉnh của org (ADR 0060) lên menu đọc từ platform.menu_items: nhãn, ẩn, thứ tự của mục trên menu, và cấu
// hình của thành phần sau khi trộn (configOverrides.ts) rồi kiểm lại bằng chính hàm *Problems mà thành phần chạy
// trước khi vẽ. Cấu hình trộn ra có lỗi thì dùng bản gốc và báo ở console: một phần chỉnh hỏng không được làm hỏng
// trang mà gói đã khai đúng. usePackageMenu (PackagePage.tsx) gọi; không có React ở đây để kiểm thử bằng hàm thuần.

import { configProblems as assistantProblems } from "./assistant";
import { type CasesConfig, casesProblems } from "./cases";
import { type CatalogConfig, configProblems as catalogProblems } from "./catalog";
import { ITEM_TARGET, type ItemOverride, mergeConfig, type Override, ordered } from "./configOverrides";
import { type DashboardConfig, dashboardProblems } from "./dashboardConfig";
import { type FormConfig, formProblems } from "./formConfig";
import { type MapConfig, mapProblems } from "./mapConfig";
import type { MenuItem } from "./menu";

export type Warn = (message: string) => void;

// Cùng hàm kiểm mà thành phần chạy trước khi vẽ (Catalog.tsx, FormPanel.tsx...): qua được ở đây thì thành phần không
// hiện lời báo cấu hình hỏng vì phần chỉnh.
const PROBLEMS = new Map<string, (config: unknown) => string[]>([
  ["catalog", (config) => catalogProblems(config as CatalogConfig)],
  ["form", (config) => formProblems(config as FormConfig)],
  ["dashboard", (config) => dashboardProblems(config as DashboardConfig)],
  ["map", (config) => mapProblems(config as MapConfig)],
  ["cases", (config) => casesProblems(config as CasesConfig)],
  ["assistant", assistantProblems],
]);

/** Lỗi của cấu hình theo hàm kiểm của thành phần; hàm kiểm giả định cấu hình đúng schema nên có thể ném lỗi. */
function problemsOf(component: string, config: unknown): string[] {
  try {
    return PROBLEMS.get(component)?.(config) ?? [];
  } catch (error) {
    return [`hàm kiểm lỗi: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** Cấu hình thành phần nhận: bản trộn nếu qua được bước kiểm, không thì bản gốc. */
export function effectiveConfig(component: string, base: unknown, overrides: Override[], warn: Warn): unknown {
  if (overrides.length === 0) return base;
  const { config, ignored } = mergeConfig(component, base, overrides);
  for (const reason of ignored) warn(`Bỏ qua phần chỉnh cấu hình: ${reason}`);
  const problems = problemsOf(component, config);
  if (problems.length === 0) return config;
  warn(`Phần chỉnh làm cấu hình hỏng, dùng cấu hình gốc của gói: ${problems.join("; ")}`);
  return base;
}

const keyOf = (entry: { app: string; item: string }) => `${entry.app}\u0000${entry.item}`;

/**
 * Áp phần chỉnh lên menu, giữ thứ tự gói như câu truy vấn trả về; thứ tự mục đổi trong từng gói. Phần chỉnh của mục
 * không có trong menu (gói đã gỡ, mục dành cho vai trò khác) bị bỏ qua.
 */
export function applyOverrides(items: MenuItem[], overrides: ItemOverride[], warn: Warn): MenuItem[] {
  if (overrides.length === 0) return items;
  const byItem = new Map<string, ItemOverride[]>();
  for (const override of overrides) byItem.set(keyOf(override), [...(byItem.get(keyOf(override)) ?? []), override]);
  const changed = items.map((entry): MenuItem => {
    const own = byItem.get(keyOf(entry)) ?? [];
    if (own.length === 0) return entry;
    const self = (kind: string) => own.find((o) => o.kind === kind && o.target === ITEM_TARGET)?.value;
    const label = self("label");
    const hidden = self("hidden");
    const config = own.filter((o) => o.target !== ITEM_TARGET || o.kind === "variant");
    return {
      ...entry,
      label: typeof label === "string" && label.trim() !== "" ? label : entry.label,
      ...(hidden === true ? { hidden: true } : {}),
      config: effectiveConfig(entry.component, entry.config, config, warn),
    };
  });
  const apps = [...new Set(items.map((entry) => entry.app))];
  return apps.flatMap((app) => {
    const group = changed.filter((entry) => entry.app === app);
    const keys = new Map<string, number>();
    for (const override of overrides) {
      const value = override.value;
      if (
        override.app === app &&
        override.kind === "order" &&
        override.target === ITEM_TARGET &&
        Number.isInteger(value)
      ) {
        keys.set(override.item, value as number);
      }
    }
    return ordered(group, (entry) => entry.item, keys);
  });
}
