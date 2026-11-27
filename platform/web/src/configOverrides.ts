// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trộn cấu hình gốc của một mục menu với phần chỉnh của org (platform.config_overrides, ADR 0060): hàm thuần, không
// React, không import lúc chạy, để scripts/config-overrides-check.mjs chạy được tệp này bằng node mà không cần dựng
// giao diện. Kiểm lại kết quả bằng hàm *Problems của thành phần và quay về bản gốc khi có lỗi nằm ở
// configEffective.ts. Đích nào nhận loại nào phải khớp platform.config_override_target_problem() trong migration
// 20261127233000_config_overrides.sql: CSDL chặn khi ghi, hàm này bỏ qua khi đọc (gói lên bản mới có thể bỏ một trường).

export const OVERRIDE_KINDS = ["label", "hidden", "order", "variant", "block", "threshold"] as const;
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/** Đích "chính mục menu": nhãn, ẩn, thứ tự trên menu, và kiểu của mục khi cấu hình gốc có khóa variant. */
export const ITEM_TARGET = "";

export type Override = { kind: OverrideKind; target: string; value: unknown };
/** Một dòng của view platform_config_overrides_by_tenant. */
export type ItemOverride = Override & { app: string; item: string };

export type Merged = { config: unknown; ignored: string[] };

type Json = Record<string, unknown>;

const OPERATORS = ["gt", "gte", "lt", "lte"] as const;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIANT = /^[a-z][a-z0-9-]{0,39}$/;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const named = (items: Json[], key: string, name: string) => items.find((entry) => entry[key] === name);

/**
 * Thứ tự sau khi chỉnh: phần tử có phần chỉnh order chuyển tới vị trí bằng số đó, phần tử không có giữ vị trí cũ làm
 * số; cùng số thì phần tử được chỉnh đứng trước, rồi theo thứ tự gốc. Chế độ Chỉnh sửa ghi số cho mọi phần tử của danh
 * sách khi đổi thứ tự, nên kết quả khi đó không phụ thuộc cách trộn hai loại.
 */
export function ordered<T>(items: T[], nameOf: (item: T) => string, keys: Map<string, number>): T[] {
  return items
    .map((item, index) => ({ item, index, moved: keys.has(nameOf(item)), key: keys.get(nameOf(item)) ?? index }))
    .sort((a, b) => a.key - b.key || Number(b.moved) - Number(a.moved) || a.index - b.index)
    .map((entry) => entry.item);
}

/** Đích nhận được từng loại của một cấu hình gốc, chỉ ở tầng ngoài cùng; chế độ Chỉnh sửa và bài kiểm CI dùng chung. */
export function overrideTargets(component: string, config: unknown, kind: OverrideKind): string[] {
  const base = isObject(config) ? config : {};
  const targets: string[] = [];
  if (kind === "label" || kind === "hidden" || kind === "order" || (kind === "variant" && "variant" in base)) {
    targets.push(ITEM_TARGET);
  }
  const blocks = list(base.blocks).map((block) => String(block.item));
  if (kind === "variant" || kind === "hidden" || kind === "order" || kind === "block") targets.push(...blocks);
  const fields = list(base.fields);
  if (
    (component === "catalog" || component === "form") &&
    (kind === "label" || kind === "hidden" || kind === "order")
  ) {
    for (const field of fields) {
      const name = String(field.name);
      if (component === "catalog" && kind !== "label" && !IDENTIFIER.test(name)) continue;
      if (component === "form" && kind === "hidden" && field.required === true) continue;
      targets.push(name);
    }
  }
  if (component === "dashboard") {
    const panels = list(base.panels);
    if (kind === "label" || kind === "hidden" || kind === "order") targets.push(...panels.map((p) => String(p.id)));
    for (const panel of panels) {
      for (const card of list(panel.cards)) {
        if (kind === "label" || (kind === "threshold" && isObject(card.tone)))
          targets.push(`${panel.id}.${card.column}`);
      }
    }
  }
  return targets;
}

/** Giá trị đúng dạng của loại; CSDL đã kiểm khi ghi, kiểm lại vì dữ liệu đọc qua mạng. */
function valueFits(kind: OverrideKind, value: unknown): boolean {
  if (kind === "label") return typeof value === "string" && value.trim() !== "" && value.length <= 200;
  if (kind === "hidden" || kind === "block") return typeof value === "boolean";
  if (kind === "order") return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 9999;
  if (kind === "variant") return typeof value === "string" && VARIANT.test(value);
  return (
    isObject(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([key, level]) => (key === "warn_when" || key === "bad_when") && isObject(level) && thresholdOf(level) !== null,
    )
  );
}

