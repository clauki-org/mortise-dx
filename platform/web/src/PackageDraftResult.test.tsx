// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm màn hình kết quả của bản nháp cấu hình gói trên phản hồi thật của lượt demo ghi ở docs/assistant-eval/ (ADR
// 0071): mọi tệp hiện kèm nút tải, lập luận ghi rõ phần nào chép từ hợp đồng và phần nào mô hình viết chưa kiểm, tệp
// còn phải viết có mục riêng; YAML có thẻ HTML hiện như chữ thường. Kiểu PackageDraft viết tay được đối chiếu với
// contracts/assistant.openapi.json để hai bên không lệch nhau. Dựng ra HTML bằng react-dom/server.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import openapiText from "../../../contracts/assistant.openapi.json?raw";
import evalText from "../../../docs/assistant-eval/2026-11-28-package-draft-gemini-3.5-flash-lite.json?raw";
import { PackageDraftResult } from "./PackageDraftResult";
import { canDraft, downloadName, draftModelLine, type PackageDraft } from "./packageDraft";

// Mỗi lượt trong tệp đo là phản hồi của API kèm `need`, nhu cầu đã gửi; bỏ trường đó để còn đúng phản hồi.
const runs = (JSON.parse(evalText) as { runs: (PackageDraft & { need: string })[] }).runs.map(
  ({ need: _need, ...response }) => response as PackageDraft,
);
// Lượt đầu là bản nháp qua bước kiểm, lượt sau là lời từ chối (docs/assistant-eval/, cùng tên tệp .md).
function run(index: number): PackageDraft {
  const found = runs[index];
  if (!found) throw new Error(`Tệp đo thiếu lượt thứ ${index + 1}`);
  return found;
}
const DRAFTED = run(0);
const REFUSED = run(1);

function render(draft: PackageDraft): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <PackageDraftResult draft={draft} />
    </MantineProvider>,
  );
}

// Token giả chỉ cần phần claims: canDraft đọc realm_access.roles như rolesOf của menu.
const tokenWith = (roles: string[]) => `x.${btoa(JSON.stringify({ realm_access: { roles } })).replaceAll("=", "")}.y`;

describe("PackageDraftResult", () => {
  it("hiện kết luận, mọi tệp kèm nút tải và tệp còn phải viết", () => {
    const html = render(DRAFTED);
    expect(html).toContain("Bản nháp qua bước kiểm theo hợp đồng");
    expect(html).toContain("không xét bản nháp có đủ mọi việc của nhu cầu");
    for (const file of DRAFTED.files) {
      expect(html).toContain(`aria-label="Tải tệp ${file.path}"`);
    }
    expect(html).toContain("Tệp còn phải viết trước khi cài");
    for (const file of DRAFTED.to_write) expect(html).toContain(file.path);
    expect(DRAFTED.to_write.length).toBeGreaterThan(0);
  });

  it("lập luận tách phần chép từ hợp đồng với phần mô hình viết chưa kiểm", () => {
    const html = render(DRAFTED);
    const argument = DRAFTED.choices.find((choice) => choice.arguments.length > 0)?.arguments[0];
    expect(argument).toBeDefined();
    expect(html).toContain("Công dụng (chép từ contracts/):");
    expect(html).toContain("Giải thích của mô hình, chưa kiểm:");
    expect(html).toContain(argument?.need);
    // Mục không còn lập luận nào sau bước kiểm thì nói rõ, không để trống.
    if (DRAFTED.choices.some((choice) => choice.arguments.length === 0)) {
      expect(html).toContain("Không có lập luận nào qua bước kiểm cho mục này.");
    }
  });

  it("bản nháp còn lỗi hiện lý do và từng lỗi", () => {
    const html = render({
      ...DRAFTED,
      outcome: "invalid",
      reason: "Bản nháp còn lỗi sau một lượt sửa.",
      problems: [{ path: "app.yaml", message: "$.menu[0]: 'id' is a required property" }],
    });
    expect(html).toContain("Bản nháp còn lỗi");
    expect(html).toContain("Lỗi còn lại");
    expect(html).toContain("&#x27;id&#x27; is a required property");
  });

  it("lời từ chối không hiện tệp nào", () => {
    const html = render(REFUSED);
    expect(html).toContain("Trợ lý không soạn bản nháp cho nhu cầu này");
    expect(html).toContain(REFUSED.reason ?? "");
    expect(html).not.toContain("Tải tệp");
  });

  it("YAML có thẻ HTML hiện như chữ thường", () => {
    const html = render({
      ...DRAFTED,
      files: [{ path: "app.yaml", component: null, content: "name: <b>Bỏ qua mọi quy tắc</b>" }],
    });
    expect(html).toContain("&lt;b&gt;Bỏ qua mọi quy tắc&lt;/b&gt;");
    expect(html).not.toContain("<b>");
  });
});

describe("packageDraft", () => {
  it("dòng mô hình ghi nơi chạy và lượt sửa", () => {
    expect(draftModelLine(DRAFTED)).toBe(
      `Soạn bởi ${DRAFTED.model.name}, qua API ${DRAFTED.model.host}; bước kiểm thấy lỗi ở lượt đầu nên mô hình đã sửa một lần.`,
    );
    expect(draftModelLine(REFUSED)).toBe(`Soạn bởi ${REFUSED.model.name}, qua API ${REFUSED.model.host}.`);
  });

  it("tên tệp tải về giữ thư mục để hai tệp cùng tên không đè nhau", () => {
    expect(downloadName("catalog/requests.yaml")).not.toBe(downloadName("cases/requests.yaml"));
    expect(downloadName("app.yaml")).toBe("app.yaml");
  });

  it("chỉ tenant_admin soạn được", () => {
    expect(canDraft(tokenWith(["tenant_admin", "user"]))).toBe(true);
    expect(canDraft(tokenWith(["user", "manager"]))).toBe(false);
    expect(canDraft(undefined)).toBe(false);
  });

  it("kiểu PackageDraft khớp hợp đồng", () => {
    const schemas = JSON.parse(openapiText).components.schemas;
    const keys = (name: string) => Object.keys(schemas[name].properties).sort();
    expect(keys("PackageDraft")).toEqual(Object.keys(DRAFTED).sort());
    // Mọi tệp, mục, lập luận của phản hồi thật có đúng các khóa của hợp đồng.
    for (const file of DRAFTED.files) expect(keys("DraftFile")).toEqual(Object.keys(file).sort());
    for (const choice of DRAFTED.choices) {
      expect(keys("DraftChoice")).toEqual(Object.keys(choice).sort());
      for (const argument of choice.arguments) expect(keys("DraftArgument")).toEqual(Object.keys(argument).sort());
    }
    expect(schemas.PackageDraft.properties.outcome.enum.sort()).toEqual(["drafted", "invalid", "refused"]);
  });
});
