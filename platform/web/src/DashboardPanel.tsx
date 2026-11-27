// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần bảng điều hành: các khối theo cấu hình của gói (contracts/dashboard.schema.json), mỗi khối đọc một nguồn
// bằng token của người xem, qua GraphQL ở đây hay qua REST ở DashboardRest.tsx (ADR 0035), rồi vẽ bằng
// DashboardView.tsx. Khối khai vai trò chỉ được truy vấn khi token có vai trò đó (ADR 0033). Các khối xếp theo lưới
// bốn cột trên màn hình rộng, hai cột trên màn hình vừa, đúng thứ tự khai; khối chính luôn là khối đầu (ADR 0049). Ở
// đây không có tên bảng hay chữ của một lĩnh vực nào.

import { Alert, Anchor, Grid, Loader, Paper, Stack, Text, Title } from "@mantine/core";
import { type ReactNode, useMemo } from "react";
import { Link } from "react-router";
import { type CombinedError, useQuery } from "urql";
import { RestBody } from "./DashboardRest";
import { CardsView, ChartView, MethodDetails } from "./DashboardView";
import { panelSpans } from "./dashboardBento";
import {
  type DashboardConfig,
  dashboardProblems,
  type GraphqlSource,
  limitOf,
  type Panel,
  panelQuery,
  panelRole,
  queryErrorText,
  type Row,
  visiblePanels,
} from "./dashboardConfig";
import { findItem, itemPath, rolesOf } from "./menu";
import { usePackageMenu } from "./PackagePage";
import { PageHeader } from "./PageHeader";
import { variantOf } from "./page";
import { ErrorNotice } from "./States";
import { useSession } from "./session";

type GraphqlPanel = Panel & { graphql: GraphqlSource };

/** Lỗi do cấu hình của gói (bảng, cột ngoài quyền) nói rõ cho người quản trị; lỗi khác dùng khung báo lỗi chung. */
function PanelError({ panel, error }: { panel: Panel; error: CombinedError }) {
  const title = `Không đọc được số liệu của khối "${panel.title}"`;
  const config = queryErrorText(
    panel,
    error.graphQLErrors.map((item) => String(item.extensions?.code ?? "")),
    error.graphQLErrors[0]?.message ?? error.message,
  );
  if (config === null) return <ErrorNotice title={title} error={error} />;
  return (
    <Alert color="red" title={title}>
      {config}
    </Alert>
  );
}

function GraphqlBody({ panel, link, columns }: { panel: GraphqlPanel; link: ReactNode; columns: number }) {
  const request = useMemo(() => panelQuery(panel), [panel]);
  const context = useMemo(() => ({ role: panelRole(panel) }), [panel]);
  // Truy vấn mang vai trò riêng; bộ nhớ đệm của urql không phân biệt vai trò nên luôn đọc lại từ máy chủ.
  const [{ data, fetching, error }] = useQuery<{ rows: Row[] }>({
    query: request.query,
    variables: request.variables,
    context,
    requestPolicy: "network-only",
  });
  const rows = data?.rows ?? [];
  const shown = panel.chart ? rows.slice(0, limitOf(panel)) : rows;
  return (
    <>
      {error && <PanelError panel={panel} error={error} />}
      {fetching && !data && <Loader size="sm" aria-label={`Đang tải ${panel.title}`} />}
      {data && panel.cards && (
        <CardsView cards={panel.cards} rows={shown} large={panel.primary} columns={columns} gauge={panel.gauge} />
      )}
      {data && panel.chart && <ChartView chart={panel.chart} rows={shown} title={panel.title} />}
      {panel.chart && rows.length > limitOf(panel) && (
        <Text size="sm">
          Nguồn có hơn {limitOf(panel)} dòng; chỉ hiện {limitOf(panel)} dòng đầu.
        </Text>
      )}
      {link}
      <MethodDetails panel={panel} request={request} />
    </>
  );
}

type SectionProps = { panel: Panel; app: string; columns: number; compact: boolean };

function PanelSection({ panel, app, columns, compact }: SectionProps) {
  const { items } = usePackageMenu();
  // Mục dành cho vai trò khác không có trong danh sách, nên không hiện đường dẫn tới trang không mở được.
  const target = panel.link ? findItem(items, app, panel.link.menu) : undefined;
  const link = panel.link && target && (
    <Anchor component={Link} to={itemPath(target)} size="sm">
      {panel.link.label}
    </Anchor>
  );
  return (
    <Paper withBorder radius="md" p="md" component="section" aria-label={panel.title} h="100%">
      <Stack gap="sm">
        <Title order={2} size={panel.primary ? "h3" : "h4"}>
          {panel.title}
        </Title>
        {/* Kiểu gọn (ADR 0061) bỏ lời mô tả, giữ con số và mục "Xem cách tính" để số vẫn giải thích được. */}
        {!compact && <Text size="sm">{panel.description}</Text>}
        {panel.graphql ? (
          <GraphqlBody panel={panel as GraphqlPanel} link={link} columns={columns} />
        ) : (
          <RestBody panel={panel} link={link} columns={columns} />
        )}
      </Stack>
    </Paper>
  );
}

export function DashboardPanel({ config, app }: { config: DashboardConfig; app: string }) {
  const { getToken } = useSession();
  // Token được làm mới vài phút một lần; so theo danh sách vai trò để các khối không bị coi là mới mỗi lần làm mới.
  const roles = rolesOf(getToken()).join(" ");
  const panels = useMemo(() => visiblePanels(config, roles.split(" ")), [config, roles]);
  // Bề rộng tính trên các khối người xem thấy, nên khối bị ẩn theo vai trò không để lại ô trống (dashboardBento.ts).
  const wide = useMemo(() => panelSpans(panels, 4), [panels]);
  const medium = useMemo(() => panelSpans(panels, 2), [panels]);
  const problems = dashboardProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình bảng điều hành sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  const compact = variantOf("dashboard", config.variant) === "compact";
  return (
    <Stack>
      <PageHeader title={config.title} />
      {config.description && !compact && <Text>{config.description}</Text>}
      {panels.length === 0 && <Text>Tài khoản đang đăng nhập không có vai trò của khối nào.</Text>}
      {/* Lưới 12 phần của Mantine: một cột của lưới bốn cột là 3 phần, của lưới hai cột là 6 phần. */}
      <Grid gap="md">
        {panels.map((panel, index) => (
          <Grid.Col key={panel.id} span={{ base: 12, md: 6 * (medium[index] ?? 2), lg: 3 * (wide[index] ?? 4) }}>
            <PanelSection
              panel={panel}
              app={app}
              columns={Math.min(wide[index] ?? 4, panel.cards?.length ?? 1)}
              compact={compact}
            />
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}
