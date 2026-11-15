// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung trang khi đã đăng nhập: thanh trên (đơn vị, người dùng, đăng xuất), menu bên trái và vùng nội dung do route
// hiện tại vẽ. Trên màn hình hẹp, menu thu vào nút mở menu.

import { AppShell, Burger, Button, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Outlet, useLocation } from "react-router";
import { userManager } from "./auth";
import { useSession } from "./session";
import { TenantInfo } from "./TenantInfo";

// Mục của các màn hình dùng chung. Mục do gói khai trong app.yaml (menu) được nối vào đây khi có bộ cài gói.
const MENU = [{ to: "/tasks", label: "Việc của tôi" }];

const signOut = () => userManager.signoutRedirect();

export function Shell() {
  const { user } = useSession();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname } = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group wrap="nowrap">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={opened ? "Đóng menu" : "Mở menu"}
              aria-expanded={opened}
            />
            {/* Tên hệ thống không phải tiêu đề của trang; mỗi màn hình có tiêu đề cấp 1 của nó. */}
            <Text fw={700} size="lg" style={{ whiteSpace: "nowrap" }}>
              Mortise DX
            </Text>
          </Group>
          <Group wrap="nowrap">
            <Group visibleFrom="sm" wrap="nowrap">
              <TenantInfo />
              <Text size="sm">{user.profile.preferred_username}</Text>
            </Group>
            <Button variant="subtle" onClick={signOut}>
              Đăng xuất
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Menu chính">
        {MENU.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            active={pathname === item.to || pathname.startsWith(`${item.to}/`)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>
      {/* Nền xám nhạt để các khung nội dung (Paper, nền trắng) tách khỏi nền trang. */}
      <AppShell.Main bg="gray.0">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
