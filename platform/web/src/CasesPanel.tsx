// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Thành phần theo dõi hồ sơ (contracts/cases.schema.json, ADR 0032): danh sách hồ sơ người đăng nhập đã lập của các
// quy trình trong cấu hình, và màn hình một hồ sơ bên dưới địa chỉ của mục (CaseScreen.tsx). workflow-api chỉ trả hồ sơ
// của chính người gọi, nên ở đây không lọc theo người. Không có tên quy trình hay chữ của một lĩnh vực nào.

import { Alert, Anchor, Button, Group, SegmentedControl, Stack, Table, Text } from "@mantine/core";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { recordVariable, useBlock } from "./blockContext";
import { CaseScreen } from "./CaseScreen";
import {
  type CaseState,
  type CasesConfig,
  caseStatus,
  casesProblems,
  caseTitle,
  fetchCases,
  PAGE_SIZE,
  processSteps,
} from "./cases";
import { formatDateTime } from "./format";
import { PageHeader } from "./PageHeader";
import { Empty, ErrorNotice, Loading } from "./States";
import { StatusBadge } from "./StatusBadge";
import { useSession } from "./session";
import { useSteps } from "./steps";
import { TableScroll } from "./TableScroll";
import { DueBadge } from "./TaskList";

const STATES: { value: CaseState; label: string }[] = [
  { value: "open", label: "Đang xử lý" },
  { value: "ended", label: "Đã kết thúc" },
  { value: "all", label: "Tất cả" },
];

function CaseList({ config, basePath }: { config: CasesConfig; basePath: string }) {
  const { getToken } = useSession();
  const { steps } = useSteps();
  const [state, setState] = useState<CaseState>("open");
  const [page, setPage] = useState(1);
  // Trong chi tiết một dòng, chỉ hồ sơ có biến gói gắn bằng khóa của dòng đang xem (ADR 0068); workflow-api lọc, nên
  // tổng số và phân trang vẫn đúng.
  const variable = recordVariable(useBlock(), config.processes);
  const cases = useQuery({
    queryKey: ["cases", config.processes, state, page, variable?.name, variable?.value],
    queryFn: () => fetchCases(getToken(), config.processes, state, page, variable),
    placeholderData: keepPreviousData,
  });
  const now = Date.now();
  return (
    <Stack>
      <PageHeader
        title={config.title}
        description={config.description}
        action={
          <SegmentedControl
            data={STATES}
            value={state}
            onChange={(value) => {
              setState(value as CaseState);
              setPage(1);
            }}
            aria-label="Lọc hồ sơ theo trạng thái"
          />
        }
      />
      {cases.isPending && <Loading what="hồ sơ" />}
      {cases.isError && (
        <ErrorNotice title="Không tải được hồ sơ" error={cases.error} onRetry={() => cases.refetch()} />
      )}
      {cases.data?.items.length === 0 && <Empty title="Chưa có hồ sơ nào." />}
      {cases.data && cases.data.items.length > 0 && (
        <TableScroll label={config.title} minWidth={560}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Hồ sơ</Table.Th>
                <Table.Th>Bước hiện tại hay kết quả</Table.Th>
                <Table.Th>Hạn</Table.Th>
                <Table.Th>Lập lúc</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {cases.data.items.map((item) => {
                const due = item.current.map((step) => step.due).find((value) => value !== null) ?? null;
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td>
                      <Anchor component={Link} to={`${basePath}/${encodeURIComponent(item.id)}`}>
                        {caseTitle(item, processSteps(steps, item.process)) ?? `Hồ sơ ${item.id.slice(0, 8)}`}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      {item.ended === null ? (
                        caseStatus(item)
                      ) : (
                        <StatusBadge tone={item.outcome === null ? "neutral" : "ok"}>{caseStatus(item)}</StatusBadge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {item.ended === null && item.current.length > 0 && <DueBadge due={due} now={now} />}
                    </Table.Td>
                    <Table.Td>{formatDateTime(item.started)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </TableScroll>
      )}
      {cases.data && cases.data.total > PAGE_SIZE && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Hồ sơ {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, cases.data.total)} trên {cases.data.total}
          </Text>
          <Group gap="xs">
            <Button variant="default" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Trang trước
            </Button>
            <Button variant="default" disabled={page * PAGE_SIZE >= cases.data.total} onClick={() => setPage(page + 1)}>
              Trang sau
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}

export function Cases({ config, basePath }: { config: CasesConfig; basePath: string }) {
  const { pathname } = useLocation();
  const block = useBlock();
  const problems = casesProblems(config);
  if (problems.length > 0) {
    return (
      <Alert color="red" title="Cấu hình theo dõi hồ sơ sai">
        {problems.join("; ")}. Báo người quản trị sửa cấu hình của gói.
      </Alert>
    );
  }
  // Đọc địa chỉ thô như danh mục: router giải mã %2F trước khi trả tham số. Trong một khối của trang (ADR 0061), địa
  // chỉ là của trang nên chỉ có danh sách; hồ sơ vẫn mở dưới địa chỉ của mục.
  const segments = block ? [] : pathname.slice(basePath.length).split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length === 1) {
    return <CaseScreen key={segments[0]} id={segments[0] ?? ""} basePath={basePath} title={config.title} />;
  }
  if (segments.length === 0) return <CaseList config={config} basePath={basePath} />;
  return (
    <Stack>
      <PageHeader title={config.title} description={config.description} />
      <Alert color="yellow" title="Không có trang này">
        Đường dẫn không khớp với trang theo dõi hồ sơ.
      </Alert>
    </Stack>
  );
}
