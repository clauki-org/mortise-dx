# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quyền dữ liệu của Hasura khai báo trong repo (core/hasura/, platform/schema/hasura/) là bản gốc; Hasura đang
# chạy là bản sao. Ba lệnh:
#   apply  đưa Hasura về đúng tệp: đăng ký bảng còn thiếu, thay quyền sai, bỏ quyền không khai (make seed)
#   check  báo lỗi khi Hasura lệch khỏi tệp, kể cả bảng đăng ký mà không khai (make smoke)
#   lint   không cần Hasura: mọi quyền phải lọc theo tenant trong token (make check-fast)
# Không truyền tệp thì dùng mọi tệp *.yaml trong DECLARATIONS, để danh sách tệp chỉ nằm một chỗ. lint xét
# thêm tệp của gói (apps/<gói>/hasura/, ADR 0005); apply và check thì chưa, vì bảng của gói do bộ cài gói
# tạo (kế hoạch).
# Trước đây seed chỉ tạo quyền, nên quyền đã có mà sai thì giữ nguyên và không ai biết.

import glob
import json
import os
import sys
import urllib.error
import urllib.request

import yaml

KINDS = ("select", "insert", "update", "delete")
DECLARATIONS = ("core/hasura", "platform/schema/hasura")
PACKAGE_DECLARATIONS = ("apps/*/hasura",)
TENANT = "X-Hasura-Tenant-Id"


# Phần metadata của một bảng mà script quản lý. Quan hệ và computed field chưa quản lý: khai trong tệp thì báo
# lỗi thay vì lặng lẽ không áp, có trong Hasura thì check báo lệch để không ai tạo tay.
MANAGED = {"table"} | {f"{kind}_permissions" for kind in KINDS}
UNMANAGED = ("object_relationships", "array_relationships", "computed_fields")


def load(files: list[str]) -> dict[tuple[str, str], dict]:
    tables: dict[tuple[str, str], dict] = {}
    for path in files:
        with open(path, encoding="utf-8") as file:
            for entry in yaml.safe_load(file) or []:
                extra = entry.keys() - MANAGED
                if extra:
                    raise SystemExit(
                        f"{path}: {', '.join(sorted(extra))} chưa được hỗ trợ; chỉ khai bảng và quyền"
                    )
                key = (entry["table"]["schema"], entry["table"]["name"])
                if key in tables:
                    raise SystemExit(f"{path}: bảng {key[0]}.{key[1]} đã khai ở tệp khác")
                tables[key] = entry
    return tables


