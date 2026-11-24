# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần "Bản mới" của scripts/deps-check.py (ADR 0039): image có tag ổn định mới hơn, mô hình Ollama mà tag đã
# trỏ sang trọng số khác, thư viện Python và web có bản mới. Chỉ báo, không sửa tệp nào. Phần này cần mạng;
# hỏi một nguồn lỗi thì nguồn đó ghi "không kiểm được" và các phần khác vẫn chạy, vì registry hay PyPI chậm
# không phải lỗi của repo.

import json
import shutil
import subprocess
from pathlib import Path

from deps_licenses import locked_packages, normalize, uv, venv_of
from deps_pins import compose_images, dockerfile_images, git_files, split_image, uv_projects
from deps_registry import list_tags, newest_tag, ollama_weights

# Giây chờ mỗi lệnh hỏi PyPI hay npm. Lệnh treo mà không có hạn thì job hằng tuần hết giờ, không đăng báo
# cáo.
COMMAND_TIMEOUT = 120


def image_updates(policy: dict) -> tuple[list[str], list[str]]:
    names = policy["readme"]
    images = sorted({i for _, i in compose_images()} | {i for _, i in dockerfile_images()})
    found, unchecked = [], []
    for image in images:
        repo, tag = split_image(image)
        try:
            newest = newest_tag(tag, list_tags(repo))
        except Exception as error:  # noqa: BLE001 -- mọi lỗi mạng hay định dạng đều chỉ là "không kiểm được"
            unchecked.append(f"image `{image}` ({type(error).__name__})")
            continue
        if newest:
            found.append(f"{names.get(repo, repo)} `{tag}` → `{newest}`")
    return found, unchecked


def model_updates() -> tuple[list[str], list[str]]:
    found, unchecked = [], []
    for path in git_files("core/ollama/models.txt"):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            name, pinned = line.split()[:2]
            try:
                current = ollama_weights(name)
            except Exception as error:  # noqa: BLE001
                unchecked.append(f"mô hình `{name}` ({type(error).__name__})")
                continue
            if current != pinned:
                found.append(
                    f"mô hình `{name}`: tag nay trỏ tới trọng số `{current[:19]}…`, khác digest đã ghim"
                )
    return found, unchecked


def python_updates() -> tuple[list[str], list[str]]:
    """Gộp theo gói: `tên` → bản mới: bản đang dùng (dịch vụ...). Chỉ xét gói chạy trong image, không xét
    nhóm dev."""
    groups: dict[tuple[str, str], dict[str, list[str]]] = {}
    unchecked = []
    for project in uv_projects():
        python = venv_of(project) / "bin" / "python"
        try:
            result = uv(
                project,
                "pip",
                "list",
                "--outdated",
                "--format",
                "json",
                "--python",
                str(python),
                timeout=COMMAND_TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            result = None
        if result is None or result.returncode != 0:
            unchecked.append(f"thư viện Python của `{project}`")
            continue
        runtime = locked_packages(project)
        for row in json.loads(result.stdout or "[]"):
            name = normalize(row["name"])
            if name in runtime:
                groups.setdefault((name, row["latest_version"]), {}).setdefault(row["version"], []).append(
                    project.name
                )
    found = []
    for (name, latest), versions in sorted(groups.items()):
        used = "; ".join(f"{v} ({', '.join(s)})" for v, s in sorted(versions.items()))
        found.append(f"Python `{name}` → `{latest}`: đang dùng {used}")
    return found, unchecked


def web_updates() -> tuple[list[str], list[str]]:
    found, unchecked = [], []
    npm = shutil.which("npm")
    for lock in git_files("*package-lock.json"):
        if npm is None:
            unchecked.append(f"thư viện web của `{lock.parent}` (không có npm)")
            continue
        # npm outdated trả mã 1 khi có gói lỗi thời; chỉ JSON hỏng hay có khóa `error` mới là không kiểm được.
        try:
            result = subprocess.run(  # noqa: S603
                [npm, "outdated", "--json"],
                cwd=lock.parent,
                capture_output=True,
                text=True,
                check=False,
                timeout=COMMAND_TIMEOUT,
            )
            rows = json.loads(result.stdout or "{}")
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            rows = {"error": True}
        if "error" in rows:
            unchecked.append(f"thư viện web của `{lock.parent}`")
            continue
        locked = json.loads(Path(lock).read_text(encoding="utf-8")).get("packages", {})
        for name, row in sorted(rows.items()):
            current = row.get("current") or locked.get(f"node_modules/{name}", {}).get("version")
            if row.get("latest") and row["latest"] != current:
                found.append(f"web `{name}` `{current}` → `{row['latest']}`")
    return found, unchecked


def check(policy: dict) -> tuple[list[str], list[str]]:
    found, unchecked = [], []
    for part in (lambda: image_updates(policy), model_updates, python_updates, web_updates):
        more, missed = part()
        found += more
        unchecked += missed
    return found, unchecked
