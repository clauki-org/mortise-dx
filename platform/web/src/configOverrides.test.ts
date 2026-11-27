// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm thử lớp ghi đè cấu hình (ADR 0060): trộn phần chỉnh vào cấu hình gốc của danh mục, biểu mẫu, bảng điều hành và
// trang khối (configOverrides.ts); kiểm lại bằng hàm *Problems, quay về bản gốc khi hỏng, áp nhãn, ẩn, thứ tự lên menu
// (configEffective.ts). Cấu hình mẫu cùng dạng với contracts/examples.

import { describe, expect, it, vi } from "vitest";
import type { CatalogConfig } from "./catalog";
import { applyOverrides, effectiveConfig } from "./configEffective";
import { type ItemOverride, mergeConfig, OVERRIDE_KINDS, type Override, overrideTargets } from "./configOverrides";
import type { DashboardConfig } from "./dashboardConfig";
import type { FormConfig } from "./formConfig";
import { type MenuItem, packageGroups } from "./menu";

const catalog: CatalogConfig = {
  title: "Danh sách",
  source: "app_example_items",
  fields: [
    { name: "code", label: "Mã" },
    { name: "name", label: "Tên" },
    { name: "status", label: "Trạng thái", choices: [{ value: "a", label: "A" }] },
    { name: "owner.name", label: "Chủ" },
  ],
  list: { columns: ["code", "name"], filters: ["status"] },
};

const form: FormConfig = {
  title: "Nhập",
  fields: [
    { name: "code", label: "Mã", type: "string", required: true },
    { name: "note", label: "Ghi chú", type: "string" },
    { name: "group", label: "Nhóm", type: "choice", source: { table: "t_g", value: "c", label: "n" } },
    {
      name: "item",
      label: "Mục",
      type: "choice",
      source: { table: "t_i", value: "c", label: "n", where: { column: "g", field: "group" } },
    },
  ],
  submit: { label: "Gửi", insert: "app_example_items" },
  done: { message: "Đã gửi" },
};

const dashboard: DashboardConfig = {
  title: "Số",
  panels: [
    {
      id: "main",
      title: "Chính",
      description: "d",
      graphql: { field: "app_example_totals" },
      cards: [{ column: "used", label: "Dùng", description: "d", tone: { warn_when: { gt: 80, label: "Cao" } } }],
    },
    { id: "side", title: "Phụ", description: "d", graphql: { field: "app_example_totals" }, cards: [] },
  ],
};

const o = (kind: Override["kind"], target: string, value: unknown): Override => ({ kind, target, value });
const merged = <T>(component: string, base: T, overrides: Override[]) =>
  mergeConfig(component, base, overrides).config as T;

describe("mergeConfig", () => {
  it("đổi nhãn trường, ẩn, hiện và đổi thứ tự cột của danh mục; không đổi bản gốc", () => {
    const result = merged("catalog", catalog, [
      o("label", "name", "Tên mới"),
      o("hidden", "code", true),
      o("hidden", "status", false),
      o("order", "status", 0),
    ]);
    expect(result.fields.find((field) => field.name === "name")?.label).toBe("Tên mới");
    expect(result.list.columns).toEqual(["status", "name"]);
    // Cột đầu đổi thì tiêu đề màn hình chi tiết vẫn là cột đầu của gói.
    expect(result.detail?.title).toBe("code");
    expect(catalog.list.columns).toEqual(["code", "name"]);
    expect(catalog.fields[1]?.label).toBe("Tên");
  });

  it("bỏ qua đích lạ, trường qua quan hệ làm cột, cột cuối cùng, và giá trị sai dạng, kèm lý do", () => {
    const { config, ignored } = mergeConfig("catalog", catalog, [
      o("label", "nothing", "X"),
      o("hidden", "owner.name", false),
      o("hidden", "code", true),
      o("hidden", "name", true),
      o("label", "code", 5),
      o("threshold", "code", { warn_when: { gt: 1 } }),
    ]);
    expect((config as CatalogConfig).list.columns).toEqual(["name"]);
    expect([...ignored].sort()).toEqual(
      [
        'label "code": giá trị sai dạng',
        'label "nothing": không có trường này',
        'hidden "owner.name": trường qua quan hệ không phải cột của danh sách',
        'hidden "name": không ẩn được cột cuối cùng của danh sách',
        'threshold "code": thành phần catalog không nhận loại này',
      ].sort(),
    );
  });

  it("biểu mẫu: đổi nhãn, ẩn trường không bắt buộc, giữ trường bắt buộc, đổi thứ tự", () => {
    const { config, ignored } = mergeConfig("form", form, [
      o("hidden", "note", true),
      o("hidden", "code", true),
      o("order", "code", 9),
      o("label", "group", "Loại"),
    ]);
    const fields = (config as FormConfig).fields;
    expect(fields.map((field) => field.name)).toEqual(["group", "item", "code"]);
    expect(fields[0]?.label).toBe("Loại");
    expect(ignored).toEqual(['hidden "code": trường bắt buộc không ẩn được']);
  });

  it("bảng điều hành: đổi số của ngưỡng, giữ chữ mức độ của gói; nhãn khối, thẻ; ẩn và đổi thứ tự khối", () => {
    const { config, ignored } = mergeConfig("dashboard", dashboard, [
      o("threshold", "main.used", { warn_when: { gte: 90 } }),
      o("threshold", "main.used", { bad_when: { gt: 95 } }),
      o("label", "main.used", "Đã dùng"),
      o("label", "side", "Phụ mới"),
      o("order", "main", 5),
    ]);
    const [first, second] = (config as DashboardConfig).panels;
    expect([first?.id, first?.title, second?.id]).toEqual(["side", "Phụ mới", "main"]);
    expect(second?.cards?.[0]).toMatchObject({ label: "Đã dùng", tone: { warn_when: { gte: 90, label: "Cao" } } });
    expect(ignored).toEqual(['threshold "main.used": thẻ không có mức bad_when']);
    expect(merged("dashboard", dashboard, [o("hidden", "side", true)]).panels.map((p) => p.id)).toEqual(["main"]);
  });

  it("trang khối: đổi kiểu, gỡ, thêm và đổi thứ tự khối", () => {
    const page = { blocks: [{ item: "list" }, { item: "map", variant: "small" }] };
    const result = merged("page", page, [
      o("order", "numbers", 0),
      o("variant", "list", "cards"),
      o("block", "map", false),
      o("block", "numbers", true),
    ]);
    expect(result.blocks).toEqual([{ item: "numbers" }, { item: "list", variant: "cards" }]);
  });

  it("kiểu của chính mục chỉ áp khi cấu hình gốc khai variant", () => {
    expect(merged("catalog", { ...catalog, variant: "table" }, [o("variant", "", "cards")])).toMatchObject({
      variant: "cards",
    });
    expect(mergeConfig("catalog", catalog, [o("variant", "", "cards")]).ignored).toEqual([
      'variant "": cấu hình gốc không khai variant',
    ]);
  });

  it("mọi đích overrideTargets đưa ra đều được trộn, không bị bỏ qua", () => {
    const samples: Record<Override["kind"], unknown> = {
      label: "Nhãn",
      hidden: false,
      order: 1,
      variant: "cards",
      block: true,
      threshold: { warn_when: { lt: 1 } },
    };
    const configs: [string, unknown][] = [
      ["catalog", catalog],
      ["form", form],
      ["dashboard", dashboard],
      ["page", { blocks: [{ item: "list" }] }],
    ];
    for (const [component, config] of configs) {
      for (const kind of OVERRIDE_KINDS) {
        const targets = overrideTargets(component, config, kind).filter((target) => target !== "");
        const { ignored } = mergeConfig(
          component,
          config,
          targets.map((target) => o(kind, target, samples[kind])),
        );
        expect({ component, kind, ignored }).toEqual({ component, kind, ignored: [] });
      }
    }
  });
});

