// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung trang khi đã đăng nhập: thanh trên (tên hệ thống, đơn vị và người dùng, thêm Passkey khi đơn vị cho phép,
// đăng xuất), thanh bên với menu chia nhóm (MenuNav.tsx, ADR 0044) và vùng nội dung do route hiện tại vẽ, giới hạn
// bề rộng. Dưới cỡ `sm` thanh bên thu vào nút mở menu; hai nút tài khoản chuyển xuống cuối thanh bên.

import { AppShell, Burger, Button, Container, Group, ScrollArea, Stack, Text, useMatches } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Outlet, useLocation } from "react-router";
import { useOrgAdmin } from "./AppsPage";
import { userManager } from "./auth";
import { Brand } from "./Brand";
import { MenuNav } from "./MenuNav";
import { type MenuGroup, type MenuLink, menuGroups } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { addPasskey, canAddPasskey } from "./passkey";
import { useSession } from "./session";
import { TenantInfo } from "./TenantInfo";

// Nhóm của các màn hình dùng chung, luôn có, đứng đầu; trang chủ là mục đầu (ADR 0051). Mục do các gói đã cài khai trong app.yaml (menu) gom theo gói
// ở sau, đọc qua GraphQL theo tenant: gỡ gói hay quản trị org tắt gói thì nhóm của nó tự mất, không phải sửa giao diện.
const SHARED_LINKS: MenuLink[] = [
  { to: "/", label: "Trang chủ", icon: "home" },
  { to: "/tasks", label: "Việc của tôi", icon: "inbox" },
];
// Trang bật, tắt gói chỉ dành cho quản trị org (ADR 0065); người khác mở đường dẫn thì trang tự báo không có quyền.
const APPS_LINK: MenuLink = { to: "/packages", label: "Ứng dụng", icon: "settings" };

const sharedGroup = (orgAdmin: boolean): MenuGroup => ({
  id: "",
  label: "Chung",
  links: orgAdmin ? [...SHARED_LINKS, APPS_LINK] : SHARED_LINKS,
  collapsible: false,
});

const signOut = () => userManager.signoutRedirect();

/** Thêm Passkey (khi đơn vị cho phép) và đăng xuất; Shell đặt ở thanh trên hay cuối thanh bên tùy bề rộng. */
function AccountActions({ returnTo }: { returnTo: string }) {
  const { user } = useSession();
  return (
    <>
      {canAddPasskey(user.access_token) && (
        <Button variant="subtle" onClick={() => addPasskey(returnTo)}>
          Thêm Passkey
        </Button>
      )}
      <Button variant="subtle" onClick={signOut}>
        Đăng xuất
      </Button>
    </>
  );
}

export function Shell() {
  const { user } = useSession();
  const [opened, { toggle, close }] = useDisclosure();
  const { pathname, search } = useLocation();
  const packages = usePackageMenu();
  const orgAdmin = useOrgAdmin() === true;
  const groups = menuGroups(sharedGroup(orgAdmin), packages.items);
  // Dưới cỡ `sm` thanh bên đóng chỉ bị đẩy ra ngoài màn hình, các liên kết vẫn nhận Tab mà người dùng không thấy tiêu
  // điểm ở đâu. `inert` bỏ cả thanh khỏi thứ tự Tab và cây trợ năng cho tới khi mở menu.
  const narrow = useMatches({ base: true, sm: false }, { getInitialValueInEffect: false });

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="md">
          <Group wrap="nowrap" gap="sm">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={opened ? "Đóng menu" : "Mở menu"}
              aria-expanded={opened}
            />
            {/* Tên hệ thống không phải tiêu đề của trang; mỗi màn hình có tiêu đề cấp 1 của nó. */}
            <Text fw={800} size="lg" style={{ whiteSpace: "nowrap" }}>
              <Brand compact />
            </Text>
          </Group>
          {/* Đơn vị và người dùng hiện ở mọi bề rộng: cùng máy có thể đăng nhập nhiều đơn vị, nhìn nhầm là ghi nhầm. */}
          <Group wrap="nowrap" gap="xs" miw={0}>
            <TenantInfo username={user.profile.preferred_username} />
            <Group visibleFrom="sm" wrap="nowrap" gap={4}>
              <AccountActions returnTo={`${pathname}${search}`} />
            </Group>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar aria-label="Menu chính" inert={narrow && !opened}>
        <AppShell.Section grow component={ScrollArea} p="xs">
          <MenuNav groups={groups} pathname={pathname} onNavigate={close} />
          {/* Lỗi đọc menu của gói không chặn các màn hình dùng chung; chỉ báo ở cuối menu. */}
          {packages.error && (
            <Text size="xs" c="red.8" p="xs" title={packages.error.message}>
              Không đọc được menu của các gói
            </Text>
          )}
        </AppShell.Section>
        {/* Trên điện thoại thanh trên không đủ chỗ cho hai nút; Passkey thường là vân tay hay khuôn mặt trên điện
            thoại nên vẫn phải tới được. */}
        <AppShell.Section hiddenFrom="sm" p="xs" style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
          <Stack gap={4} align="flex-start">
            <AccountActions returnTo={`${pathname}${search}`} />
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>
      {/* Nền trang của bản cài (mặc định xám nhạt, ADR 0063) để các khung nội dung (Paper, nền trắng) tách khỏi nền.
          Giới hạn bề rộng để bảng và biểu mẫu không giãn hết màn hình rộng, dòng chữ còn đọc được. */}
      <AppShell.Main bg="var(--mortise-page-background)">
        <Container size="xl" px={0}>
          <Outlet />
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
