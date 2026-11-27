// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Bài kiểm tổ hợp của nguyên tắc ghép (ADR 0061): mọi mục của contracts/examples và của từng gói trong apps/ (menu và
// blocks của app.yaml, cấu hình đọc từ tệp thật) được dựng ở mọi vị trí (đứng riêng trên trang của mục, là khối trên
// một trang), với mọi kiểu của thành phần cộng một kiểu lạ, và mọi trạng thái dữ liệu GraphQL (có dòng, rỗng, lỗi
// quyền, đang tải); thêm một trang chứa mọi mục của gói. Mỗi tổ hợp đi qua PackagePage như trên trình duyệt, với client
// urql giả trả dữ liệu dựng từ chính câu truy vấn. renderToStaticMarkup không gọi ranh giới lỗi, nên một lỗi lúc vẽ
// làm bài hỏng thay vì bị khối nuốt: bài đòi không tổ hợp nào ném lỗi, không báo cấu hình sai, có đúng một h1. Nguồn
// REST (TanStack Query) không chạy khi dựng tĩnh nên phần đó luôn ở trạng thái đang tải.

import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { Client, CombinedError, type Exchange, type Operation, Provider } from "urql";
import { describe, expect, it, vi } from "vitest";
import { filter, fromValue, mergeMap, never, pipe } from "wonka";
import { parse as parseYaml } from "yaml";
import { BlockBoundary, BlockFailure } from "./Block";
import type { CatalogConfig, RecordBlock } from "./catalog";
import type { MenuItem } from "./menu";
import { COMPONENTS, PackagePage } from "./PackagePage";
import { variantsOf, withVariant } from "./page";
import { SessionContext } from "./session";

// Khung bản đồ nạp MapLibre (WebGL) khi cần; khi dựng tĩnh chỉ có phần chờ, thay bằng mô-đun rỗng để lần nạp thật
// không chạy sau khi bài đã xong.
vi.mock("./MapCanvas", () => ({ default: () => null }));

// Tệp YAML của gói và của hợp đồng, nạp lúc dựng bài bằng Vite (khóa là đường dẫn tính từ tệp này); gói mới thêm vào
// apps/ được kiểm mà không phải sửa bài.
const FILES: Record<string, string> = import.meta.glob(
  ["../../../apps/*/**/*.yaml", "../../../contracts/examples/*.yaml"],
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);
function yamlAt(path: string): unknown {
  const text = FILES[`../../../${path}`];
  if (text === undefined) throw new Error(`không có tệp ${path}`);
  return parseYaml(text);
}

type Declared = { id: string; label: string; component: string; config: string; roles?: string[] };
type App = { id: string; name: string; menu?: Declared[]; blocks?: Declared[] };

/** Mục của một gói như bảng menu_items: menu rồi blocks, cấu hình là nội dung tệp. */
function packageItems(app: App, configOf: (entry: Declared) => unknown): MenuItem[] {
  const menu = app.menu ?? [];
  return [...menu, ...(app.blocks ?? [])].map((entry, index) => ({
    app: app.id,
    app_name: app.name,
    item: entry.id,
    label: entry.label,
    component: entry.component,
    config: configOf(entry),
    roles: entry.roles ?? null,
    icon: null,
    on_menu: index < menu.length,
  }));
}

// Gói mẫu của hợp đồng: tệp cấu hình trong app.example.yaml không có thật, mỗi thành phần dùng ví dụ của nó; ví dụ
// chưa có mục nào trong app.example.yaml thì thêm một mục.
function exampleItems(): MenuItem[] {
  const app = yamlAt("contracts/examples/app.example.yaml") as App;
  const declared = [...(app.menu ?? []), ...(app.blocks ?? [])];
  const extra = ["form", "cases", "assistant-data", "catalog", "dashboard", "map"]
    .filter((name) => !declared.some((entry) => entry.component === name))
    .map((name) => ({ id: `extra-${name}`, label: name, component: name.split("-")[0] ?? name, config: name }));
  const file = (entry: Declared) => (entry.id.startsWith("extra-") ? entry.config : entry.component);
  return packageItems({ ...app, blocks: [...(app.blocks ?? []), ...extra] }, (entry) =>
    yamlAt(`contracts/examples/${file(entry)}.example.yaml`),
  );
}

