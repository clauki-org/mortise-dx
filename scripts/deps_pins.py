# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần "Ghim" của scripts/deps-check.py (ADR 0039): mọi image bên thứ ba trong compose.yaml (mọi profile) và
# mọi dòng FROM của Dockerfile mang phiên bản tới bản vá, thư viện Python khóa trong uv.lock khớp
# pyproject.toml và image cài đúng theo khóa, thư viện web khóa trong package-lock.json, mô hình Ollama ghim
# theo digest. Chỉ đọc tệp trong repo và gọi `docker compose config`, `uv lock --check`; không hỏi registry.
# `uv lock --check` chỉ cần mạng khi máy chưa có Python mà pyproject.toml đòi: uv tải về một lần.

import functools
import json
import os
import re
import subprocess
from pathlib import Path

LOCAL_TAG = re.compile(r"\$\{MORTISE_VERSION")
DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def git_files(*patterns: str) -> list[Path]:
    result = subprocess.run(["git", "ls-files", *patterns], capture_output=True, text=True, check=False)  # noqa: S603,S607
    if result.returncode != 0:
        raise SystemExit(f"git ls-files lỗi: {result.stderr.strip()}; chạy lệnh trong thư mục gốc của repo")
    return [Path(line) for line in result.stdout.splitlines()]


def split_image(ref: str) -> tuple[str, str]:
    """Tách `repo:tag`; cổng của registry (`host:5000/x`) không phải tag."""
    ref = ref.split("@", 1)[0]
    head, _, last = ref.rpartition("/")
    if ":" in last:
        name, tag = last.split(":", 1)
        return (f"{head}/{name}" if head else name), tag
    return ref, ""


def tag_version(tag: str) -> tuple[str, str, str] | None:
    """Tách tag thành (tiền tố, phiên bản, hậu tố). Phiên bản là cụm số có dấu chấm đầu tiên, để `amd64` trong
    `linux-amd64-6.0.2` hay `pg17` trong `0.8.7-pg17-trixie` không bị coi là phiên bản."""
    match = re.search(r"\d+(?:\.\d+)+", tag) or re.search(r"\d+", tag)
    if not match:
        return None
    return tag[: match.start()], match.group(), tag[match.end() :]


@functools.cache
def compose_images() -> list[tuple[str, str]]:
    """(dịch vụ, image) của mọi dịch vụ không tự dựng. Không in kết quả của `config`: nó chứa giá trị của
    .env."""
    env_file = ".env" if Path(".env").exists() else ".env.example"
    result = subprocess.run(  # noqa: S603
        ["docker", "compose", "--env-file", env_file, "--profile", "*", "config", "--format", "json"],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit("docker compose config lỗi; chạy `docker compose config -q` để xem chi tiết")
    services = json.loads(result.stdout)["services"]
    return sorted((name, s["image"]) for name, s in services.items() if "build" not in s and s.get("image"))


def dockerfile_images() -> list[tuple[str, str]]:
    """(tệp:dòng, image) của mọi dòng FROM; bỏ dòng FROM trỏ tới tầng build trước đó trong cùng tệp."""
    found = []
    for path in git_files("*Dockerfile", "*Dockerfile.*"):
        stages = set()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            words = line.split()
            if not words or words[0].upper() != "FROM":
                continue
            args = [w for w in words[1:] if not w.startswith("--")]
            if args[0] not in stages and args[0] != "scratch":
                found.append((f"{path}:{number}", args[0]))
            if len(args) >= 3 and args[1].upper() == "AS":
                stages.add(args[2])
    return found


def image_problem(image: str, coarse: dict) -> str | None:
    # Digest `@sha256:` không thay cho tag: người đọc compose.yaml và báo cáo bản mới cần số phiên bản.
    repo, tag = split_image(image)
    if "$" in image:
        return f"`{image}`: tag lấy từ biến, không đọc được phiên bản"
    if not tag or tag == "latest":
        return f"`{image}`: không ghim phiên bản (thiếu tag hoặc `latest`)"
    parts = tag_version(tag)
    if parts is None:
        return f"`{image}`: tag không có số phiên bản"
    if parts[1].count(".") < 2 and repo not in coarse:
        return (
            f"`{image}`: chỉ ghim tới `{parts[1]}`, tag này trôi theo bản vá; ghim tới bản vá, hoặc ghi lý "
            "do vào `[pins.coarse]` của scripts/deps-policy.toml"
        )
    return None


def uv_projects() -> list[Path]:
    return [p.parent for p in git_files("*pyproject.toml") if (p.parent / "uv.lock").exists()]


def python_problems() -> list[str]:
    problems = []
    for path in git_files("*pyproject.toml"):
        if not (path.parent / "uv.lock").exists():
            problems.append(f"`{path.parent}`: có pyproject.toml mà không có uv.lock")
    for project in uv_projects():
        result = subprocess.run(  # noqa: S603
            ["uv", "lock", "--check"],  # noqa: S607
            cwd=project,
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "UV_NO_PROGRESS": "1"},
        )
        if result.returncode != 0:
            # Không phải lỗi nào cũng là khóa lệch (thiếu Python, mất mạng lúc tải Python), nên in lời của uv.
            lines = result.stderr.strip().splitlines() or ["không rõ"]
            reason = next((line for line in lines if line.startswith("error")), lines[-1])
            problems.append(
                f"`{project}/uv.lock`: `uv lock --check` lỗi ({reason}); khóa lệch pyproject.toml thì chạy "
                "`uv lock` trong thư mục đó"
            )
        dockerfile = project / "Dockerfile"
        if dockerfile.exists():
            text = dockerfile.read_text(encoding="utf-8")
            if "uv sync" in text and not re.search(r"uv sync[^\n]*--(frozen|locked)", text):
                problems.append(
                    f"`{dockerfile}`: `uv sync` không có `--frozen`, image có thể cài khác uv.lock"
                )
    return problems


