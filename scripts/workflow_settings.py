# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Giá trị cấu hình của quy trình gói (mục `settings` trong app.yaml, ADR 0019): BPMN của gói viết {{tên}} ở
# chỗ cần một ngưỡng hay thời hạn, bộ cài thay bằng giá trị lúc deploy. Giá trị nằm trong định nghĩa quy trình
# chứ không phải biến của hồ sơ, nên người lập hay người duyệt hồ sơ không ghi đè được qua workflow-api. Dùng
# chung cho scripts/app-deploy.py (thay khi deploy) và scripts/check-workflow-steps.py (make check-fast kiểm
# tên).

import re

# Không trùng cú pháp ${...} của biểu thức Flowable, nên BPMN vẫn viết biểu thức bình thường quanh chỗ thay.
PLACEHOLDER = re.compile(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}")
# Giá trị được chép thẳng vào XML và vào biểu thức của Flowable: chỉ nhận số và chuỗi như thời hạn ISO 8601
# (P30D, PT20S). Ký tự <, &, ", khoảng trắng hay ngoặc sẽ đổi nghĩa tệp hoặc biểu thức.
VALUE = re.compile(r"[A-Za-z0-9.:+_-]{1,64}")


class SettingsError(Exception):
    pass


def placeholders(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


def parse_overrides(text: str) -> dict[str, str]:
    """`tên=giá trị,tên=giá trị` (biến SETTINGS của make app-install) thành từ điển; rỗng là không đổi gì."""
    found = {}
    for part in filter(None, (piece.strip() for piece in text.split(","))):
        name, sep, value = part.partition("=")
        if not sep or not name.strip():
            raise SettingsError(f"SETTINGS: '{part}' không đúng dạng tên=giá trị")
        found[name.strip()] = value.strip()
    return found


def merge(defaults: dict, overrides: dict[str, str]) -> dict[str, str]:
    # Tên ghi đè không có trong app.yaml thường là gõ sai; bỏ qua thì bản cài chạy với giá trị mặc định mà
    # không ai biết, ví dụ demo chờ 30 ngày thay vì vài giây.
    unknown = sorted(overrides.keys() - defaults.keys())
    if unknown:
        raise SettingsError(f"SETTINGS: {', '.join(unknown)} không có trong settings của app.yaml")
    settings = {name: str(value) for name, value in defaults.items()} | overrides
    for name, value in settings.items():
        if not VALUE.fullmatch(value):
            raise SettingsError(f"settings: giá trị của {name} ('{value}') chỉ được gồm chữ, số và . : + _ -")
    return settings


def render(text: str, settings: dict[str, str], where: str) -> str:
    """Thay mọi {{tên}} bằng giá trị; tên chưa khai là lỗi, không để chuỗi {{tên}} lọt vào Flowable."""
    missing = sorted(placeholders(text) - settings.keys())
    if missing:
        raise SettingsError(f"{where}: {', '.join(missing)} chưa khai trong settings của app.yaml")
    return PLACEHOLDER.sub(lambda match: settings[match.group(1)], text)
