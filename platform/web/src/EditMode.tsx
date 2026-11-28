// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Chế độ "Chỉnh sửa" trên trang của một mục (ADR 0070): chỉ quản trị org thấy nút bật (useOrgAdmin, như trang "Ứng
// dụng"). Bật lên thì có bảng nút theo thành phần của mục (EditSections.tsx); mỗi thao tác vào bản nháp, hoàn tác được
// từng bước trước khi lưu. "Lưu" ghi lần lượt từng thay đổi vào platform.config_overrides (ADR 0060); thay đổi bị CSDL
// từ chối ở lại bản nháp kèm lý do, thay đổi đã ghi rời bản nháp. Truy vấn phần chỉnh của usePackageMenu đọc lại sau
// mỗi lần ghi, nên trang vẽ lại theo cấu hình đã trộn mà không phải tải lại.

import { Alert, Button, Group, List, Paper, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useClient } from "urql";
import { useOrgAdmin } from "./AppsPage";
import { refusalText } from "./apps";
import { checkedConfig } from "./configEffective";
import type { ItemOverride } from "./configOverrides";
import {
  BlocksSection,
  CustomFieldsSection,
  DashboardSection,
  FieldsSection,
  ItemSection,
  type SectionProps,
} from "./EditSections";
import { addChanges, type Change, changeKey, draftOverrides, EDIT_CONTEXT, mutationOf, saveOrder } from "./editDraft";
import { ownOverrides } from "./editModel";
import { findItem, type MenuItem } from "./menu";
import { usePackageMenu } from "./PackagePage";

type Draft = { changes: Change[]; history: Change[][] };
const EMPTY: Draft = { changes: [], history: [] };

/** Nhóm nút theo thành phần của mục; thành phần chưa có đích nào ngoài chính mục thì chỉ có nhóm của mục. */
function Sections(props: SectionProps) {
  const { component, config } = props.entry;
  const hasBlocks = Array.isArray((config as { blocks?: unknown } | null)?.blocks);
  return (
    <>
      <ItemSection {...props} />
      {hasBlocks && <BlocksSection {...props} />}
      {(component === "catalog" || component === "form") && <FieldsSection {...props} />}
      {component === "dashboard" && <DashboardSection {...props} />}
      {component === "catalog" && <CustomFieldsSection entry={props.entry} />}
    </>
  );
}

type PanelProps = {
  entry: MenuItem;
  items: MenuItem[];
  saved: ItemOverride[];
  draft: Draft;
  setDraft: (draft: Draft) => void;
  refusals: Map<string, string>;
  busy: boolean;
  notice: string;
  onSave: () => void;
};