function appItems(): MenuItem[][] {
  const names = Object.keys(FILES).flatMap(
    (path) => /^\.\.\/\.\.\/\.\.\/apps\/([^/]+)\/app\.yaml$/.exec(path)?.[1] ?? [],
  );
  return names.map((name) => {
    const app = yamlAt(`apps/${name}/app.yaml`) as App;
    return packageItems(app, (entry) => yamlAt(`apps/${name}/${entry.config}`));
  });
}

const PACKAGES = [exampleItems(), ...appItems()];

/** Mọi vai trò mà gói nhắc tới, để không mục hay khối nào bị ẩn theo vai trò. */
function rolesIn(value: unknown, found = new Set<string>(["user", "tenant_admin"])): Set<string> {
  if (Array.isArray(value)) for (const item of value) rolesIn(item, found);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "role" && typeof item === "string") found.add(item);
      else if (key === "roles" && Array.isArray(item)) for (const role of item) found.add(String(role));
      else rolesIn(item, found);
    }
  }
  return found;
}

type DataState = "rows" | "empty" | "denied" | "loading";
const DATA_STATES: DataState[] = ["rows", "empty", "denied", "loading"];

type Selection = { kind: string; name: { value: string }; alias?: { value: string }; selectionSet?: SelectionSet };
type SelectionSet = { selections: readonly Selection[] };

/** Một dòng dựng theo các cột của câu truy vấn: cột lá là số 1, quan hệ là đối tượng con cùng cách dựng. */
function rowOf(set: SelectionSet): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const field of set.selections) {
    if (field.kind !== "Field") continue;
    const name = field.alias?.value ?? field.name.value;
    row[name] = field.selectionSet ? rowOf(field.selectionSet) : 1;
  }
  return row;
}

const DENIED = new CombinedError({
  graphQLErrors: [{ message: "field 'x' not found in type: 'query_root'", extensions: { code: "validation-failed" } }],
});

/**
 * Client giả: menu luôn trả `menu`, ghi đè luôn rỗng; dòng đang xem của chi tiết (bí danh s0 của chainQuery) luôn có, để trạng thái dữ
 * liệu tới được khối trong chi tiết; câu khác trả theo `state`, dựng từ chính câu truy vấn. Biến của mọi câu được ghi
 * vào `sent` để bài đọc lại điều kiện đã gửi.
 */
function fakeClient(menu: MenuItem[], state: DataState, sent: unknown[] = []): Client {
  const answer = (operation: Operation) => {
    const definition = operation.query.definitions[0] as unknown as { selectionSet: SelectionSet };
    const roots = definition.selectionSet.selections.filter((field) => field.kind === "Field");
    if (roots.some((field) => field.name.value === "platform_menu_items")) {
      return fromValue({ operation, data: { platform_menu_items: menu }, stale: false, hasNext: false });
    }
    // Ghi đè cấu hình của org (ADR 0060) là một phần của menu: khung trang chờ nó, nên luôn trả rỗng, kể cả ở trạng
    // thái "đang tải" của dữ liệu khối.
    if (roots.some((field) => field.name.value === "platform_config_overrides_by_tenant")) {
      return fromValue({ operation, data: { platform_config_overrides_by_tenant: [] }, stale: false, hasNext: false });
    }
    sent.push(operation.variables);
    const host = roots.some((field) => field.alias?.value === "s0");
    if (state === "loading" && !host) return never;
    if (state === "denied" && !host) return fromValue({ operation, error: DENIED, stale: false, hasNext: false });
    const data: Record<string, unknown> = {};
    for (const field of roots) {
      const row = field.selectionSet ? rowOf(field.selectionSet) : 1;
      // Một dòng: thẻ số của bảng điều hành đòi đúng một dòng, nguồn trả nhiều dòng là lỗi dữ liệu của gói, có lời
      // báo riêng, không phải lỗi ghép.
      data[field.alias?.value ?? field.name.value] = state === "rows" || host ? [row] : [];
    }
    return fromValue({ operation, data, stale: false, hasNext: false });
  };
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === "query"),
      mergeMap(answer),
    );
  return new Client({ url: "/v1/graphql", exchanges: [exchange] });
}

