# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần image bên thứ ba trong "Giấy phép" của scripts/deps-check.py (ADR 0039): mỗi image trong compose.yaml
# (mọi profile) phải có dòng trong bảng "Thành phần đang chạy" của README, cùng phiên bản với tag, và mọi giấy
# phép ghi ở dòng đó nằm trong danh sách cho phép. Bảng README là chỗ người đọc tra giấy phép, nên nó không
# được lệch khỏi thứ thật sự chạy.

import re
from pathlib import Path

from deps_pins import compose_images, split_image, tag_version

LICENSE = re.compile(r"PostgreSQL License|\b[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9.]+)+|\b(?:MIT|ISC|0BSD)\b")


def readme_licenses(cell: str) -> tuple[list[str], str]:
    """(mã giấy phép trong ô, chữ không nhận ra). Ngoài ngoặc chỉ được có mã giấy phép và dấu `/`, để
    `Apache-2.0 / SSPL` không lọt qua vì `SSPL` không giống mã SPDX. Trong ngoặc là ghi chú, chỉ từ có chữ số
    (như `BSL 1.1`) mà không phải mã đã biết mới bị coi là lạ."""
    outside = LICENSE.sub(" ", re.sub(r"\([^)]*\)", " ", cell))
    stray = re.sub(r"[/\s]+", " ", outside).split()
    notes = LICENSE.sub(" ", " ".join(re.findall(r"\(([^)]*)\)", cell)))
    stray += [word for word in notes.split() if re.search(r"\d", word)]
    return LICENSE.findall(cell), " ".join(stray)


def readme_rows(readme: Path) -> dict[str, tuple[str, str]]:
    """Cột Thành phần → (Phiên bản, Giấy phép) của bảng "Thành phần đang chạy"."""
    rows, inside = {}, False
    for line in readme.read_text(encoding="utf-8").splitlines():
        if line.startswith("### Thành phần đang chạy"):
            inside = True
        elif inside and line.startswith("#"):
            break
        elif inside and line.startswith("|") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) == 4:
                rows[cells[1]] = (cells[2], cells[3])
    return rows


def image_problems(policy: dict) -> tuple[list[str], int]:
    allowed = set(policy["licenses"]["images"])
    aliases = policy["licenses"]["aliases"]
    mapping = policy["readme"]
    rows = readme_rows(Path("README.md"))
    problems = []
    images = sorted({image for _, image in compose_images()})
    for image in images:
        repo, tag = split_image(image)
        component = mapping.get(repo)
        if component is None:
            problems.append(
                f"`{image}`: chưa ánh xạ tới dòng nào của bảng giấy phép README (`[readme]` của policy)"
            )
            continue
        if component not in rows:
            problems.append(f"`{image}`: README không có dòng thành phần `{component}`")
            continue
        version, license_text = rows[component]
        parts = tag_version(tag)
        if parts is None or parts[1] not in re.findall(r"\d+(?:\.\d+)*", version):
            problems.append(
                f"`{image}`: README ghi {component} phiên bản `{version}`, compose.yaml dùng tag `{tag}`"
            )
        names, stray = readme_licenses(license_text)
        refused = [n for n in names if aliases.get(n, n) not in allowed]
        if stray or not names:
            problems.append(f"`{image}`: không đọc được giấy phép trong README: `{stray or license_text}`")
        if refused:
            shown = ", ".join(refused)
            problems.append(f"`{image}`: giấy phép trong README ({shown}) không nằm trong danh sách cho phép")
    return problems, len(images)
