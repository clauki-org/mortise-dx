# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần "Giấy phép" của scripts/deps-check.py (ADR 0039). Thư viện Python: danh sách gói lấy từ uv.lock (bỏ
# nhóm dev, vì image chỉ cài phần chạy), giấy phép đọc từ METADATA của gói đã cài trong môi trường ảo của dịch
# vụ, chính môi trường mà `make test` dùng; uv.lock không ghi giấy phép, còn hỏi PyPI thì cần mạng mỗi lần.
# Image bên thứ ba: scripts/deps_readme.py.

import os
import re
import subprocess
from email import message_from_bytes
from email.message import Message
from pathlib import Path

from deps_pins import uv_projects
from deps_readme import image_problems

SPDX_EXPRESSION = re.compile(r"\(?[\w.+-]+\)?(\s+(AND|OR|WITH)\s+\(?[\w.+-]+\)?)*")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def venv_of(project: Path) -> Path:
    # Cùng đường dẫn với `make test`: dùng chung môi trường thì không cài lại mỗi lần chuyển giữa hai lệnh.
    root = os.environ.get("MORTISE_VENVS") or os.path.expanduser("~/.cache/mortise-dx")
    return Path(root) / f"{project.name}-venv"


def uv(
    project: Path, *args: str, env: dict | None = None, timeout: float | None = None
) -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603
        ["uv", *args],  # noqa: S607
        cwd=project,
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
        env={**os.environ, "UV_NO_PROGRESS": "1", **(env or {})},
    )


def locked_packages(project: Path) -> dict[str, str]:
    result = uv(project, "export", "--frozen", "--no-dev", "--no-hashes", "--no-emit-project", "--no-header")
    if result.returncode != 0:
        raise SystemExit(f"uv export lỗi ở {project}: {result.stderr.strip()}")
    packages = {}
    for line in result.stdout.splitlines():
        requirement = line.split(";", 1)[0].strip()
        if "==" in requirement and not requirement.startswith(("#", "-")):
            name, version = requirement.split("==", 1)
            packages[normalize(name)] = version
    return packages


def installed_packages(venv: Path) -> dict[str, tuple[str, Message]]:
    found = {}
    for path in venv.glob("lib/python*/site-packages/*.dist-info/METADATA"):
        message = message_from_bytes(path.read_bytes())
        found[normalize(message["Name"])] = (message["Version"], message)
    return found


def spdx_allowed(expression: str, allowed: set[str], aliases: dict) -> bool:
    """Đúng khi biểu thức SPDX được nhận: `A OR B` cần một vế, `A AND B` cần cả hai. Ngoại lệ `WITH` không đổi
    kết quả của giấy phép gốc. Biểu thức viết sai thì không nhận."""
    tokens = re.findall(r"\(|\)|[^\s()]+", expression)
    position = 0

    def take() -> str:
        nonlocal position
        if position >= len(tokens):
            raise ValueError
        position += 1
        return tokens[position - 1]

    def peek() -> str | None:
        return tokens[position] if position < len(tokens) else None

    def atom() -> bool:
        word = take()
        if word == "(":
            value = any_of()
            if take() != ")":
                raise ValueError
            return value
        if peek() == "WITH":
            take(), take()
        return aliases.get(word, word) in allowed

    def all_of() -> bool:
        value = atom()
        while peek() == "AND":
            take()
            value = atom() and value
        return value

    def any_of() -> bool:
        value = all_of()
        while peek() == "OR":
            take()
            value = all_of() or value
        return value

    try:
        value = any_of()
    except ValueError:
        return False
    return value and position == len(tokens)


def package_license(message: Message, allowed: set[str], aliases: dict) -> tuple[str, bool]:
    """(giấy phép như gói ghi, có được nhận không). Ưu tiên `License-Expression` (PEP 639), rồi trường
    `License` khi nó là một mã ngắn, rồi classifier. Nhiều classifier không nói rõ là được chọn một hay phải
    theo cả hai, nên mọi giấy phép khai đều phải được nhận; gói hai giấy phép mà chỉ khai classifier thì ghi
    giấy phép đọc từ tệp LICENSE vào `[licenses.packages]` của policy."""
    if expression := message.get("License-Expression"):
        return expression, spdx_allowed(expression, allowed, aliases)
    text = (message.get("License") or "").strip()
    if text and "\n" not in text and len(text) <= 60:
        spdx = aliases.get(text, text)
        if SPDX_EXPRESSION.fullmatch(spdx):
            return spdx, spdx_allowed(spdx, allowed, aliases)
    classifiers = [c for c in message.get_all("Classifier") or [] if c.startswith("License ::")]
    if classifiers:
        names = [aliases.get(c, c.rsplit(" :: ", 1)[-1]) for c in classifiers]
        return " AND ".join(names) + " (theo classifier)", all(n in allowed for n in names)
    return "không ghi giấy phép", False


def python_problems(policy: dict) -> tuple[list[str], int]:
    allowed = set(policy["licenses"]["python"])
    aliases = policy["licenses"]["aliases"]
    mapped = policy["licenses"].get("packages", {})
    problems, seen = [], set()
    refused: dict[tuple[str, str, str], list[str]] = {}
    for project in uv_projects():
        venv = venv_of(project)
        synced = uv(project, "sync", "--frozen", "--quiet", env={"UV_PROJECT_ENVIRONMENT": str(venv)})
        if synced.returncode != 0:
            problems.append(
                f"`{project}`: không cài được thư viện theo uv.lock để đọc giấy phép (lần đầu cần mạng)"
            )
            continue
        installed = installed_packages(venv)
        for name, version in sorted(locked_packages(project).items()):
            seen.add((name, version))
            where = f"`{name}` {version} ({project})"
            if name not in installed or installed[name][0] != version:
                problems.append(f"{where}: không có trong môi trường {venv} đúng bản đã khóa")
                continue
            if mapped.get(name, {}).get("version") == version:
                text = mapped[name]["license"]
                ok = spdx_allowed(text, allowed, aliases)
            else:
                text, ok = package_license(installed[name][1], allowed, aliases)
                if name in mapped:
                    text += (
                        f"; `[licenses.packages]` chỉ ghi cho bản {mapped[name]['version']}, đọc lại LICENSE"
                    )
            if not ok:
                refused.setdefault((name, version, text), []).append(project.name)
    problems += [
        f"`{name}` {version} ({', '.join(projects)}): giấy phép `{text}` không nằm trong danh sách cho phép"
        for (name, version, text), projects in sorted(refused.items())
    ]
    return problems, len(seen)


def check(policy: dict) -> tuple[list[str], str]:
    python, package_count = python_problems(policy)
    images, image_count = image_problems(policy)
    summary = (
        f"{package_count} thư viện Python của {len(uv_projects())} dịch vụ, {image_count} image đối chiếu "
        "bảng README; thư viện web kiểm trong `make web-check`"
    )
    return python + images, summary
