// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Màn hình khi đường dẫn không có trang, hoặc khi một màn hình gặp lỗi lúc vẽ. Router hiện màn hình lỗi trong khung
// trang thay vì để React gỡ cả cây và để lại trang trắng.

import { Button, Stack, Title } from "@mantine/core";
import { Link, useRouteError } from "react-router";
import { ErrorNotice } from "./States";

export function NotFound() {
  return (
    <Stack align="flex-start">
      <Title order={1}>Không có trang này</Title>
      <Button component={Link} to="/tasks">
        Về việc của tôi
      </Button>
    </Stack>
  );
}

export function RouteError() {
  const error = useRouteError();
  return <ErrorNotice title="Màn hình gặp lỗi" error={error} />;
}
