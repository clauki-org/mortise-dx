# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm phụ thuộc của dự án và in báo cáo theo mẫu comment của issue theo dõi (ADR 0039): ghim phiên bản
# (scripts/deps_pins.py), giấy phép (scripts/deps_licenses.py), bản mới (scripts/deps_updates.py), chính sách
# ở scripts/deps-policy.toml. Mã thoát khác 0 chỉ khi ghim hay giấy phép lỗi; bản mới chỉ để người xem quyết
# định. `make deps-check` chạy đủ; `make check-fast` chạy với --offline (bỏ phần bản mới, phần duy nhất cần
# mạng mỗi lần). --report <tệp> ghi thêm báo cáo ra tệp, để workflow deps-check.yml đăng thành comment.

import argparse
import datetime
import os
import subprocess
import sys
import tomllib
from pathlib import Path

import deps_licenses
import deps_pins
import deps_tools
import deps_updates

POLICY = Path(__file__).with_name("deps-policy.toml")


def commit() -> str:
    sha = os.environ.get("GITHUB_SHA")
    if sha:
        return sha[:7]
    result = subprocess.run(  # noqa: S603
        ["git", "rev-parse", "--short", "HEAD"],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() or "không rõ"


def section(title: str, problems: list[str], summary: str) -> list[str]:
    if not problems:
        return [f"- {title}: đạt ({summary})"]
    return [f"- {title}: lỗi ({summary})", *(f"  - {p}" for p in problems)]


def updates_section(policy: dict, offline: bool) -> list[str]:
    if offline:
        return ["- Bản mới: không kiểm (chạy với `--offline`)"]
    found, unchecked = deps_updates.check(policy)
    lines = ["- Bản mới:" if found or unchecked else "- Bản mới: không có"]
    lines += [f"  - {line}" for line in found]
    if unchecked:
        lines.append(f"  - Không kiểm được: {', '.join(unchecked)}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Kiểm ghim phiên bản, giấy phép và bản mới của phụ thuộc")
    parser.add_argument(
        "--offline", action="store_true", help="bỏ phần bản mới, không hỏi registry hay PyPI, npm"
    )
    parser.add_argument("--report", type=Path, help="ghi thêm báo cáo markdown ra tệp này")
    args = parser.parse_args()
    policy = tomllib.loads(POLICY.read_text(encoding="utf-8"))

    pin_problems, pin_summary = deps_pins.check(policy)
    tool_problems, tool_count = deps_tools.check()
    pin_problems += tool_problems
    pin_summary += f", {tool_count} lệnh chạy qua uvx, uv run --with"
    license_problems, license_summary = deps_licenses.check(policy)
    today = datetime.date.today().isoformat()
    lines = [
        f"Kiểm ngày {today} (commit {commit()})",
        "",
        *section("Ghim", pin_problems, pin_summary),
        *section("Giấy phép", license_problems, license_summary),
        *updates_section(policy, args.offline),
        "- Quyết định: chờ người xem",
    ]
    report = "\n".join(lines) + "\n"
    print(report, end="")
    if args.report:
        try:
            args.report.write_text(report, encoding="utf-8")
        except OSError as error:
            print(f"Không ghi được báo cáo ra {args.report}: {error}", file=sys.stderr)
            return 2
    return 1 if pin_problems or license_problems else 0


if __name__ == "__main__":
    sys.exit(main())
