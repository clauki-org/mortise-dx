// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Kiểm phần vẽ của trang chủ (Home.tsx, ADR 0051): việc đang chờ là liên kết chỉ mang tên hồ sơ như ở "Việc của tôi",
// xếp theo hạn và không cắt bớt; mỗi nhóm menu thành một ô có tiêu đề là tên nhóm và lối tắt cùng nhãn, địa chỉ như
// thanh bên. Dựng ra HTML bằng react-dom/server, không cần trình duyệt.

import { MantineProvider } from "@mantine/core";
import type { User } from "oidc-client-ts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PackageTile, WaitingTasks } from "./Home";
import type { MenuGroup } from "./menu";
import { SessionContext } from "./session";
import type { StepConfig, Task } from "./workflow";

const session = { user: { profile: { tenant: ["xa-a"] } } as unknown as User, getToken: () => undefined };

// Bỏ thẻ <style> mà Mantine chèn để chỉ so phần nội dung.
const html = (node: ReactNode) =>
  renderToStaticMarkup(
    <MantineProvider>
      <SessionContext value={session}>
        <MemoryRouter>{node}</MemoryRouter>
      </SessionContext>
    </MantineProvider>,
  ).replace(/<style[^>]*>[^<]*<\/style>/g, "");

const NOW = Date.parse("2026-11-27T00:00:00Z");

const task = (id: string, due: string | null, more: Partial<Task> = {}): Task => ({
  id,
  name: "Duyệt yêu cầu",
  tenant: "xa-a",
  process: "p",
  step: "review",
  due,
  category: null,
  processInstanceId: `i-${id}`,
  created: "2026-11-20T00:00:00Z",
  assignee: null,
  variables: { title: `Hồ sơ ${id}`, initiatorName: "user.a" },
  ...more,
});

const steps = new Map<string, StepConfig>([["p/review", { title: "title" } as StepConfig]]);

/** Chữ của từng liên kết tới việc, theo thứ tự trên trang. */
const taskLinks = (page: string) =>
  [...page.matchAll(/<a[^>]*href="\/tasks\/([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);

describe("WaitingTasks", () => {
  it("mỗi việc là một liên kết chỉ mang tên hồ sơ, việc gần hạn nhất đứng đầu, không hạn đứng cuối", () => {
    const tasks = [task("c", null), task("b", "2026-12-05T00:00:00Z"), task("a", "2026-11-25T00:00:00Z")];
    const page = html(<WaitingTasks tasks={tasks} steps={steps} now={NOW} />);
    expect(taskLinks(page)).toEqual([
      ["a", "Hồ sơ a"],
      ["b", "Hồ sơ b"],
      ["c", "Hồ sơ c"],
    ]);
    expect(page).toContain("Duyệt yêu cầu");
    expect(page).toContain("Người gửi: user.a");
    expect(page).toContain("Quá hạn");
    expect(page).toContain("Không đặt hạn");
    // Mỗi việc là một mục của danh sách thật (ul > li), để trình đọc màn hình đọc được số việc.
    expect(page.match(/<ul[\s>]/g)).toHaveLength(1);
    expect(page.match(/<li[\s>]/g)).toHaveLength(3);
  });

  it("không cắt bớt: mọi việc đều có liên kết", () => {
    const tasks = Array.from({ length: 25 }, (_, index) => task(String(index), null));
    expect(taskLinks(html(<WaitingTasks tasks={tasks} steps={steps} now={NOW} />))).toHaveLength(25);
  });

  it("bước không khai tên hồ sơ thì liên kết mang tên bước, như bảng việc", () => {
    const page = html(<WaitingTasks tasks={[task("x", null)]} steps={new Map()} now={NOW} />);
    expect(taskLinks(page)).toEqual([["x", "Duyệt yêu cầu"]]);
  });

  it("không có việc thì báo rỗng, không có liên kết", () => {
    const page = html(<WaitingTasks tasks={[]} steps={steps} now={NOW} />);
    expect(page).toContain("Không có việc nào đang chờ bạn.");
    expect(taskLinks(page)).toEqual([]);
  });
});

describe("PackageTile", () => {
  const group: MenuGroup = {
    id: "example-app",
    label: "Gói ví dụ",
    collapsible: false,
    links: [
      { to: "/apps/example-app/records", label: "Danh sách", icon: "list" },
      { to: "/apps/example-app/plain", label: "Không hình", icon: null },
    ],
  };

  it("là một vùng có tên là tên nhóm, tiêu đề cấp 2, mỗi mục một lối tắt cùng nhãn và địa chỉ", () => {
    const page = html(<PackageTile group={group} />);
    const heading = page.match(/<h2[^>]*id="([^"]+)"[^>]*>Gói ví dụ<\/h2>/);
    expect(heading).not.toBeNull();
    expect(page).toContain(`<section`);
    expect(page).toContain(`aria-labelledby="${heading?.[1]}"`);
    expect(page).toContain("2 trang");
    expect(page).toMatch(/href="\/apps\/example-app\/records"[^>]*>.*Danh sách/);
    expect(page).toMatch(/href="\/apps\/example-app\/plain"[^>]*>.*Không hình/);
  });

  it("biểu tượng chỉ để nhìn, ẩn với trình đọc màn hình", () => {
    const page = html(<PackageTile group={group} />);
    expect(page.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(1);
  });
});