function render(menu: MenuItem[], path: string, state: DataState, roles: string[], sent?: unknown[]): string {
  const payload = btoa(JSON.stringify({ realm_access: { roles } }));
  const session = { user: { profile: { tenant: ["xa-a"] } } as unknown as User, getToken: () => `x.${payload}.y` };
  return renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <SessionContext value={session}>
          <QueryClientProvider client={new QueryClient()}>
            <Provider value={fakeClient(menu, state, sent)}>
              <Routes>
                <Route path="/apps/:app/:item/*" element={<PackagePage />} />
              </Routes>
            </Provider>
          </QueryClientProvider>
        </SessionContext>
      </MemoryRouter>
    </MantineProvider>,
  );
}

const TEST_PAGE = "combination-page";
const TEST_RECORD = "combination-record";
// Cột mà khối thử gắn với dòng đang xem; dòng giả có mọi cột bằng 1 nên khóa của dòng là 1.
const ATTACH_COLUMN = "record_id";

// Thành phần chỉ đọc GraphQL: trạng thái của client giả phải thấy được trên trang (lời báo lỗi, vòng tải), để bài không
// qua chỉ vì client giả không trả gì.
const GRAPHQL = new Set(["catalog", "map"]);

/** Mục trang thử chứa các khối cho trước; mã không trùng mục nào của gói. */
const pageItem = (app: string, blocks: { item: string; variant?: string }[]): MenuItem => ({
  app,
  app_name: app,
  item: TEST_PAGE,
  label: "Trang thử",
  component: "page",
  config: { title: "Trang thử", blocks },
  roles: null,
  icon: null,
  on_menu: true,
});

/** Nguồn đầu tiên của một mục mà khối trong chi tiết gắn được (cùng luật với scripts/check-record-blocks.py). */
function firstSource(entry: MenuItem): string | undefined {
  const config = entry.config as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(config[key]) ? (config[key] as unknown[]) : []);
  const objects = (key: string) => list(key) as Record<string, unknown>[];
  if (entry.component === "catalog") return config.source as string;
  if (entry.component === "map") return objects("layers")[0]?.source as string | undefined;
  if (entry.component === "dashboard") {
    const panel = objects("panels").find((candidate) => candidate.graphql);
    return (panel?.graphql as { field?: string } | undefined)?.field;
  }
  if (entry.component === "cases") return list("processes")[0] as string | undefined;
  return undefined;
}

/** Mục danh mục thử: một bảng giả, chi tiết dòng chứa đúng một khối. */
const recordItem = (app: string, block: RecordBlock): MenuItem => ({
  app,
  app_name: app,
  item: TEST_RECORD,
  label: "Danh mục thử",
  component: "catalog",
  config: {
    title: "Danh mục thử",
    source: "test_records",
    fields: [{ name: "name", label: "Tên" }],
    list: { columns: ["name"] },
    detail: { blocks: [block] },
  },
  roles: null,
  icon: null,
  on_menu: true,
});

type Combination = {
  name: string;
  menu: MenuItem[];
  path: string;
  state: DataState;
  label?: string;
  nested?: boolean;
  /** Thành phần đọc GraphQL mà trạng thái dữ liệu phải hiện ra được trên trang */
  graphql?: boolean;
  component?: string;
  /** Kiểu đã áp và cấu hình gốc của mục, để biết Kanban, Lịch có vẽ thật hay đã về bảng (ADR 0066) */
  variant?: string;
  config?: unknown;
  /** Điều kiện của dòng đang xem mà một câu GraphQL phải gửi */
  filter?: string;
};

