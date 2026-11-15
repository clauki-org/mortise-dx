// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Điểm vào sau khi khởi động: chưa đăng nhập thì mời đăng nhập qua Keycloak; đã đăng nhập thì dựng các màn hình
// theo đường dẫn (React Router) trong khung trang, với client GraphQL và bộ nhớ đệm REST dùng chung.

import { Alert, Button, Center, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { User } from "oidc-client-ts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { Provider } from "urql";
import { ApiError } from "./api";
import { userManager } from "./auth";
import { NotFound, RouteError } from "./Errors";
import { createGraphqlClient } from "./graphql";
import { Shell } from "./Shell";
import { type Session, SessionContext } from "./session";
import { TaskList } from "./TaskList";
import { useAuth } from "./useAuth";

const signIn = () => userManager.signinRedirect();

// Tạo router sau khi đăng nhập xong, không tạo lúc nạp module: lúc đó địa chỉ còn là /callback, và router đọc địa chỉ
// một lần khi tạo nên không thấy lần useAuth thay địa chỉ thành /.
const createRouter = () =>
  createBrowserRouter([
    {
      path: "/",
      element: <Shell />,
      errorElement: <RouteError />,
      children: [
        {
          // Lỗi của một màn hình hiện trong khung trang, menu vẫn dùng được.
          errorElement: <RouteError />,
          children: [
            { index: true, element: <Navigate to="/tasks" replace /> },
            { path: "tasks", element: <TaskList /> },
            { path: "*", element: <NotFound /> },
          ],
        },
      ],
    },
  ]);

// Chỉ lỗi mạng (status 0) và lỗi 5xx có thể tự hết khi gửi lại. Lỗi 4xx (token hết hạn, thiếu quyền) và dữ liệu
// không đọc được không đổi; thử lại chỉ làm người dùng chờ vài giây mới thấy lý do.
const retry = (failures: number, error: Error) =>
  failures < 3 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500);

// Khung chung cho các màn hình trước khi đăng nhập: một thẻ giữa nền xám.
function Gate({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh" bg="gray.0" p="md">
      <Paper withBorder shadow="sm" radius="md" p="xl" w={400} maw="100%">
        <Stack>{children}</Stack>
      </Paper>
    </Center>
  );
}

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
        <Gate>
          <Alert color="red" title="Không đăng nhập được">
            {auth.message}. Thử lại sau ít phút; nếu vẫn lỗi, báo người quản trị.
          </Alert>
          <Button onClick={signIn}>Đăng nhập lại</Button>
        </Gate>
      );
    case "signed-out":
      return (
        <Gate>
          <div>
            <Title order={1} size="h2">
              Mortise DX
            </Title>
            <Text c="dimmed" size="sm">
              Đăng nhập bằng tài khoản do đơn vị cấp để xem và xử lý việc.
            </Text>
          </div>
          <Button size="md" onClick={signIn}>
            Đăng nhập
          </Button>
        </Gate>
      );
    case "signed-in":
      return <SignedIn user={auth.user} />;
  }
}

function SignedIn({ user }: { user: User }) {
  // Token được làm mới thì oidc-client-ts phát đối tượng user mới. Các client đọc token qua ref lúc gửi yêu cầu, nên
  // không phải tạo lại client và dữ liệu đã tải không bị xóa mỗi lần làm mới. Ref được ghi ngay khi vẽ thay vì trong
  // useEffect, để yêu cầu gửi trong lần vẽ đầu sau khi làm mới đã dùng token mới; giá trị ghi chỉ phụ thuộc props.
  const latest = useRef(user);
  latest.current = user;
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry } } }));
  const [router] = useState(createRouter);
  // Router nghe sự kiện điều hướng của trình duyệt; gỡ khi phiên kết thúc để không còn router cũ chạy ngầm.
  useEffect(() => () => router.dispose(), [router]);
  const graphql = useMemo(() => createGraphqlClient(() => latest.current.access_token), []);
  const session = useMemo<Session>(() => ({ user, getToken: () => latest.current.access_token }), [user]);
  return (
    <SessionContext value={session}>
      <QueryClientProvider client={queryClient}>
        <Provider value={graphql}>
          <RouterProvider router={router} />
        </Provider>
      </QueryClientProvider>
    </SessionContext>
  );
}