/** Phép so và số của một mức trong phần chỉnh ngưỡng: đúng một phép, không kèm chữ. */
function thresholdOf(level: Json): [(typeof OPERATORS)[number], number] | null {
  const keys = Object.keys(level);
  const operator = OPERATORS.find((name) => name === keys[0]);
  const bound = operator ? level[operator] : undefined;
  return keys.length === 1 && operator && typeof bound === "number" && Number.isFinite(bound)
    ? [operator, bound]
    : null;
}

function mergeBlocks(config: Json, overrides: Override[], ignore: (o: Override, why: string) => void): Json {
  let blocks = list(config.blocks).map((block) => ({ ...block }));
  const keys = new Map<string, number>();
  // Thêm, gỡ khối trước: kiểu, thứ tự của khối vừa thêm đọc từ CSDL theo thứ tự tùy ý.
  const first = (o: Override) => Number(o.kind !== "block");
  for (const override of [...overrides].sort((a, b) => first(a) - first(b))) {
    const block = named(blocks, "item", override.target);
    if (override.kind === "block" && override.value === true) {
      if (!block) blocks.push({ item: override.target });
    } else if (!block) {
      ignore(override, "không có khối này");
    } else if (override.kind === "variant") {
      block.variant = override.value;
    } else if (override.kind === "order") {
      keys.set(override.target, override.value as number);
    } else if ((override.kind === "hidden" && override.value === true) || override.kind === "block") {
      blocks = blocks.filter((entry) => entry !== block);
    }
  }
  return { ...config, blocks: ordered(blocks, (block) => String(block.item), keys) };
}

function mergeCatalog(config: Json, overrides: Override[], ignore: (o: Override, why: string) => void): Json {
  const fields = list(config.fields).map((field) => ({ ...field }));
  const listConfig = isObject(config.list) ? config.list : {};
  const original = Array.isArray(listConfig.columns) ? (listConfig.columns as string[]) : [];
  let columns = [...original];
  const keys = new Map<string, number>();
  for (const override of overrides) {
    const field = named(fields, "name", override.target);
    if (!field) ignore(override, "không có trường này");
    else if (override.kind === "label") field.label = override.value;
    // Danh sách chỉ đọc cột của chính bảng; trường qua quan hệ chỉ hiện ở màn hình chi tiết.
    else if (!IDENTIFIER.test(override.target)) ignore(override, "trường qua quan hệ không phải cột của danh sách");
    else if (override.kind === "order") keys.set(override.target, override.value as number);
    else if (override.value === false && !columns.includes(override.target)) columns.push(override.target);
    // Danh sách cần ít nhất một cột: cột đầu là liên kết tới màn hình chi tiết.
    else if (override.value === true && columns.length > 1)
      columns = columns.filter((name) => name !== override.target);
    else if (override.value === true) ignore(override, "không ẩn được cột cuối cùng của danh sách");
  }
  columns = ordered(columns, (name) => name, keys);
  const detail = isObject(config.detail) ? config.detail : undefined;
  const merged: Json = { ...config, fields, list: { ...listConfig, columns } };
  // Tiêu đề màn hình chi tiết mặc định là cột đầu; đổi cột đầu không được đổi theo tiêu đề người dùng đã quen.
  if (original[0] !== undefined && columns[0] !== original[0] && detail?.title === undefined) {
    merged.detail = { ...detail, title: original[0] };
  }
  return merged;
}

function mergeForm(config: Json, overrides: Override[], ignore: (o: Override, why: string) => void): Json {
  let fields = list(config.fields).map((field) => ({ ...field }));
  const keys = new Map<string, number>();
  for (const override of overrides) {
    const field = named(fields, "name", override.target);
    if (!field) ignore(override, "không có trường này");
    else if (override.kind === "label") field.label = override.value;
    else if (override.kind === "order") keys.set(override.target, override.value as number);
    // Ẩn trường bắt buộc thì biểu mẫu không bao giờ gửi được.
    else if (override.value === true && field.required === true) ignore(override, "trường bắt buộc không ẩn được");
    else if (override.value === true) fields = fields.filter((entry) => entry !== field);
  }
  return { ...config, fields: ordered(fields, (field) => String(field.name), keys) };
}

