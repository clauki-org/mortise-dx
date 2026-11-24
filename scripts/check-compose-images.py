# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
"""Kiểm máy chủ chạy bản phát hành không thể lặng lẽ dựng image tại chỗ (ADR 0036). `make check-fast` gọi.

1. Với MORTISE_IMAGE_PREFIX, MORTISE_VERSION của bản phát hành, mọi dịch vụ có `build` trong compose.yaml
   mang image `<prefix>/<dịch vụ>:<tag>`, đúng tên release.yml đẩy lên và máy chủ kéo về; không trùng image
   của dịch vụ khác.
2. Không lệnh nào trong Makefile, scripts/, deploy/, apps/*/tests/ hay workflow gọi `--build`,
   `docker compose run` một dịch vụ tự viết, hay `docker compose up` cả lõi mà không qua scripts/compose.sh:
   các lối đó dựng image khi thiếu, bỏ qua MORTISE_NO_BUILD.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

PREFIX = "ghcr.io/clauki-org/mortise-dx"
VERSION = "v0.0.0"
WRAPPER = "scripts/compose.sh"
SCANNED = [
    "Makefile",
    "scripts/*.sh",
    "scripts/pre-push",
    "deploy/*.sh",
    "apps/*/tests/*.sh",
    ".github/workflows/*.yml",
]


def compose_services() -> dict:
    env_file = ".env" if Path(".env").exists() else ".env.example"
    env = {**os.environ, "MORTISE_IMAGE_PREFIX": PREFIX, "MORTISE_VERSION": VERSION}
    result = subprocess.run(  # noqa: S603
        ["docker", "compose", "--env-file", env_file, "--profile", "*", "config", "--format", "json"],  # noqa: S607
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(f"docker compose config lỗi:\n{result.stderr}")
    return json.loads(result.stdout)["services"]


def image_problems(services: dict) -> list[str]:
    problems = []
    for name, service in sorted(services.items()):
        if "build" not in service:
            continue
        want = f"{PREFIX}/{name}:{VERSION}"
        if service.get("image") != want:
            problems.append(
                f"compose.yaml: {name} có build nhưng image là {service.get('image')!r}, cần {want!r}"
            )
    images = [s.get("image") for s in services.values() if s.get("image")]
    built = {s["image"] for s in services.values() if "build" in s and s.get("image")}
    problems += [
        f"compose.yaml: image {i} vừa dựng tại chỗ vừa là image của dịch vụ khác"
        for i in built
        if images.count(i) > 1
    ]
    return problems


def logical_lines(path: Path):
    """Ghép các dòng nối bằng `\\` để một lệnh nhiều dòng được xét một lần."""
    buffer, start = "", 0
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not buffer:
            start = number
        if line.rstrip().endswith("\\"):
            buffer += line.rstrip()[:-1] + " "
            continue
        yield start, buffer + line
        buffer = ""


def call_problems(built: set[str]) -> list[str]:
    problems = []
    for pattern in SCANNED:
        for path in sorted(Path().glob(pattern)):
            if path.as_posix() in (WRAPPER, "scripts/check-compose-images.py"):
                continue
            for number, line in logical_lines(path):
                code = line.split("#", 1)[0] if path.suffix != ".yml" else line
                where = f"{path}:{number}"
                if re.search(r"(^|\s)--build(\s|$)", code):
                    problems.append(f"{where}: dùng --build; gọi qua {WRAPPER}")
                match = re.search(r"docker compose\b.*?\b(run|up)\b(.*)", code)
                if not match:
                    continue
                # Chỉ xét tới hết lệnh compose, không lấy lệnh nối sau `&&`, `||`, `;`, `|`.
                command = re.split(r"&&|\|\||;|\||\)", match.group(2))[0]
                words = {w.strip("\"'") for w in command.split()}
                if match.group(1) == "run" and words & built:
                    problems.append(f"{where}: docker compose run dịch vụ tự viết; dùng {WRAPPER} run")
                if match.group(1) == "up":
                    named = {w for w in words if w and not w.startswith(("-", ">", "$", "2>", "&", "|"))}
                    if not named or named & built:
                        problems.append(f"{where}: docker compose up có dịch vụ tự viết; dùng {WRAPPER} up")
    return problems


def main() -> None:
    services = compose_services()
    built = {name for name, service in services.items() if "build" in service}
    problems = image_problems(services) + call_problems(built)
    if problems:
        sys.exit("\n".join(problems))
    print(
        f"ok -- {len(built)} dịch vụ tự viết mang image {PREFIX}/<dịch vụ>:<tag>, không dựng ngoài {WRAPPER}"
    )


if __name__ == "__main__":
    main()
