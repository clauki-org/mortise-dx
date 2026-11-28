// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Các nhóm nút của chế độ Chỉnh sửa (ADR 0070): chính mục trên menu, khối của trang, cột và trường của danh mục, biểu
// mẫu, khối và thẻ số của bảng điều hành. Mỗi nút chỉ thêm thay đổi vào bản nháp (editDraft.ts); lưu, hoàn tác ở
// EditMode.tsx. Danh sách dựng ở editModel.ts. Mỗi nhóm là một fieldset có legend, mỗi ô và nút có tên đọc được gồm
// tên phần tử, vì trình đọc màn hình đọc nút "Lên" đứng một mình thì không biết lên cái gì.

import { ActionIcon, Button, Checkbox, Group, NativeSelect, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { CustomFieldsEditor } from "./CustomFieldsDialog";
import type { CatalogConfig } from "./catalog";
import { ITEM_TARGET, type ItemOverride, type OverrideKind } from "./configOverrides";
import { catalogTables } from "./customFieldsAdmin";
import { type Change, menuMoveChanges, moveChanges } from "./editDraft";
import {
  blockCandidates,
  blockRows,
  type CardRow,
  fieldRows,
  itemModel,
  menuSiblings,
  OPERATOR_TEXT,
  panelRows,
  thresholdValue,
  variantLabel,
} from "./editModel";
import type { MenuItem } from "./menu";

export type SectionProps = {
  entry: MenuItem;
  /** Phần chỉnh của riêng mục sau bản nháp. */
  own: ItemOverride[];
  /** Phần chỉnh của mọi mục sau bản nháp (thứ tự trên menu cần cả mục khác). */
  overrides: ItemOverride[];
  /** Menu theo cấu hình gốc của gói. */
  items: MenuItem[];
  add: (changes: Change[]) => void;
};

const set = (entry: MenuItem, kind: OverrideKind, target: string, value: unknown, note: string): Change => ({
  type: "set",
  app: entry.app,
  item: entry.item,
  kind,
  target,
  value,
  note,
});
const unset = (entry: MenuItem, kind: OverrideKind, target: string, note: string): Change => ({
  type: "unset",
  app: entry.app,
  item: entry.item,
  kind,
  target,
  note,
});

/** Đổi nhãn: về đúng nhãn của gói thì xóa phần chỉnh thay vì ghi lại nhãn đó. */
function labelChange(entry: MenuItem, target: string, base: string, value: string, what: string): Change[] {
  const text = value.trim();
  if (text === "") return [];
  if (text === base) return [unset(entry, "label", target, `Nhãn của ${what} về như gói đặt`)];
  return [set(entry, "label", target, text, `Đổi nhãn ${what} thành "${text}"`)];
}

/** Ẩn, hiện: ẩn ghi true, hiện lại xóa phần chỉnh (mặc định của gói là hiện). */
const hiddenChange = (entry: MenuItem, target: string, hidden: boolean, what: string): Change[] =>
  hidden ? [set(entry, "hidden", target, true, `Ẩn ${what}`)] : [unset(entry, "hidden", target, `Hiện lại ${what}`)];

/** Cột gói đặt trong danh sách của danh mục. */
function baseListColumns(config: unknown): string[] {
  const listConfig = (config as { list?: { columns?: unknown } } | null)?.list;
  return Array.isArray(listConfig?.columns) ? listConfig.columns.map(String) : [];
}

/** Ô nhãn: ghi vào bản nháp khi rời ô hay bấm Enter, không ghi theo từng phím. */
function LabelInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  // Hoàn tác đổi nhãn trong bản nháp thì ô hiện lại nhãn đó.
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <TextInput
      label={label}
      value={text}
      maxLength={200}
      onChange={(event) => setText(event.currentTarget.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(event) => event.key === "Enter" && text !== value && onCommit(text)}
    />
  );
}

