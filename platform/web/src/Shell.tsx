// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung trang khi đã đăng nhập: thanh trên (đơn vị, người dùng, thêm Passkey khi đơn vị cho phép, đăng xuất), menu
// bên trái và vùng nội dung do route hiện tại vẽ. Trên màn hình hẹp, menu thu vào nút mở menu.

import { AppShell, Burger, Button, Group, NavLink, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Link, Outlet, useLocation } from "react-router";
import { userManager } from "./auth";
import { itemPath } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { addPasskey, canAddPasskey } from "./passkey";
import { useSession } from "./session";
import { TenantInfo } from "./TenantInfo";

// Mục của các màn hình dùng chung, luôn có. Mục do các gói đã cài khai trong app.yaml (menu) nối theo sau, đọc qua
// GraphQL theo tenant: gỡ gói thì mục của nó tự mất, không phải sửa giao diện.
const MENU = [{ to: "/tasks", label: "Việc của tôi" }];

const signOut = () => userManager.signoutRedirect();

export function Shell() {
  const { user } = useSession();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname, search } = useLocation();
  const packages = usePackageMenu();
  const items = [...MENU, ...packages.items.map((entry) => ({ to: itemPath(entry), label: entry.label }))];

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
            {/* Luôn hiện cả trên màn hình hẹp: Passkey thường là vân tay hay khuôn mặt trên điện thoại. */}
            {canAddPasskey(user.access_token) && (
              <Button variant="subtle" onClick={() => addPasskey(`${pathname}${search}`)}>
                Thêm Passkey
              </Button>
            )}
            <Button variant="subtle" onClick={signOut}>
              Đăng xuất
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" aria-label="Menu chính">
        {items.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            active={pathname === item.to || pathname.startsWith(`${item.to}/`)}
            onClick={close}
          />
        ))}
        {/* Lỗi đọc menu của gói không chặn các màn hình dùng chung; chỉ báo ở cuối menu. */}
        {packages.error && (
          <Text size="xs" c="red" p="xs" title={packages.error.message}>
            Không đọc được menu của các gói
          </Text>
        )}
      </AppShell.Navbar>
      {/* Nền xám nhạt để các khung nội dung (Paper, nền trắng) tách khỏi nền trang. */}
      <AppShell.Main bg="gray.0">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
