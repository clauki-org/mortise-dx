// SPDX-FileCopyrightText: 2026 Mortise DX contributors
// SPDX-License-Identifier: Apache-2.0
//
// Hình cho từng ý nghĩa biểu tượng của mục menu (`icon` trong app.yaml, ADR 0044), lấy từ @tabler/icons-react.
// Nhập tĩnh từng hình: tra hình theo tên lúc chạy thì bản build phải chứa cả bộ vài nghìn hình, và gói khai được tên
// hình bất kỳ ngoài danh mục đã thống nhất.

import {
  IconChartBar,
  IconFileText,
  IconFolder,
  IconForms,
  IconHome,
  IconInbox,
  IconList,
  IconMap,
  IconMessageCircle,
  IconSettings,
  type TablerIcon,
} from "@tabler/icons-react";
import type { MenuIcon } from "./menu";

// Record theo MenuIcon: thêm ý nghĩa vào danh mục mà quên hình thì tsc báo, không để mục mất biểu tượng.
export const MENU_ICON_SHAPES: Record<MenuIcon, TablerIcon> = {
  home: IconHome,
  list: IconList,
  form: IconForms,
  map: IconMap,
  chart: IconChartBar,
  chat: IconMessageCircle,
  inbox: IconInbox,
  document: IconFileText,
  folder: IconFolder,
  settings: IconSettings,
};

/** Hình của mục menu, chỉ để nhìn nhanh: aria-hidden để tên của liên kết vẫn đúng là nhãn. */
export function MenuIconShape({ icon }: { icon: MenuIcon | null }) {
  const Shape = icon ? MENU_ICON_SHAPES[icon] : null;
  return Shape ? <Shape size={18} stroke={1.75} aria-hidden="true" /> : null;
}