/** Ô số của ngưỡng: giữ chữ đang gõ, ghi vào bản nháp khi rời ô; chữ không phải số thì không ghi. */
function ThresholdInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | number>(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  const commit = () => {
    const bound = typeof text === "number" ? text : Number(text.replace(",", "."));
    if (text !== "" && Number.isFinite(bound) && bound !== value) onCommit(bound);
  };
  return <NumberInput label={label} value={text} onChange={setText} onBlur={commit} />;
}

function MoveButtons({
  name,
  index,
  count,
  onMove,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (step: -1 | 1) => void;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      <ActionIcon variant="default" aria-label={`Đưa ${name} lên`} disabled={index === 0} onClick={() => onMove(-1)}>
        <IconArrowUp size={16} aria-hidden />
      </ActionIcon>
      <ActionIcon
        variant="default"
        aria-label={`Đưa ${name} xuống`}
        disabled={index >= count - 1}
        onClick={() => onMove(1)}
      >
        <IconArrowDown size={16} aria-hidden />
      </ActionIcon>
    </Group>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid var(--mantine-color-gray-4)", borderRadius: 8, padding: 12, margin: 0 }}>
      <legend style={{ fontWeight: 700, padding: "0 4px" }}>{legend}</legend>
      <Stack gap="sm">{children}</Stack>
    </fieldset>
  );
}

/** Chính mục: tên trên menu, ẩn khỏi menu, thứ tự trên menu, kiểu khi cấu hình gốc khai kiểu. */
export function ItemSection({ entry, own, overrides, items, add }: SectionProps) {
  const model = itemModel(entry, own);
  const siblings = menuSiblings(items, overrides, entry.app);
  const index = siblings.findIndex((row) => row.target === entry.item);
  // Thứ tự trên menu là phần chỉnh của từng mục anh em, mỗi mục một dòng có target rỗng.
  const move = (step: -1 | 1) => add(menuMoveChanges(entry.app, siblings, index, step));
  return (
    <Fieldset legend="Mục trên menu">
      <LabelInput
        label="Tên trên menu"
        value={model.label}
        onCommit={(value) => add(labelChange(entry, ITEM_TARGET, entry.label, value, "mục"))}
      />
      <Group gap="md">
        <Checkbox
          label="Ẩn khỏi menu và trang chủ"
          checked={model.hidden}
          onChange={(event) => add(hiddenChange(entry, ITEM_TARGET, event.currentTarget.checked, "mục khỏi menu"))}
        />
        {index >= 0 && <MoveButtons name="mục trên menu" index={index} count={siblings.length} onMove={move} />}
      </Group>
      {model.variant !== undefined && model.variants.length > 1 && (
        <NativeSelect
          label="Kiểu hiển thị mặc định"
          value={model.variant}
          data={model.variants.map((value) => ({ value, label: variantLabel(value) }))}
          onChange={(event) => {
            const value = event.currentTarget.value;
            add([set(entry, "variant", ITEM_TARGET, value, `Kiểu hiển thị: ${variantLabel(value)}`)]);
          }}
        />
      )}
    </Fieldset>
  );
}

