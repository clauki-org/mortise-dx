// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang của một mục menu do gói khai (/apps/<gói>/<mục>/...): tìm mục trong menu của tenant, rồi vẽ thành phần Tầng 2
// mà mục chỉ định với cấu hình của gói. Gói không có mã giao diện riêng: thêm một gói chỉ thêm dòng menu, không thêm
// trang. Menu đọc qua usePackageMenu, dùng chung với Shell nên urql chỉ gửi một truy vấn.

import { Alert, Center, Loader } from "@mantine/core";
import { Fragment, type ReactNode, useMemo } from "react";
import { useParams } from "react-router";
import { useQuery } from "urql";
import { Assistant } from "./Assistant";
import type { AssistantConfig } from "./assistant";
import { Catalog } from "./Catalog";
import type { CatalogConfig } from "./catalog";
import { NotFound } from "./Errors";
import { MapPanel } from "./MapPanel";
import type { MapConfig } from "./mapConfig";
import { findItem, itemPath, MENU_QUERY, type MenuData, rolesOf, visibleItems } from "./menu";
import { useSession } from "./session";

/** Menu của gói mà người dùng thấy, đã lọc theo vai trò trong token. */
export function usePackageMenu() {
  const { getToken } = useSession();
  const [{ data, fetching, error }] = useQuery<MenuData>({ query: MENU_QUERY });
  const items = useMemo(() => visibleItems(data?.platform_menu_items ?? [], rolesOf(getToken())), [data, getToken]);
  return { items, loaded: data !== undefined, fetching, error };
}

// `app` là gói của mục: thành phần cần nó khi dữ liệu nó đọc thuộc về gói (văn bản của trợ lý).
type Render = (config: unknown, basePath: string, app: string) => ReactNode;

// Tên thành phần là dữ liệu đọc từ CSDL nên tra bằng Map: tra trên đối tượng thường thì tên như "constructor" hay
// "toString" sẽ khớp với thuộc tính có sẵn của mọi đối tượng. Thành phần mới thêm một dòng ở đây; tên hợp lệ do
// contracts/app.schema.json liệt kê.
const COMPONENTS = new Map<string, Render>([
  ["catalog", (config, basePath) => <Catalog config={config as CatalogConfig} basePath={basePath} />],
  ["map", (config) => <MapPanel config={config as MapConfig} />],
  ["assistant", (config, _basePath, app) => <Assistant config={config as AssistantConfig} app={app} />],
]);

export function PackagePage() {
  const { app = "", item = "" } = useParams();
  const { items, loaded, fetching, error } = usePackageMenu();
  // Chờ menu tải xong mới kết luận không có trang: mở thẳng đường dẫn của một mục (từ dấu trang hay tin nhắn) thì
  // lúc đầu menu còn rỗng.
  if (!loaded && fetching) {
    return (
      <Center p="xl">
        <Loader aria-label="Đang tải" />
      </Center>
    );
  }
  if (error) {
    return (
      <Alert color="red" title="Không đọc được menu của đơn vị">
        {error.message}. Tải lại trang; nếu vẫn lỗi, báo người quản trị.
      </Alert>
    );
  }
  const entry = findItem(items, app, item);
  // Gói đã gỡ, mục dành cho vai trò khác, hay đường dẫn gõ sai đều không có mục; không nói rõ lý do để không lộ menu
  // của người khác.
  if (!entry) return <NotFound />;
  const render = COMPONENTS.get(entry.component);
  if (!render) {
    return (
      <Alert color="yellow" title="Chưa mở được mục này">
        Giao diện chưa có thành phần "{entry.component}" mà mục này cần.
      </Alert>
    );
  }
  const basePath = itemPath(entry);
  // key theo mục: chuyển sang mục khác thì thành phần bắt đầu lại, không giữ trạng thái của mục cũ.
  return <Fragment key={basePath}>{render(entry.config, basePath, entry.app)}</Fragment>;
}