/** Mọi tổ hợp mục × vị trí × kiểu × trạng thái dữ liệu của một gói, và trang chứa mọi mục của gói. */
function combinations(items: MenuItem[]): Combination[] {
  const found: Combination[] = [];
  for (const entry of items) {
    const known = variantsOf(entry.component);
    // Kiểu lạ phải về kiểu mặc định; thành phần chưa có kiểu chỉ có một cách vẽ.
    const variants = known.length > 0 ? [...known, "unknown-variant"] : [undefined];
    for (const variant of variants) {
      for (const state of DATA_STATES) {
        const alone = items.map((item) =>
          item === entry ? { ...item, config: withVariant(item.config, item.component, variant) } : item,
        );
        found.push({
          name: `${entry.app}/${entry.item} riêng, ${variant ?? "mặc định"}, ${state}`,
          menu: alone,
          path: `/apps/${entry.app}/${entry.item}`,
          state,
          graphql: GRAPHQL.has(entry.component),
          component: entry.component,
          variant,
          config: entry.config,
        });
        found.push({
          name: `${entry.app}/${entry.item} trên trang, ${variant ?? "mặc định"}, ${state}`,
          menu: [...items, pageItem(entry.app, [{ item: entry.item, variant }])],
          path: `/apps/${entry.app}/${TEST_PAGE}`,
          state,
          label: entry.label,
          nested: entry.component === "page",
          graphql: GRAPHQL.has(entry.component),
          component: entry.component,
          variant,
          config: entry.config,
        });
        if (entry.component === "page") continue;
        // Trong chi tiết một dòng (ADR 0068): có attach khi thành phần có nguồn gắn được, và không có attach.
        const source = firstSource(entry);
        const places = source ? [{ source, column: ATTACH_COLUMN }, undefined] : [undefined];
        for (const attach of places) {
          found.push({
            name: `${entry.app}/${entry.item} trong chi tiết, ${attach ? "gắn" : "không gắn"}, ${variant ?? "mặc định"}, ${state}`,
            menu: [...items, recordItem(entry.app, { item: entry.item, variant, attach })],
            path: `/apps/${entry.app}/${TEST_RECORD}/1`,
            state,
            label: entry.label,
            graphql: GRAPHQL.has(entry.component),
            component: entry.component,
            // Theo dõi hồ sơ đọc REST, không chạy khi dựng tĩnh; điều kiện của nó kiểm ở cases.test.ts.
            filter: attach && entry.component !== "cases" ? `{"${ATTACH_COLUMN}":{"_eq":1}}` : undefined,
          });
        }
      }
    }
  }
  // Chi tiết dòng của danh mục thật với khối gói khai (detail.blocks).
  for (const entry of items.filter((item) => item.component === "catalog")) {
    const blocks = (entry.config as CatalogConfig).detail?.blocks ?? [];
    if (blocks.length === 0) continue;
    for (const state of DATA_STATES) {
      found.push({
        name: `${entry.app}/${entry.item} chi tiết dòng với khối của gói, ${state}`,
        menu: items,
        path: `/apps/${entry.app}/${entry.item}/1`,
        state,
        label: items.find((item) => item.item === blocks[0]?.item)?.label,
      });
    }
  }
  const app = items[0]?.app ?? "";
  const every = pageItem(
    app,
    items.filter((item) => item.component !== "page").map((item) => ({ item: item.item })),
  );
  for (const state of DATA_STATES) {
    const path = `/apps/${app}/${TEST_PAGE}`;
    found.push({ name: `${app}: mọi mục trên một trang, ${state}`, menu: [...items, every], path, state });
  }
  return found;
}

const ALL = PACKAGES.flatMap(combinations);

