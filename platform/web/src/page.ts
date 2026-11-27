// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang gồm nhiều khối (ADR 0061, contracts/page.schema.json) và kiểu trình bày (variant) của từng thành phần: kiểu hợp
// lệ, kiểu mặc định, cấu hình của khối sau khi áp kiểu, kiểm cấu hình trang. Phần vẽ ở Page.tsx và Block.tsx. Không
// có React và không có chữ của một lĩnh vực nào ở đây.

export type PageBlock = { item: string; variant?: string };
export type PageConfig = { title: string; description?: string; blocks: PageBlock[] };

// Cùng danh sách với `variant` trong contracts/<thành phần>.schema.json, kiểu đầu là mặc định; page.test.ts so hai bên
// để không lệch. Thành phần không có ở đây chưa có kiểu nào.
export const VARIANTS = {
  catalog: ["table", "cards", "kanban", "calendar"],
  dashboard: ["full", "compact"],
  map: ["map", "list"],
} as const satisfies Record<string, readonly string[]>;

type Variants = typeof VARIANTS;
export type Variant<C extends keyof Variants> = Variants[C][number];

const isComponent = (name: string): name is keyof Variants => Object.hasOwn(VARIANTS, name);

/**
 * Kiểu sẽ vẽ: giá trị lạ (cấu hình viết cho bản giao diện mới hơn, hay dữ liệu cũ) về kiểu mặc định thay vì làm hỏng
 * khối; `make check-fast` đã chặn giá trị lạ trong gói, nên ở đây chỉ là lớp đỡ cuối.
 */
export function variantOf<C extends keyof Variants>(component: C, value: unknown): Variant<C> {
  const allowed: readonly string[] = VARIANTS[component];
  return (allowed.includes(value as string) ? value : allowed[0]) as Variant<C>;
}

/** Kiểu một thành phần nhận được, theo thứ tự trong schema; rỗng khi thành phần chưa có kiểu. */
export const variantsOf = (component: string): readonly string[] => (isComponent(component) ? VARIANTS[component] : []);

/**
 * Cấu hình mà khối đưa cho thành phần: kiểu chọn ở trang đè lên kiểu trong cấu hình của mục. Thành phần không có kiểu,
 * hay cấu hình không phải đối tượng, giữ nguyên để thành phần tự báo cấu hình sai như khi đứng riêng.
 */
export function withVariant(config: unknown, component: string, variant: string | undefined): unknown {
  if (variant === undefined || !isComponent(component)) return config;
  if (typeof config !== "object" || config === null || Array.isArray(config)) return config;
  return { ...config, variant };
}

/** Lỗi dạng của cấu hình trang mà schema đã chặn ở `make check-fast`; giao diện vẫn kiểm để không vỡ khi dữ liệu lệch. */
export function pageProblems(config: unknown): string[] {
  if (typeof config !== "object" || config === null) return ["cấu hình không phải một đối tượng"];
  const { title, blocks } = config as Partial<PageConfig>;
  const problems = [];
  if (typeof title !== "string" || title.trim() === "") problems.push("thiếu title");
  if (!Array.isArray(blocks) || blocks.length === 0) problems.push("cần ít nhất một khối trong blocks");
  else if (blocks.some((block) => typeof block?.item !== "string")) problems.push("khối thiếu item");
  return problems;
}
