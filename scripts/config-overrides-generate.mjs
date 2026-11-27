// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Sinh phần chỉnh hợp lệ cho cấu hình mọi mục menu của mọi gói, trộn bằng đúng hàm trình duyệt dùng
// (platform/web/src/configOverrides.ts, node chạy thẳng tệp .ts vì tệp không import gì lúc chạy), rồi ghi cấu hình đã
// trộn ra thư mục để scripts/config-overrides-check.sh đưa qua bộ kiểm chung của gói (ADR 0060). Mỗi bộ là một thư
// mục: một loại phần chỉnh áp cho mọi đích nhận nó, và bộ "all" gộp mọi loại. Một phần chỉnh bị hàm trộn bỏ qua là
// lỗi của bộ sinh hay của overrideTargets(), nên dừng với mã lỗi.
//
// Cách dùng: node scripts/config-overrides-generate.mjs <input.json> <thư mục ra>
// input.json: [{app, item, component, path, config}], path là đường cấu hình trong app.yaml.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mergeConfig, overrideTargets } from "../platform/web/src/configOverrides.ts";

const KINDS = ["label", "hidden", "order", "threshold"];

// Giá trị hợp lệ cho từng loại, chọn để kết quả vẫn qua bộ kiểm của thành phần: ẩn mọi đích trừ đích đầu (danh sách
// cần một cột, bảng điều hành cần một khối), đảo thứ tự nhưng giữ khối chính đứng đầu, không đảo biểu mẫu có trường
// lọc theo trường trước nó, ngưỡng dời số đi một đơn vị và giữ phép so.
function generate(component, config, kind) {
  const targets = overrideTargets(component, config, kind).filter((target) => target !== "");
  // Nhãn là lời người xem đọc: bộ kiểm của bảng điều hành từ chối nhãn chứa tên cột.
  if (kind === "label") return targets.map((target, index) => ({ kind, target, value: `Nhãn đã chỉnh ${index + 1}` }));
  if (kind === "hidden") {
    // Trường mà trường sau lọc theo (source.where) phải còn trên biểu mẫu.
    const needed = new Set((config.fields ?? []).map((field) => field.source?.where?.field));
    const shown = component === "catalog" ? targets.filter((t) => config.list.columns.includes(t)) : targets;
    const hidden = shown.slice(1).filter((target) => component !== "form" || !needed.has(target));
    return hidden.map((target) => ({ kind, target, value: true }));
  }
  if (kind === "order") return orders(component, config, targets);
  if (kind === "threshold") return targets.map((target) => ({ kind, target, value: shifted(config, target) }));
  return [];
}

function orders(component, config, targets) {
  if (component === "form" && config.fields.some((field) => field.source?.where)) return [];
  if (component === "catalog") targets = targets.filter((target) => config.list.columns.includes(target));
  const pinned = component === "dashboard" && config.panels[0]?.primary ? 1 : 0;
  return targets.map((target, index) => ({
    kind: "order",
    target,
    value: index < pinned ? index : pinned + targets.length - 1 - index,
  }));
}

function shifted(config, target) {
  const [panelId, column] = target.split(".");
  const card = config.panels.find((panel) => panel.id === panelId).cards.find((c) => c.column === column);
  const value = {};
  for (const [level, rule] of Object.entries(card.tone)) {
    const operator = ["gt", "gte", "lt", "lte"].find((name) => name in rule);
    value[level] = { [operator]: rule[operator] + 1 };
  }
  return value;
}

// Mọi loại cùng lúc trên một mục: ẩn đúng một đích (đích cuối), các loại khác áp cho mọi đích còn lại; phần chỉnh trỏ
// vào khối hay cột đã ẩn thì hàm trộn bỏ qua đúng như thiết kế, nên không sinh.
function combined(entry) {
  const hidden = generate(entry.component, entry.config, "hidden").slice(-1);
  const gone = new Set(hidden.map((override) => override.target));
  const rest = KINDS.filter((kind) => kind !== "hidden").flatMap((kind) =>
    generate(entry.component, entry.config, kind).filter((o) => !gone.has(o.target.split(".")[0])),
  );
  return [...hidden, ...rest];
}

const [input, out] = process.argv.slice(2);
if (!input || !out) {
  console.error("Cách dùng: node scripts/config-overrides-generate.mjs <input.json> <thư mục ra>");
  process.exit(2);
}
const entries = JSON.parse(readFileSync(input, "utf-8"));
let failed = false;
let count = 0;
for (const set of [...KINDS, "all"]) {
  for (const entry of entries) {
    const overrides = set === "all" ? combined(entry) : generate(entry.component, entry.config, set);
    const { config, ignored } = mergeConfig(entry.component, entry.config, overrides);
    for (const reason of ignored) {
      console.error(`${entry.app}/${entry.item} (${set}): phần chỉnh sinh ra bị bỏ qua: ${reason}`);
      failed = true;
    }
    count += overrides.length;
    // JSON cũng là YAML hợp lệ: bộ kiểm đọc tệp ở đúng đường dẫn app.yaml khai.
    const file = join(out, set, entry.app, entry.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
}
console.log(`config-overrides: ${count} phần chỉnh sinh ra trên ${entries.length} mục menu, ${KINDS.length + 1} bộ`);
process.exit(failed ? 1 : 0);
