// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Khung trang: chưa đăng nhập thì mời đăng nhập qua Keycloak; đã đăng nhập thì có thanh trên cùng (tên người dùng,
// đăng xuất) và vùng nội dung. Menu bên trái thêm khi có màn hình đầu tiên (danh mục, bảng việc).

import { Alert, AppShell, Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import type { User } from "oidc-client-ts";
import { useMemo } from "react";
import { Provider } from "urql";
import { userManager } from "./auth";
import { createGraphqlClient } from "./graphql";
import { TenantInfo } from "./TenantInfo";
import { useAuth } from "./useAuth";

const signIn = () => userManager.signinRedirect();
const signOut = () => userManager.signoutRedirect();

export function App() {
  const auth = useAuth();
  switch (auth.status) {
    case "loading":
      return (
        <Center h="100vh">
          <Loader aria-label="Đang tải" />
        </Center>
      );
    case "error":
      return (
        <Center h="100vh">
          <Stack maw={480}>
            <Alert color="red" title="Không đăng nhập được">
              {auth.message}. Thử lại sau ít phút; nếu vẫn lỗi, báo người quản trị.
            </Alert>
            <Button onClick={signIn}>Đăng nhập lại</Button>
          </Stack>
        </Center>
      );
    case "signed-out":
      return (
        <Center h="100vh">
          <Stack align="center">
            <Title order={2}>Mortise DX</Title>
            <Button onClick={signIn}>Đăng nhập</Button>
          </Stack>
        </Center>
      );
    case "signed-in":
      return <SignedIn user={auth.user} />;
  }
}

function SignedIn({ user }: { user: User }) {
  // Token được làm mới thì oidc-client-ts phát đối tượng user mới, client được tạo lại với token mới.
  const client = useMemo(() => createGraphqlClient(() => user.access_token), [user]);
  return (
    <Provider value={client}>
      <AppShell header={{ height: 56 }} padding="md">
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Title order={4}>Mortise DX</Title>
            <Group>
              <Text size="sm">{user.profile.preferred_username}</Text>
              <Button variant="subtle" onClick={signOut}>
                Đăng xuất
              </Button>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Main>
          <TenantInfo />
        </AppShell.Main>
      </AppShell>
    </Provider>
  );
}
