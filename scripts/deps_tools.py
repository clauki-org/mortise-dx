# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần "Ghim" cho công cụ chạy qua uv mà không cài sẵn (ADR 0039): mỗi `uvx <gói>`, `uvx --from <gói>` và
# `uv run --with <gói>` trong Makefile, scripts, deploy, bài kiểm của gói và workflow phải ghi
# `==<phiên bản>`.
# Không ghim thì uvx lấy bản mới nhất lúc chạy, và `make check-fast` có thể đổi kết quả dù repo không đổi gì.

import re
from pathlib import Path

from deps_pins import git_files

SCANNED = (
    "Makefile",
    "scripts/*.sh",
    "scripts/pre-push",
    "deploy/*.sh",
    "apps/*/tests/*.sh",
    ".github/workflows/*",
)
UVX = re.compile(r"\buvx\s+(\S+)(?:\s+(\S+))?")
WITH = re.compile(r"\buv\s+run\b.*")


def specs(line: str) -> list[str]:
    """Gói mà dòng lệnh chạy qua uv. Tùy chọn khác `--from` đứng trước tên gói thì trả về chính tùy chọn đó,
    để nó bị báo là không ghim thay vì lặng lẽ bỏ qua."""
    found = [(m.group(2) or "") if m.group(1) == "--from" else m.group(1) for m in UVX.finditer(line)]
    if WITH.search(line):
        found += re.findall(r"--with\s+(\S+)", line)
    return [s.strip("\"'") for s in found]


def check() -> tuple[list[str], int]:
    """(lỗi, số lệnh đã xét). Bỏ dòng chú thích: chú thích nhắc tới uvx không phải lệnh chạy."""
    problems, count = [], 0
    for path in git_files(*SCANNED):
        for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            for spec in specs(line):
                count += 1
                if "==" not in spec:
                    problems.append(f"`{path}:{number}`: `{spec}` chạy qua uv mà không ghim `==<phiên bản>`")
    return problems, count