/** Khối của trang: kiểu, lên, xuống, ẩn, gỡ từng khối; thêm khối từ mục của cùng gói. */
export function BlocksSection({ entry, own, items, add }: SectionProps) {
  const rows = blockRows(entry, own, items);
  const candidates = blockCandidates(entry, own, items, rows);
  const [chosen, setChosen] = useState("");
  const visible = rows.filter((row) => !row.hidden).length;
  const place = { app: entry.app, item: entry.item };
  const addBlock = () => {
    const candidate = candidates.find((row) => row.target === chosen);
    if (!candidate) return;
    const note = `Thêm khối "${candidate.label}"`;
    add(
      candidate.removed
        ? [unset(entry, "block", candidate.target, note)]
        : [set(entry, "block", candidate.target, true, note)],
    );
    setChosen("");
  };
  return (
    <Fieldset legend="Khối trên trang">
      {rows.map((row, index) => {
        const name = `khối "${row.label}"`;
        // Trang cần ít nhất một khối đang hiện; gỡ, ẩn khối cuối cùng thì trang báo cấu hình sai.
        const last = !row.hidden && visible <= 1;
        const remove = () =>
          add(
            row.added
              ? (["block", "variant", "order", "hidden"] as const).map((kind) =>
                  unset(entry, kind, row.target, `Gỡ ${name}`),
                )
              : [set(entry, "block", row.target, false, `Gỡ ${name}`)],
          );
        return (
          <Group key={row.target} gap="sm" align="flex-end" wrap="wrap">
            <Text fw={600} miw={160}>
              {row.label}
              {row.hidden ? " (đang ẩn)" : ""}
            </Text>
            {row.variant !== undefined && row.variants.length > 1 && (
              <NativeSelect
                label={`Kiểu của ${name}`}
                value={row.variant}
                data={row.variants.map((value) => ({ value, label: variantLabel(value) }))}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  const note = `Kiểu của ${name}: ${variantLabel(value)}`;
                  add([
                    value === row.baseVariant
                      ? unset(entry, "variant", row.target, note)
                      : set(entry, "variant", row.target, value, note),
                  ]);
                }}
              />
            )}
            <MoveButtons
              name={name}
              index={index}
              count={rows.length}
              onMove={(step) => add(moveChanges(place, rows, index, step))}
            />
            <Checkbox
              label={`Ẩn ${name}`}
              checked={row.hidden}
              disabled={last}
              onChange={(event) => add(hiddenChange(entry, row.target, event.currentTarget.checked, name))}
            />
            <Button variant="default" size="xs" disabled={last} onClick={remove}>
              Gỡ {name}
            </Button>
          </Group>
        );
      })}
      {candidates.length > 0 && (
        <Group gap="sm" align="flex-end">
          <NativeSelect
            label="Khối thêm vào trang"
            value={chosen}
            data={[
              { value: "", label: "Chọn một mục của gói" },
              ...candidates.map((row) => ({ value: row.target, label: row.label })),
            ]}
            onChange={(event) => setChosen(event.currentTarget.value)}
          />
          <Button variant="default" disabled={chosen === ""} onClick={addBlock}>
            Thêm khối
          </Button>
        </Group>
      )}
    </Fieldset>
  );
}

/** Cột của danh sách (danh mục) hay trường (biểu mẫu): nhãn, ẩn, hiện, thứ tự. */
export function FieldsSection({ entry, own, add }: SectionProps) {
  const rows = fieldRows(entry, own);
  const catalog = entry.component === "catalog";
  const movable = rows.filter((row) => row.canMove);
  const place = { app: entry.app, item: entry.item };
  const baseColumns = baseListColumns(entry.config);
  return (
    <Fieldset legend={catalog ? "Cột và trường của danh mục" : "Trường của biểu mẫu"}>
      {rows.map((row) => {
        const name = `${catalog ? "cột" : "trường"} "${row.baseLabel}"`;
        const index = movable.findIndex((other) => other.target === row.target);
        // Danh mục: cột gói đặt trong danh sách mặc định là hiện, cột khác mặc định là ẩn; về đúng mặc định thì xóa
        // phần chỉnh, khác mặc định thì ghi true (ẩn) hay false (hiện thêm cột).
        const toggle = (hidden: boolean) => {
          if (!catalog) return add(hiddenChange(entry, row.target, hidden, name));
          const note = hidden ? `Ẩn ${name} khỏi danh sách` : `Hiện ${name} trong danh sách`;
          if (hidden === !baseColumns.includes(row.target)) return add([unset(entry, "hidden", row.target, note)]);
          return add([set(entry, "hidden", row.target, hidden, note)]);
        };
        return (
          <Group key={row.target} gap="sm" align="flex-end" wrap="wrap">
            <LabelInput
              label={`Nhãn của ${name}`}
              value={row.label}
              onCommit={(value) => add(labelChange(entry, row.target, row.baseLabel, value, name))}
            />
            {row.canHide && (
              <Checkbox
                label={catalog ? `Hiện ${name} trong danh sách` : `Ẩn ${name}`}
                checked={catalog ? !row.hidden : row.hidden}
                onChange={(event) => toggle(catalog ? !event.currentTarget.checked : event.currentTarget.checked)}
              />
            )}
            {catalog && !row.canHide && !row.canMove && (
              <Text size="sm" c="gray.7">
                Trường qua quan hệ: chỉ đổi được nhãn.
              </Text>
            )}
            {row.canMove && index >= 0 && (
              <MoveButtons
                name={name}
                index={index}
                count={movable.length}
                onMove={(step) =>
                  add(
                    moveChanges(
                      place,
                      movable.map((r) => ({ target: r.target, label: r.label })),
                      index,
                      step,
                    ),
                  )
                }
              />
            )}
          </Group>
        );
      })}
    </Fieldset>
  );
}