def web_problems() -> list[str]:
    problems = []
    for lock_path in git_files("*package-lock.json"):
        package = json.loads((lock_path.parent / "package.json").read_text(encoding="utf-8"))
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        root = lock.get("packages", {}).get("", {})
        for key in ("dependencies", "devDependencies"):
            if package.get(key, {}) != root.get(key, {}):
                problems.append(f"`{lock_path}`: {key} khác package.json; chạy `npm install` để khóa lại")
        loose = [
            name
            for name, entry in lock.get("packages", {}).items()
            if name and not entry.get("link") and not entry.get("integrity")
        ]
        if loose:
            problems.append(f"`{lock_path}`: {len(loose)} gói không có băm `integrity`, ví dụ `{loose[0]}`")
    return problems


def model_problems() -> tuple[list[str], int]:
    problems, count = [], 0
    for path in git_files("core/ollama/models.txt"):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.startswith("#"):
                continue
            count += 1
            words = line.split()
            name = words[0]
            if ":" not in name or name.endswith(":latest"):
                problems.append(f"`{path}:{number}`: mô hình `{name}` không ghi tag cụ thể")
            if len(words) < 2 or not DIGEST.match(words[1]):
                problems.append(
                    f"`{path}:{number}`: mô hình `{name}` không ghim digest `sha256:<64 ký tự hex>`"
                )
    return problems, count


def describe_places(places: list[str]) -> str:
    shown = ", ".join(f"`{p}`" for p in places[:3])
    return shown if len(places) <= 3 else f"{shown} và {len(places) - 3} chỗ khác"


def check(policy: dict) -> tuple[list[str], str]:
    """Trả về (lỗi, tóm tắt những gì đã kiểm)."""
    coarse = policy.get("pins", {}).get("coarse", {})
    compose = compose_images()
    docker = dockerfile_images()
    places: dict[str, list[str]] = {}
    for service, image in compose:
        places.setdefault(image, []).append(f"compose.yaml ({service})")
    for where, image in docker:
        places.setdefault(image, []).append(where)
    problems = [
        f"{problem}; ở {describe_places(places[image])}"
        for image in sorted(places)
        if (problem := image_problem(image, coarse))
    ]
    problems += python_problems() + web_problems()
    models, model_count = model_problems()
    problems += models
    summary = (
        f"{len({i for _, i in compose})} image trong compose.yaml, {len(docker)} dòng FROM, "
        f"{len(uv_projects())} uv.lock, package-lock.json, {model_count} mô hình"
    )
    return problems, summary
