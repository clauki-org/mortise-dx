// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Trang của một mục menu do gói khai (/apps/<gói>/<mục>/...): tìm mục trong menu của tenant, rồi vẽ thành phần Tầng 2
// mà mục chỉ định với cấu hình của gói. Gói không có mã giao diện riêng: thêm một gói chỉ thêm dòng menu, không thêm
// trang. Menu đọc qua usePackageMenu, dùng chung với Shell nên urql chỉ gửi một truy vấn.

import { Alert } from "@mantine/core";
import { Fragment, type ReactNode, useEffect, useMemo } from "react";
import { useParams } from "react-router";
import { useQuery } from "urql";
import { Assistant } from "./Assistant";
import { AssistantData } from "./AssistantData";
import { PACKAGE_STATE_TYPENAME } from "./apps";
import { type AssistantConfig, isDataConfig } from "./assistant";
import { Cases } from "./CasesPanel";
import { Catalog } from "./Catalog";
import type { CasesConfig } from "./cases";
import type { CatalogConfig } from "./catalog";
import { applyOverrides } from "./configEffective";
import type { ItemOverride } from "./configOverrides";
import { DashboardPanel } from "./DashboardPanel";
import type { DashboardConfig } from "./dashboardConfig";
import { NotFound } from "./Errors";
import { FormPanel } from "./FormPanel";
import type { FormConfig } from "./formConfig";
import { MapPanel } from "./MapPanel";
import type { MapConfig } from "./mapConfig";
import { findItem, itemPath, MENU_QUERY, type MenuData, OVERRIDES_QUERY, rolesOf, visibleItems } from "./menu";
import { Page } from "./Page";
import type { PageConfig } from "./page";
import { ErrorNotice, Loading } from "./States";
import { useSession } from "./session";

// Mutation trên bảng phần chỉnh trả kiểu khác kiểu của view; khai ở đây để urql đọc lại phần chỉnh sau mỗi lần ghi
// hay xóa (chế độ Chỉnh sửa), không phải tải lại trang.
const OVERRIDES_CONTEXT = {
  additionalTypenames: ["platform_config_overrides", "platform_config_overrides_mutation_response"],
};

// Bật, tắt gói ở trang "Ứng dụng" (ADR 0065) đổi mục menu Hasura trả; khai kiểu của mutation đó để menu, trang chủ
// đọc lại ngay sau khi ghi.
const MENU_CONTEXT = { additionalTypenames: [PACKAGE_STATE_TYPENAME] };

const warn = (message: string) => console.warn(message);

type OverridesData = { platform_config_overrides_by_tenant: ItemOverride[] };

/**
 * Menu của gói mà người dùng thấy, đã lọc theo vai trò trong token và áp phần chỉnh của org (ADR 0060). `baseItems`
 * là menu theo cấu hình gốc của gói, `overrides` là phần chỉnh đọc được: chế độ Chỉnh sửa cần cả hai để hiện lại mục
 * đã ẩn và "Về mặc định". Không đọc được phần chỉnh thì dùng cấu hình gốc.
 */
export function usePackageMenu() {
  const { getToken } = useSession();
  const [{ data, fetching, error }] = useQuery<MenuData>({ query: MENU_QUERY, context: MENU_CONTEXT });
  const [overridden] = useQuery<OverridesData>({ query: OVERRIDES_QUERY, context: OVERRIDES_CONTEXT });
  const baseItems = useMemo(() => visibleItems(data?.platform_menu_items ?? [], rolesOf(getToken())), [data, getToken]);
  const overrides = useMemo(() => overridden.data?.platform_config_overrides_by_tenant ?? [], [overridden.data]);
  useEffect(() => {
    if (overridden.error) warn(`Không đọc được phần chỉnh cấu hình, dùng cấu hình gốc: ${overridden.error.message}`);
  }, [overridden.error]);
  const items = useMemo(() => applyOverrides(baseItems, overrides, warn), [baseItems, overrides]);
  // Chờ cả phần chỉnh để menu không hiện nhãn gốc rồi đổi ngay sau đó.
  const settled = overridden.data !== undefined || overridden.error !== undefined;
  return {
    items,
    baseItems,
    overrides,
    loaded: data !== undefined && settled,
    fetching: fetching || overridden.fetching,
    error,
  };
}

// `app` là gói của mục: thành phần cần nó khi dữ liệu nó đọc thuộc về gói (văn bản của trợ lý) hay khi trỏ tới mục
// menu khác của cùng gói (biểu mẫu, bảng điều hành). `item` là mục: trợ lý hỏi dữ liệu gửi kèm để dịch vụ tự đọc
// danh sách bảng được phép của mục, không nhận danh sách đó từ trình duyệt.
type Render = (config: unknown, basePath: string, app: string, item: string) => ReactNode;

// Tên thành phần là dữ liệu đọc từ CSDL nên tra bằng Map: tra trên đối tượng thường thì tên như "constructor" hay
// "toString" sẽ khớp với thuộc tính có sẵn của mọi đối tượng. Thành phần mới thêm một dòng ở đây; tên hợp lệ do
// contracts/app.schema.json liệt kê. Khối trên trang (Block.tsx) vẽ qua cùng bảng này.
export const COMPONENTS = new Map<string, Render>([
  [
    "catalog",
    (config, basePath, app, item) => (
      <Catalog config={config as CatalogConfig} basePath={basePath} app={app} item={item} />
    ),
  ],
  ["map", (config, _basePath, app) => <MapPanel config={config as MapConfig} app={app} />],
  ["form", (config, _basePath, app) => <FormPanel config={config as FormConfig} app={app} />],
  ["cases", (config, basePath) => <Cases config={config as CasesConfig} basePath={basePath} />],
  ["dashboard", (config, _basePath, app) => <DashboardPanel config={config as DashboardConfig} app={app} />],
  [
    "assistant",
    (config, _basePath, app, item) =>
      isDataConfig(config) ? (
        <AssistantData config={config} app={app} item={item} />
      ) : (
        <Assistant config={config as AssistantConfig} app={app} />
      ),
  ],
  ["page", (config, _basePath, app) => <Page config={config as PageConfig} app={app} />],
]);

export function PackagePage() {
  const { app = "", item = "" } = useParams();
  const { items, loaded, fetching, error } = usePackageMenu();
  // Chờ menu tải xong mới kết luận không có trang: mở thẳng đường dẫn của một mục (từ dấu trang hay tin nhắn) thì
  // lúc đầu menu còn rỗng.
  if (!loaded && fetching) return <Loading />;
  if (error) return <ErrorNotice title="Không đọc được menu của đơn vị" error={error} />;
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
  return <Fragment key={basePath}>{render(entry.config, basePath, entry.app, entry.item)}</Fragment>;
}
