# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc mẫu cài presets/<mẫu>/preset.yaml (contracts/preset.schema.json, ADR 0058) cho các lệnh shell, để
# chỉ một chỗ hiểu định dạng tệp. Schema do scripts/contracts.sh kiểm; ở đây kiểm phần schema không tự kiểm
# được: tên trùng thư mục, gói và tệp được trỏ tới có thật, dữ liệu demo chỉ cho gói có trong danh sách cài.
#   check <mẫu>...   báo lỗi tham chiếu; make check-fast gọi cho mọi mẫu, scripts/install.sh trước khi cài
#   tenants <mẫu>    mỗi dòng: mã tenant, tab, tên; scripts/seed.sh tạo trong core.tenants
#   accounts <mẫu>   mỗi dòng: tài khoản, tenant, vai trò (`-` là không có), `-`; như danh sách users của
#                    seed.sh
#   plan <mẫu>       các dòng `branding <thư mục>`, `package <gói>`, `demo <gói> [<tệp>]` cho install.sh

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def load(name: str) -> dict:
    path = ROOT / "presets" / name / "preset.yaml"
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        known = ", ".join(sorted(p.parent.name for p in (ROOT / "presets").glob("*/preset.yaml")))
        raise SystemExit(f"Không đọc được {path}: {error}. Mẫu có sẵn: {known}.") from error


def data_dir(base: Path, step: dict) -> Path:
    """Thư mục của tệp dữ liệu demo: của mẫu, hay của gói khi gói mang dữ liệu cho mẫu cài (from: package)."""
    return ROOT / "apps" / step["package"] if step.get("from") == "package" else base


def problems(name: str, preset: dict) -> list[str]:
    base = ROOT / "presets" / name
    found = []
    if preset.get("name") != name:
        found.append(f"name '{preset.get('name')}' phải trùng tên thư mục '{name}'")
    if not (base / preset["branding"] / "branding.json").is_file():
        found.append(f"thư mục thương hiệu {preset['branding']} không có branding.json")
    packages = preset["packages"]
    found += [
        f"gói {p} không có apps/{p}/app.yaml"
        for p in packages
        if not (ROOT / "apps" / p / "app.yaml").is_file()
    ]
    for step in preset.get("demo", []):
        if step["package"] not in packages:
            found.append(f"demo cho gói {step['package']} không nằm trong packages")
        folder = data_dir(base, step)
        if "data" in step and not (folder / step["data"]).is_file():
            found.append(f"tệp dữ liệu demo {step['data']} không có trong {folder.relative_to(ROOT)}")
    usernames = [a["username"] for t in preset.get("tenants", []) for a in t["accounts"]]
    found += [f"tài khoản {u} khai hai lần" for u in sorted({u for u in usernames if usernames.count(u) > 1})]
    return found


def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] not in {"check", "tenants", "accounts", "plan"}:
        raise SystemExit("Cách dùng: preset.py check|tenants|accounts|plan <mẫu>...")
    command, names = sys.argv[1], sys.argv[2:]
    if command == "check":
        failed = [f"presets/{n}/preset.yaml: {p}" for n in names for p in problems(n, load(n))]
        if failed:
            print("\n".join(failed), file=sys.stderr)
        return 1 if failed else 0
    preset = load(names[0])
    if command == "tenants":
        for tenant in preset.get("tenants", []):
            print(f"{tenant['id']}\t{tenant['name']}")
    elif command == "accounts":
        for tenant in preset.get("tenants", []):
            for account in tenant["accounts"]:
                print(account["username"], tenant["id"], account.get("role", "-"), "-")
    else:
        print("branding", f"./presets/{names[0]}/{preset['branding']}")
        for package in preset["packages"]:
            print("package", package)
        for step in preset.get("demo", []):
            folder = f"apps/{step['package']}" if step.get("from") == "package" else f"presets/{names[0]}"
            data = f" ./{folder}/{step['data']}" if "data" in step else ""
            print(f"demo {step['package']}{data}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
