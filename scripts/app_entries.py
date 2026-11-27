# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Mọi mục của một gói mở một thành phần Tầng 2: mục `menu` và khối `blocks` của app.yaml (ADR 0061). Khối có
# cùng dạng và nạp vào cùng bảng platform.menu_items như mục menu, nên mọi bước kiểm cấu hình thành phần
# (scripts/check-*.py, scripts/contracts.sh) và bộ cài (scripts/app-deploy.py) đọc qua đây: bước nào chỉ đọc
# `menu` sẽ để cấu hình của khối vào CSDL mà chưa ai kiểm.


def entries(app: dict) -> list[dict]:
    """Mục menu rồi tới khối, theo thứ tự khai; vị trí trong danh sách này là cột position của menu_items."""
    return [*app.get("menu", []), *app.get("blocks", [])]