function mergeDashboard(config: Json, overrides: Override[], ignore: (o: Override, why: string) => void): Json {
  // Khối không khai thẻ giữ nguyên không có khóa cards, như cấu hình gốc.
  let panels = list(config.panels).map(
    (panel): Json =>
      Array.isArray(panel.cards) ? { ...panel, cards: list(panel.cards).map((card) => ({ ...card })) } : { ...panel },
  );
  const keys = new Map<string, number>();
  for (const override of overrides) {
    const [panelId = "", column] = override.target.split(".");
    const panel = named(panels, "id", panelId);
    const card = panel && column !== undefined ? named(list(panel.cards), "column", column) : undefined;
    if (!panel || (column !== undefined && !card)) ignore(override, "không có khối hay thẻ này");
    else if (card && override.kind === "label") card.label = override.value;
    else if (card && override.kind === "threshold") applyThreshold(card, override, ignore);
    else if (card) ignore(override, "thẻ số chỉ nhận nhãn và ngưỡng");
    else if (override.kind === "label") panel.title = override.value;
    else if (override.kind === "order") keys.set(panelId, override.value as number);
    else if (override.kind === "threshold") ignore(override, "ngưỡng cần đích <khối>.<cột>");
    else if (override.value === true && panels.length > 1) panels = panels.filter((entry) => entry !== panel);
    else if (override.value === true) ignore(override, "không ẩn được khối cuối cùng");
  }
  return { ...config, panels: ordered(panels, (panel) => String(panel.id), keys) };
}

/** Đổi số của mức đã khai; chữ mức độ giữ của gói. Mức gói không khai thì không có chữ để hiện nên bị bỏ qua. */
function applyThreshold(card: Json, override: Override, ignore: (o: Override, why: string) => void) {
  const tone = isObject(card.tone) ? { ...card.tone } : {};
  for (const [key, level] of Object.entries(override.value as Json)) {
    const base = tone[key];
    const threshold = thresholdOf(level as Json);
    if (!isObject(base) || !threshold) {
      ignore(override, `thẻ không có mức ${key}`);
      continue;
    }
    tone[key] = { [threshold[0]]: threshold[1], label: base.label };
  }
  card.tone = tone;
}

/**
 * Cấu hình sau khi trộn phần chỉnh vào bản gốc, và lý do của từng phần chỉnh bị bỏ qua (đích không còn trong bản
 * gốc, giá trị sai dạng, loại không áp cho thành phần này). Không đổi `base`. Phần chỉnh của chính mục menu (nhãn,
 * ẩn, thứ tự trên menu) không đụng tới cấu hình, trừ kiểu của mục.
 */
export function mergeConfig(component: string, base: unknown, overrides: Override[]): Merged {
  const ignored: string[] = [];
  const ignore = (override: Override, why: string) => ignored.push(`${override.kind} "${override.target}": ${why}`);
  if (!isObject(base))
    return { config: base, ignored: overrides.map((o) => `${o.kind} "${o.target}": cấu hình gốc hỏng`) };
  let config: Json = { ...base };
  const usable = overrides.filter((override) => {
    if (!(OVERRIDE_KINDS as readonly string[]).includes(override.kind)) ignore(override, "loại lạ");
    else if (!valueFits(override.kind, override.value)) ignore(override, "giá trị sai dạng");
    else return true;
    return false;
  });
  const inConfig = usable.filter((override) => override.target !== ITEM_TARGET);
  for (const override of usable.filter((o) => o.target === ITEM_TARGET && o.kind === "variant")) {
    if ("variant" in config) config.variant = override.value;
    else ignore(override, "cấu hình gốc không khai variant");
  }
  // Trang khối: phần chỉnh trỏ tới khối đang có hay khối được thêm (block true) thuộc về danh sách khối, kể cả thứ tự
  // của khối vừa thêm; phần còn lại xét theo thành phần.
  const blockNames = new Set(list(config.blocks).map((block) => block.item));
  for (const override of inConfig)
    if (override.kind === "block" && override.value === true) blockNames.add(override.target);
  const forBlocks = Array.isArray(config.blocks) ? inConfig.filter((o) => blockNames.has(o.target)) : [];
  if (Array.isArray(config.blocks)) config = mergeBlocks(config, forBlocks, ignore);
  const rest = inConfig.filter((o) => !forBlocks.includes(o));
  const accepts: Record<string, OverrideKind[]> = {
    catalog: ["label", "hidden", "order"],
    form: ["label", "hidden", "order"],
    dashboard: ["label", "hidden", "order", "threshold"],
  };
  const fit = rest.filter((override) => {
    if (accepts[component]?.includes(override.kind)) return true;
    ignore(override, `thành phần ${component} không nhận loại này`);
    return false;
  });
  if (component === "catalog") config = mergeCatalog(config, fit, ignore);
  if (component === "form") config = mergeForm(config, fit, ignore);
  if (component === "dashboard") config = mergeDashboard(config, fit, ignore);
  return { config, ignored };
}
