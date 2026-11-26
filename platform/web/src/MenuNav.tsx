// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Phần menu của thanh bên: mỗi nhóm (menuGroups trong menu.ts) có tên nhóm rồi các liên kết kèm biểu tượng. Nhóm phụ
// (mục mẫu của lõi) thu gọn sau một nút mở; nhóm đang chứa trang hiện tại thì mở sẵn. Không có chữ của lĩnh vực nào:
// tên nhóm và nhãn đến từ dữ liệu.

import { Box, Collapse, NavLink, Text, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronRight } from "@tabler/icons-react";
import { useId } from "react";
import { Link } from "react-router";
import { isActive, type MenuGroup } from "./menu";
import { MenuIconShape } from "./menuIcons";

type Props = { groups: MenuGroup[]; pathname: string; onNavigate: () => void };

export function MenuNav({ groups, pathname, onNavigate }: Props) {
  return groups.map((group) => (
    <MenuSection key={group.id} group={group} pathname={pathname} onNavigate={onNavigate} />
  ));
}

function MenuSection({ group, pathname, onNavigate }: { group: MenuGroup } & Omit<Props, "groups">) {
  const headingId = useId();
  const listId = useId();
  const current = group.links.some((link) => isActive(pathname, link.to));
  const [opened, { toggle }] = useDisclosure(!group.collapsible || current);
  const links = group.links.map((link) => (
    <NavLink
      key={link.to}
      component={Link}
      to={link.to}
      label={link.label}
      leftSection={<MenuIconShape icon={link.icon} />}
      active={isActive(pathname, link.to)}
      onClick={onNavigate}
    />
  ));
  const heading = (
    <Text component="span" size="xs" fw={700} tt="uppercase" c="gray.7" id={headingId}>
      {group.label}
    </Text>
  );
  return (
    <Box role="group" aria-labelledby={headingId} mt="sm">
      {group.collapsible ? (
        <UnstyledButton
          onClick={toggle}
          aria-expanded={opened}
          aria-controls={listId}
          px="sm"
          py={6}
          w="100%"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <IconChevronRight
            size={14}
            aria-hidden="true"
            style={{ transform: opened ? "rotate(90deg)" : undefined, transition: "transform 150ms" }}
          />
          {heading}
        </UnstyledButton>
      ) : (
        <Box px="sm" py={6}>
          {heading}
        </Box>
      )}
      {/* display-none chứ không gỡ khỏi trang: liên kết thu gọn không nhận Tab và trình đọc màn hình bỏ qua, nhưng
          vẫn còn trong DOM để bài kiểm thử tìm được nhóm chứa nó. */}
      <Collapse id={listId} expanded={opened} keepMounted keepMountedMode="display-none">
        {links}
      </Collapse>
    </Box>
  );
}
