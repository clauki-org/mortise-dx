// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm cách thanh bên vẽ nhóm (MenuNav.tsx): mỗi nhóm có tên làm nhãn, liên kết mang nhãn của mục và biểu tượng ẩn
// khỏi trình đọc màn hình; nhóm phụ thu gọn sau nút có aria-expanded, trừ khi đang mở một trang của nhóm đó. Dựng ra
// HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MenuNav } from "./MenuNav";
import type { MenuGroup } from "./menu";

const groups: MenuGroup[] = [
  { id: "", label: "Chung", links: [{ to: "/tasks", label: "Việc", icon: "inbox" }], collapsible: false },
  { id: "extra", label: "Phụ", links: [{ to: "/apps/extra/one", label: "Một", icon: null }], collapsible: true },
];

// Bỏ thẻ <style> mà Mantine chèn: trong đó có sẵn `display: none` của các lớp ẩn theo bề rộng.
const html = (pathname: string) =>
  renderToStaticMarkup(
    <MantineProvider>
      <MemoryRouter>
        <MenuNav groups={groups} pathname={pathname} onNavigate={() => {}} />
      </MemoryRouter>
    </MantineProvider>,
  ).replace(/<style[^>]*>[^<]*<\/style>/g, "");

describe("MenuNav", () => {
  it("nhóm có nhãn, liên kết có biểu tượng ẩn với trình đọc màn hình", () => {
    const page = html("/tasks");
    expect(page.match(/role="group"/g)).toHaveLength(2);
    expect(page).toMatch(/aria-labelledby="[^"]+"/);
    expect(page).toContain('href="/tasks"');
    expect(page).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("nhóm phụ thu gọn lúc đầu, liên kết vẫn có trong trang nhưng ẩn", () => {
    const page = html("/tasks");
    expect(page).toContain('aria-expanded="false"');
    expect(page).toContain('href="/apps/extra/one"');
    expect(page).toMatch(/style="[^"]*display:\s*none[^"]*"[^>]*aria-hidden="true"/);
  });

  it("đang ở trang của nhóm phụ thì nhóm mở sẵn", () => {
    const page = html("/apps/extra/one");
    expect(page).toContain('aria-expanded="true"');
    expect(page).not.toMatch(/display:\s*none/);
  });
});
