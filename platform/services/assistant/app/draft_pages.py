# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Luật trang của bản nháp cấu hình gói (ADR 0071), chép luật của scripts/check-page-config.py (ADR 0061):
# khối có id gõ sai lặng lẽ biến khỏi trang, kiểu thiếu cấu hình lặng lẽ thành kiểu mặc định, nên bộ kiểm
# gói từ chối cả hai. draft_check.py gọi hàm này cho mỗi mục dùng thành phần page;
# tests/test_draft_check.py đối chiếu kết quả với chính script đó, nên sửa một bên thì kiểm thử báo.

from .draft_contracts import Contracts


def page_problems(page: dict, items: dict, configs: dict, contracts: Contracts) -> list[str]:
    errors = []
    for index, block in enumerate(page.get("blocks") or [], start=1):
        name = block.get("item") if isinstance(block, dict) else None
        component = items.get(name)
        if component is None:
            errors.append(f"khối {index}: không có mục '{name}' trong menu hay blocks của gói")
            continue
        if component == "page":
            errors.append(f"khối {index}: mục '{name}' là một trang; trang không chứa trang")
            continue
        described = contracts.components.get(component)
        properties = described.properties if described else {}
        allowed = list(properties.get("variant", {}).get("enum", []))
        variant = block.get("variant")
        config = configs.get(name)
        declared = config if isinstance(config, dict) else {}
        if variant is not None and variant not in allowed:
            choice = ", ".join(allowed) if allowed else "thành phần này chưa có kiểu nào, bỏ variant"
            errors.append(f"khối {index}: {component} không có kiểu '{variant}' ({choice})")
        elif variant in properties and variant not in declared:
            errors.append(f"khối {index}: kiểu '{variant}' cần mục {variant} trong cấu hình của '{name}'")
    return errors