function CardControls({ entry, card, add }: { entry: MenuItem; card: CardRow; add: SectionProps["add"] }) {
  const name = `thẻ "${card.baseLabel}"`;
  return (
    <Stack gap="xs" pl="md">
      <LabelInput
        label={`Nhãn của ${name}`}
        value={card.label}
        onCommit={(value) => add(labelChange(entry, card.target, card.baseLabel, value, name))}
      />
      {card.levels.map((level) => (
        <ThresholdInput
          key={level.key}
          label={`Ngưỡng "${level.label}" của ${name}: ${OPERATOR_TEXT[level.operator]}`}
          value={level.bound}
          onCommit={(bound) => {
            const levels = card.levels.map((other) => (other.key === level.key ? { ...other, bound } : other));
            add([
              set(
                entry,
                "threshold",
                card.target,
                thresholdValue(levels),
                `Ngưỡng "${level.label}" của ${name}: ${bound}`,
              ),
            ]);
          }}
        />
      ))}
    </Stack>
  );
}

/** Khối của bảng điều hành (nhãn, ẩn, thứ tự) và thẻ số của từng khối (nhãn, ngưỡng). */
export function DashboardSection({ entry, own, add }: SectionProps) {
  const rows = panelRows(entry, own);
  const visible = rows.filter((row) => !row.hidden).length;
  const place = { app: entry.app, item: entry.item };
  return (
    <Fieldset legend="Khối và thẻ số của bảng điều hành">
      {rows.map((row, index) => {
        const name = `khối "${row.baseLabel}"`;
        return (
          <Stack key={row.target} gap="xs">
            <Group gap="sm" align="flex-end" wrap="wrap">
              <LabelInput
                label={`Tiêu đề của ${name}`}
                value={row.label}
                onCommit={(value) => add(labelChange(entry, row.target, row.baseLabel, value, name))}
              />
              <Checkbox
                label={`Ẩn ${name}`}
                checked={row.hidden}
                disabled={!row.hidden && visible <= 1}
                onChange={(event) => add(hiddenChange(entry, row.target, event.currentTarget.checked, name))}
              />
              <MoveButtons
                name={name}
                index={index}
                count={rows.length}
                onMove={(step) => add(moveChanges(place, rows, index, step))}
              />
            </Group>
            {row.cards.map((card) => (
              <CardControls key={card.target} entry={entry} card={card} add={add} />
            ))}
          </Stack>
        );
      })}
    </Fieldset>
  );
}

/**
 * Trường tùy chỉnh của các bảng trong danh mục (ADR 0059). Định nghĩa là dòng của platform.custom_fields chứ không
 * phải phần ghi đè cấu hình, nên mỗi lần thêm, sửa, xóa ghi ngay; đưa vào bản nháp thì "Hoàn tác" phải xóa dòng đã có
 * giá trị trong dữ liệu.
 */
export function CustomFieldsSection({ entry }: { entry: MenuItem }) {
  return (
    <Fieldset legend="Trường tùy chỉnh">
      <Text size="sm" c="dimmed">
        Thêm, sửa, xóa trường ở đây được lưu ngay, không qua nút "Lưu" và "Hoàn tác" ở trên.
      </Text>
      <CustomFieldsEditor app={entry.app} tables={catalogTables(entry.config as CatalogConfig)} />
    </Fieldset>
  );
}