describe("effectiveConfig", () => {
  it("cấu hình trộn ra có lỗi thì dùng bản gốc và báo ở console", () => {
    const warn = vi.fn();
    // Đổi thứ tự làm trường lọc theo một trường đứng sau nó: formProblems báo lỗi.
    expect(effectiveConfig("form", form, [o("order", "item", 0)], warn)).toBe(form);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dùng cấu hình gốc"));
  });

  it("đích lạ bị bỏ qua kèm cảnh báo, phần chỉnh còn lại vẫn áp", () => {
    const warn = vi.fn();
    const result = effectiveConfig("catalog", catalog, [o("label", "gone", "X"), o("label", "name", "Y")], warn);
    expect((result as CatalogConfig).fields[1]?.label).toBe("Y");
    expect(warn).toHaveBeenCalledWith('Bỏ qua phần chỉnh cấu hình: label "gone": không có trường này');
  });

  it("hàm kiểm ném lỗi thì cũng dùng bản gốc", () => {
    // mapProblems đọc layers như mảng; cấu hình thiếu layers làm nó ném lỗi.
    const broken = { title: "x", variant: "plain" };
    expect(effectiveConfig("map", broken, [o("variant", "", "dense")], () => {})).toBe(broken);
  });
});

const entry = (app: string, item: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  app,
  app_name: app,
  item,
  label: item,
  component: "catalog",
  config: catalog,
  roles: null,
  icon: null,
  ...extra,
});

describe("applyOverrides", () => {
  const items = [entry("a", "x"), entry("a", "y"), entry("a", "z"), entry("b", "w")];
  const at = (app: string, item: string, override: Override): ItemOverride => ({ app, item, ...override });

  it("đổi nhãn, ẩn, thứ tự của mục trong gói, giữ thứ tự gói; mục ẩn không lên menu", () => {
    const result = applyOverrides(
      items,
      [
        at("a", "z", o("order", "", 0)),
        at("a", "x", o("label", "", "Mục X")),
        at("a", "y", o("hidden", "", true)),
        at("b", "w", o("label", "name", "Tên khác")),
        at("gone", "q", o("label", "", "Không có")),
      ],
      () => {},
    );
    expect(result.map((item) => item.item)).toEqual(["z", "x", "y", "w"]);
    expect(result[1]?.label).toBe("Mục X");
    expect((result[3]?.config as CatalogConfig | undefined)?.fields[1]?.label).toBe("Tên khác");
    expect(packageGroups(result).map((group) => group.links.map((link) => link.label))).toEqual([
      ["z", "Mục X"],
      ["w"],
    ]);
  });

  it("không có phần chỉnh thì trả nguyên menu", () => {
    expect(applyOverrides(items, [], () => {})).toBe(items);
  });
});