describe("tổ hợp khối", () => {
  it("đọc được mục của contracts/examples và của mọi gói, có đủ kiểu của các thành phần có kiểu", () => {
    expect(PACKAGES.length).toBeGreaterThan(1);
    const components = new Set(PACKAGES.flat().map((item) => item.component));
    for (const name of ["catalog", "dashboard", "map", "page"]) expect(components).toContain(name);
    // Số tổ hợp ghi vào README (ADR 0061); in ra để đọc khi chạy npm test.
    console.info(`blocks.test.tsx: ${ALL.length} tổ hợp`);
  });

  it.each(ALL.map((combination) => [combination.name, combination] as const))("%s", (_name, combination) => {
    const roles = [...rolesIn(combination.menu)];
    const sent: unknown[] = [];
    const html = render(combination.menu, combination.path, combination.state, roles, sent);
    // Khối gắn với dòng phải gửi điều kiện của dòng trong chính biến của câu truy vấn, không chỉ vẽ được.
    if (combination.filter) {
      expect(sent.map((variables) => JSON.stringify(variables)).join("\n")).toContain(combination.filter);
    }
    expect(html).not.toMatch(/Cấu hình [^<]* sai/);
    // Trang đặt làm khối trong trang thử chỉ hiện lời báo của lớp đỡ trang lồng trang; mục khác phải mở được.
    if (!combination.nested) expect(html).not.toContain("Chưa mở được");
    else expect(html).toContain("Chưa mở được khối này");
    expect(html).not.toContain("Không có trang này");
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    if (combination.label) expect(html).toContain(`aria-label="${combination.label}"`);
    // Danh mục: dữ liệu giả phải tới được danh sách, nên "có dòng" và "rỗng" khác nhau trên trang.
    if (combination.component === "catalog" && combination.state === "rows") {
      expect(html).not.toContain("Chưa có dòng nào.");
    }
    if (combination.component === "catalog" && combination.state === "empty")
      expect(html).toContain("Chưa có dòng nào.");
    // Kanban và Lịch vẽ thật khi cấu hình khai mục của chúng, và về bảng khi không: dữ liệu giả có giá trị 1 ở mọi cột,
    // nên thẻ rơi vào cột "Chưa xếp cột" và dòng của lịch vào danh sách ngày không đọc được.
    if (
      combination.component === "catalog" &&
      (combination.variant === "kanban" || combination.variant === "calendar")
    ) {
      const declared = Object.hasOwn((combination.config ?? {}) as object, combination.variant);
      const marker = combination.variant === "kanban" ? "Chưa xếp cột" : "Không xếp được vào lịch";
      if (combination.state === "rows" && declared) expect(html).toContain(marker);
      if (!declared) expect(html).not.toContain(combination.variant === "kanban" ? "Chưa xếp cột" : "Lịch theo");
      if (combination.variant === "calendar" && declared) expect(html).toContain('aria-label="Lịch theo"');
      const move = (combination.config as { kanban?: { move?: unknown } }).kanban?.move;
      if (combination.variant === "kanban" && combination.state === "rows" && move) {
        expect(html).toContain('aria-label="Chuyển sang: 1"');
      }
    }
    if (combination.graphql && combination.state === "denied") expect(html).toContain('role="alert"');
    if (combination.graphql && combination.state === "loading") expect(html).toContain('aria-label="Đang tải');
    // Khung bản đồ nạp lười nên khi dựng tĩnh luôn ở phần chờ của nó; vòng tải khác phải hết khi đã có kết quả.
    if (combination.graphql && combination.state !== "loading") {
      expect(html).not.toMatch(/aria-label="Đang tải(?! bản đồ")/);
    }
  });
});

describe("ranh giới lỗi của khối", () => {
  it("lỗi lúc vẽ làm bài dựng tĩnh hỏng, cả khi đứng riêng lẫn trong khối, nên bài tổ hợp không qua nhờ khối nuốt lỗi", () => {
    COMPONENTS.set("broken-test", () => {
      throw new Error("hỏng");
    });
    try {
      const broken = { ...pageItem("x", []), item: "broken", component: "broken-test", config: {} };
      const page = pageItem("x", [{ item: "broken" }]);
      expect(() => render([broken], "/apps/x/broken", "rows", [])).toThrow("hỏng");
      expect(() => render([broken, page], `/apps/x/${TEST_PAGE}`, "rows", [])).toThrow("hỏng");
    } finally {
      COMPONENTS.delete("broken-test");
    }
  });

  it("lỗi lúc vẽ thành trạng thái lỗi của khối, kể cả giá trị ném ra không phải Error", () => {
    expect(BlockBoundary.getDerivedStateFromError(new Error("hỏng")).error?.message).toBe("hỏng");
    expect(BlockBoundary.getDerivedStateFromError("chuỗi").error?.message).toBe("chuỗi");
  });

  it("lời báo là khối lỗi chung, nêu tên khối và các khối khác vẫn dùng được", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <BlockFailure label="Bản đồ" error={new Error("hỏng")} />
      </MantineProvider>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Khối &quot;Bản đồ&quot; gặp lỗi");
    expect(html).toContain("Các khối khác trên trang vẫn dùng được.");
  });
});