def call(body: dict) -> dict:
    url = os.environ.get("HASURA_URL") or f"http://127.0.0.1:{os.environ.get('HASURA_PORT', '8082')}"
    if not url.startswith(("http://", "https://")):
        raise SystemExit(f"HASURA_URL phải là địa chỉ http(s), nhận: {url}")
    # Địa chỉ đã kiểm là http(s) ở trên.
    request = urllib.request.Request(  # noqa: S310
        f"{url}/v1/metadata",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "X-Hasura-Admin-Secret": os.environ["HASURA_ADMIN_SECRET"],
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Hasura từ chối {body['type']}: {error.read().decode()}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Không gọi được Hasura tại {url} ({error.reason}); kiểm tra `make ps`.") from error


def running() -> dict[tuple[str, str], dict]:
    sources = [s for s in call({"type": "export_metadata", "args": {}})["sources"] if s["name"] == "default"]
    if not sources:
        raise SystemExit(
            "Hasura chưa có nguồn dữ liệu 'default'; kiểm tra HASURA_GRAPHQL_DATABASE_URL trong compose.yaml."
        )
    source = sources[0]
    return {(t["table"]["schema"], t["table"]["name"]): t for t in source.get("tables", [])}


def permissions(entry: dict | None, kind: str) -> dict[str, dict]:
    # Thứ tự cột không mang nghĩa, và Hasura xuất khóa không đặt dưới dạng null (ví dụ check của quyền
    # update); chuẩn hóa cả hai để so khớp không báo lệch giả.
    found = {}
    for item in (entry or {}).get(f"{kind}_permissions", []):
        permission = {key: value for key, value in item["permission"].items() if value is not None}
        if isinstance(permission.get("columns"), list):
            permission["columns"] = sorted(permission["columns"])
        found[item["role"]] = permission
    return found


def plan(declared: dict, current: dict) -> tuple[list[dict], list[str]]:
    """Các lệnh metadata đưa Hasura về đúng khai báo, và mô tả từng chỗ lệch."""
    actions, drift = [], []
    for key, entry in declared.items():
        table = {"schema": key[0], "name": key[1]}
        name = f"{key[0]}.{key[1]}"
        if key not in current:
            actions.append({"type": "pg_track_table", "args": {"source": "default", "table": table}})
            drift.append(f"{name}: chưa đăng ký")
        for kind in KINDS:
            want, have = permissions(entry, kind), permissions(current.get(key), kind)
            for role in sorted(want.keys() | have.keys()):
                if want.get(role) == have.get(role):
                    continue
                drift.append(f"{name}: quyền {kind} của vai trò {role} khác khai báo")
                args = {"source": "default", "table": table, "role": role}
                if role in have:
                    actions.append({"type": f"pg_drop_{kind}_permission", "args": args})
                if role in want:
                    actions.append(
                        {"type": f"pg_create_{kind}_permission", "args": args | {"permission": want[role]}}
                    )
        for part in UNMANAGED:
            if current.get(key, {}).get(part):
                drift.append(f"{name}: có {part} tạo ngoài khai báo; gỡ trên trang quản trị Hasura")
    # Không tự gỡ đăng ký: bảng của gói (khai báo riêng, do bộ cài gói áp) cũng nằm ở đây.
    for key in sorted(current.keys() - declared.keys()):
        drift.append(
            f"{key[0]}.{key[1]}: Hasura đăng ký nhưng không có trong khai báo; khai vào tệp hoặc gỡ đăng ký"
        )
    return actions, drift


def scoped(rule: object) -> bool:
    """Điều kiện có chắc chắn giới hạn trong tenant của token không, xét theo cấu trúc chứ không tìm chuỗi.

    Đúng khi có một nhánh AND (khóa cùng cấp, `_and`, hoặc đi qua quan hệ) so `_eq` với tenant của token.
    `_or`, `_not` và các toán tử khác không được tính: `_or` với một điều kiện luôn đúng sẽ mở mọi tenant dù
    có nhắc tới biến tenant.
    """
    if not isinstance(rule, dict):
        return False
    for key, value in rule.items():
        if key == "_and" and isinstance(value, list) and any(scoped(item) for item in value):
            return True
        if key.startswith("_") or not isinstance(value, dict):
            continue
        if value.get("_eq") == TENANT or scoped({k: v for k, v in value.items() if not k.startswith("_")}):
            return True
    return False


# Điều kiện phải giới hạn trong tenant: filter chọn dòng được đọc, sửa, xóa; check kiểm dòng sau khi thêm hay
# sửa, để không ai đổi cột tenant của dòng sang tenant khác.
RULES = {"select": ("filter",), "insert": ("check",), "update": ("filter", "check"), "delete": ("filter",)}


def lint(declared: dict) -> list[str]:
    problems = []
    for (schema, name), entry in declared.items():
        for kind, fields in RULES.items():
            for role, permission in permissions(entry, kind).items():
                for field in fields:
                    if not scoped(permission.get(field)):
                        problems.append(
                            f"{schema}.{name}: {field} của quyền {kind}, vai trò {role}, không giới hạn bằng "
                            f"{{<cột>: {{_eq: {TENANT}}}}}"
                        )
    return problems


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in {"apply", "check", "lint"}:
        print("Cách dùng: hasura-metadata.py apply|check|lint [tệp khai báo...]", file=sys.stderr)
        return 2
    mode = sys.argv[1]
    folders = DECLARATIONS + (PACKAGE_DECLARATIONS if mode == "lint" else ())
    files = sys.argv[2:] or sorted(f for folder in folders for f in glob.glob(f"{folder}/*.yaml"))
    declared = load(files)
    if mode == "lint":
        problems = lint(declared)
        print(
            "\n".join(problems) or f"ok -- {len(declared)} bảng, mọi quyền lọc theo tenant", file=sys.stderr
        )
        return 1 if problems else 0
    actions, drift = plan(declared, running())
    if mode == "check":
        print("\n".join(drift), file=sys.stderr)
        return 1 if drift else 0
    if actions:
        # Một lệnh trong lô lỗi thì cả lô báo lỗi, không lặng lẽ bỏ qua như bulk_keep_going trước đây.
        call({"type": "bulk", "args": actions})
    print(f"hasura: {len(declared)} bảng khớp khai báo ({len(actions)} thay đổi)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