/** Bảng của chế độ Chỉnh sửa; tách khỏi phần gọi mạng để kiểm thử bằng dựng tĩnh. */
export function EditPanel({ entry, items, saved, draft, setDraft, refusals, busy, notice, onSave }: PanelProps) {
  const overrides = draftOverrides(saved, draft.changes);
  const own = ownOverrides(overrides, entry);
  const add = (changes: Change[]) => {
    const next = addChanges(saved, draft.changes, changes);
    if (JSON.stringify(next) !== JSON.stringify(draft.changes))
      setDraft({ changes: next, history: [...draft.history, draft.changes] });
  };
  const undo = () => {
    const previous = draft.history.at(-1);
    if (previous) setDraft({ changes: previous, history: draft.history.slice(0, -1) });
  };
  const hasOwn =
    ownOverrides(saved, entry).length > 0 || draft.changes.some((c) => c.app === entry.app && c.item === entry.item);
  const reset = () =>
    add([
      { type: "reset", app: entry.app, item: entry.item, note: `Về mặc định: bỏ mọi phần chỉnh của "${entry.label}"` },
    ]);
  // Kiểm như lúc trang đọc: phần chỉnh qua được CSDL mà làm cấu hình hỏng thì sau khi lưu trang âm thầm dùng bản gốc.
  const forConfig = own.filter((row) => row.target !== "" || row.kind === "variant");
  const { problems } = checkedConfig(entry.component, entry.config, forConfig);
  return (
    <Paper component="section" aria-label="Chỉnh sửa trang" withBorder radius="md" p="md" mb="md">
      <Stack gap="md">
        <Text size="sm">
          Phần chỉnh áp cho mọi đơn vị trong org. Mỗi thay đổi vào danh sách chờ lưu; "Hoàn tác" bỏ thay đổi sau cùng.
        </Text>
        {/* Khóa mọi nút trong lúc lưu: thay đổi thêm giữa chừng không có trong danh sách đang ghi và sẽ mất. */}
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Stack gap="md">
            <Sections entry={entry} own={own} overrides={overrides} items={items} add={add} />
          </Stack>
        </fieldset>
        {/* Chỉ lỗi của hàm kiểm: phần chỉnh bị bỏ qua (thứ tự của phần tử đang ẩn chẳng hạn) không làm trang về bản gốc. */}
        {problems.length > 0 && (
          <Alert color="yellow" title="Các thay đổi này chưa dùng được">
            {problems.join("; ")}. Lưu thì trang vẫn hiện theo cấu hình của gói cho tới khi sửa lại.
          </Alert>
        )}
        <Stack gap={4}>
          <Text fw={700}>
            {draft.changes.length === 0 ? "Chưa có thay đổi chờ lưu." : `${draft.changes.length} thay đổi chờ lưu:`}
          </Text>
          {draft.changes.length > 0 && (
            <List size="sm">
              {draft.changes.map((change) => {
                const refusal = refusals.get(changeKey(change));
                return (
                  <List.Item key={changeKey(change)}>
                    {change.note}
                    {refusal && (
                      <Text component="span" c="red.8" size="sm">
                        {" "}
                        (bị từ chối: {refusal})
                      </Text>
                    )}
                  </List.Item>
                );
              })}
            </List>
          )}
        </Stack>
        <Group gap="sm">
          <Button onClick={onSave} loading={busy} disabled={draft.changes.length === 0}>
            Lưu
          </Button>
          <Button variant="default" onClick={undo} disabled={busy || draft.history.length === 0}>
            Hoàn tác
          </Button>
          <Button variant="default" onClick={reset} disabled={busy || !hasOwn}>
            Về mặc định
          </Button>
        </Group>
        <Text role="status" size="sm">
          {notice}
        </Text>
      </Stack>
    </Paper>
  );
}

/** Nút "Chỉnh sửa" và bảng của nó cho mục `app`/`item`; người không phải quản trị org không thấy gì. */
export function EditMode({ app, item }: { app: string; item: string }) {
  const orgAdmin = useOrgAdmin();
  const { baseItems, overrides } = usePackageMenu();
  const client = useClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [refusals, setRefusals] = useState(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const entry = findItem(baseItems, app, item);
  if (orgAdmin !== true || !entry) return null;

  const save = async () => {
    setBusy(true);
    // Xóa lời báo của lần lưu trước để vùng trạng thái chỉ báo khi lần này xong.
    setNotice("");
    const failed = new Map<string, string>();
    const left: Change[] = [];
    // Từng thay đổi một, không gộp: một thay đổi bị từ chối không kéo theo thay đổi khác, và lý do gắn đúng dòng.
    for (const change of saveOrder(draft.changes)) {
      const { query, variables } = mutationOf(change);
      const result = await client.mutation(query, variables, EDIT_CONTEXT).toPromise();
      if (result.error) {
        failed.set(changeKey(change), refusalText(result.error) ?? "Không gửi được yêu cầu; thử lại sau ít phút.");
        left.push(change);
      }
    }
    const done = draft.changes.length - left.length;
    // Thay đổi đã ghi không hoàn tác được nữa: bản nháp còn lại bắt đầu lịch sử mới.
    setDraft({ changes: draft.changes.filter((change) => left.includes(change)), history: [] });
    setRefusals(failed);
    setNotice(left.length === 0 ? `Đã lưu ${done} thay đổi.` : `Đã lưu ${done} thay đổi, ${left.length} bị từ chối.`);
    setBusy(false);
  };

  const toggle = () => {
    // Thoát thì bỏ bản nháp: bản nháp không áp lên trang, giữ lại dễ quên rồi lưu nhầm về sau.
    setEditing(!editing);
    setDraft(EMPTY);
    setRefusals(new Map());
    setNotice("");
  };

  return (
    <>
      <Group justify="flex-end" mb="sm">
        <Button variant={editing ? "filled" : "default"} aria-pressed={editing} onClick={toggle}>
          {editing && draft.changes.length > 0 ? "Bỏ thay đổi và thoát chỉnh sửa" : "Chỉnh sửa"}
        </Button>
      </Group>
      {editing && (
        <EditPanel
          entry={entry}
          items={baseItems}
          saved={overrides}
          draft={draft}
          setDraft={setDraft}
          refusals={refusals}
          busy={busy}
          notice={notice}
          onSave={save}
        />
      )}
    </>
  );
}
