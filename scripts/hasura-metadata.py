# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quyền dữ liệu của Hasura khai báo trong repo (core/hasura/, platform/schema/hasura/) là bản gốc; Hasura đang
# chạy là bản sao. Ba lệnh:
#   apply  đưa Hasura về đúng tệp: đăng ký bảng còn thiếu, thay quyền và quan hệ sai, bỏ phần không khai
#          (make seed)
#   check  báo lỗi khi Hasura lệch khỏi tệp, kể cả bảng đăng ký mà không khai (make smoke)
#   lint   không cần Hasura: mọi quyền phải lọc theo tenant trong token (make check-fast)
# Không truyền tệp thì dùng mọi tệp *.yaml trong DECLARATIONS, để danh sách tệp chỉ nằm một chỗ, cộng tệp của
# gói (apps/<gói>/hasura/, ADR 0005): lint xét mọi gói; apply và check chỉ xét gói đã cài, tức gói có ít nhất
# một bảng đang đăng ký trong Hasura, vì bảng của gói do scripts/app.sh tạo và gỡ chứ không có sẵn.
# scripts/app.sh gọi với tệp của gói: apply khi cài, untrack (bỏ đăng ký kèm quan hệ và quyền) khi gỡ. Tệp của
# gói chỉ được khai bảng trong lược đồ của gói (database.schema trong app.yaml).
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


# Phần metadata của một bảng mà script quản lý. Quan hệ được quản lý vì quyền cần đi qua quan hệ (ví dụ chỉ
# thấy phòng của cơ sở mình được phân công). Computed field chưa quản lý: khai trong tệp thì báo lỗi thay vì
# lặng lẽ không áp, có trong Hasura thì check báo lệch để không ai tạo tay.
RELATIONSHIPS = {"object_relationships": "object", "array_relationships": "array"}
MANAGED = {"table"} | {f"{kind}_permissions" for kind in KINDS} | RELATIONSHIPS.keys()
UNMANAGED = ("computed_fields",)


def package_schema(path: str) -> str | None:
    """Lược đồ của gói chứa tệp khai báo (database.schema trong app.yaml); None nếu tệp không thuộc gói."""
    parts = os.path.normpath(path).split(os.sep)
    if len(parts) < 3 or parts[0] != "apps":
        return None
    with open(os.path.join("apps", parts[1], "app.yaml"), encoding="utf-8") as file:
        return yaml.safe_load(file)["database"]["schema"]


def load(files: list[str]) -> dict[tuple[str, str], dict]:
    tables: dict[tuple[str, str], dict] = {}
    for path in files:
        # Tệp của gói chỉ được khai bảng trong lược đồ của chính gói: khai nhầm một bảng của lõi thì apply sẽ
        # cấp quyền trên bảng đó, và untrack khi gỡ gói sẽ bỏ đăng ký nó khỏi Hasura.
        schema = package_schema(path)
        with open(path, encoding="utf-8") as file:
            for entry in yaml.safe_load(file) or []:
                extra = entry.keys() - MANAGED
                if extra:
                    raise SystemExit(
                        f"{path}: {', '.join(sorted(extra))} chưa được hỗ trợ; chỉ khai bảng và quyền"
                    )
                key = (entry["table"]["schema"], entry["table"]["name"])
                if schema is not None and key[0] != schema:
                    raise SystemExit(
                        f"{path}: bảng {key[0]}.{key[1]} nằm ngoài lược đồ của gói ({schema}, theo app.yaml)"
                    )
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


def without_nulls(value: object) -> object:
    # Hasura xuất kèm khóa không đặt dưới dạng null (ví dụ insertion_order của quan hệ khai tay); bỏ đi để so
    # khớp với tệp khai báo không báo lệch giả.
    if isinstance(value, dict):
        return {k: without_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [without_nulls(v) for v in value]
    return value


def relationships(entry: dict | None, part: str) -> dict[str, dict]:
    return {item["name"]: without_nulls(item["using"]) for item in (entry or {}).get(part, [])}


def relationship_actions(key: tuple[str, str], entry: dict, current: dict) -> tuple[list, list, list]:
    """Lệnh bỏ và tạo quan hệ của một bảng để khớp khai báo, kèm mô tả chỗ lệch."""
    table = {"schema": key[0], "name": key[1]}
    drops, creates, drift = [], [], []
    for part, kind in RELATIONSHIPS.items():
        want, have = relationships(entry, part), relationships(current.get(key), part)
        for name in sorted(want.keys() | have.keys()):
            if want.get(name) == have.get(name):
                continue
            drift.append(f"{key[0]}.{key[1]}: quan hệ {name} khác khai báo")
            args = {"source": "default", "table": table}
            if name in have:
                # cascade chỉ kéo theo quyền cùng bảng; quyền ở bảng khác đi qua quan hệ này thì Hasura từ
                # chối cả lô. plan vì vậy bỏ mọi quyền trước khi bỏ quan hệ rồi tạo lại sau.
                drop = args | {"relationship": name, "cascade": True}
                drops.append({"type": "pg_drop_relationship", "args": drop})
            if name in want:
                create = args | {"name": name, "using": want[name]}
                creates.append({"type": f"pg_create_{kind}_relationship", "args": create})
    return drops, creates, drift


def plan(declared: dict, current: dict) -> tuple[list[dict], list[str]]:
    """Các lệnh metadata đưa Hasura về đúng khai báo, và mô tả từng chỗ lệch.

    Thứ tự trong lô: đăng ký bảng, bỏ quyền, bỏ quan hệ, tạo quan hệ, tạo quyền. Quan hệ trỏ tới bảng khác nên
    cần mọi bảng đã đăng ký; quyền có thể đi qua quan hệ nên tạo sau quan hệ và bỏ trước quan hệ.
    """
    tracks, rel_drops, rel_creates, drift = [], [], [], []
    for key, entry in declared.items():
        if key not in current:
            table = {"schema": key[0], "name": key[1]}
            tracks.append({"type": "pg_track_table", "args": {"source": "default", "table": table}})
            drift.append(f"{key[0]}.{key[1]}: chưa đăng ký")
        drops, creates, changed = relationship_actions(key, entry, current)
        rel_drops, rel_creates, drift = rel_drops + drops, rel_creates + creates, drift + changed
    # Quyền ở bất kỳ bảng nào cũng có thể đi qua quan hệ sắp bỏ, và Hasura từ chối bỏ quan hệ khi còn quyền
    # như vậy; dựng lại toàn bộ quyền thì không phải dò quyền nào phụ thuộc quan hệ nào.
    rebuild = bool(rel_drops)
    perm_drops, perm_creates = [], []
    for key, entry in declared.items():
        table = {"schema": key[0], "name": key[1]}
        name = f"{key[0]}.{key[1]}"
        for kind in KINDS:
            want, have = permissions(entry, kind), permissions(current.get(key), kind)
            for role in sorted(want.keys() | have.keys()):
                same = want.get(role) == have.get(role)
                if not same:
                    drift.append(f"{name}: quyền {kind} của vai trò {role} khác khai báo")
                if same and not rebuild:
                    continue
                args = {"source": "default", "table": table, "role": role}
                if role in have:
                    perm_drops.append({"type": f"pg_drop_{kind}_permission", "args": args})
                if role in want:
                    perm_creates.append(
                        {"type": f"pg_create_{kind}_permission", "args": args | {"permission": want[role]}}
                    )
    actions = tracks + perm_drops + rel_drops + rel_creates + perm_creates
    for key in declared:
        name = f"{key[0]}.{key[1]}"
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


def declaration_files(folders: tuple[str, ...]) -> list[str]:
    return sorted(f for folder in folders for f in glob.glob(f"{folder}/*.yaml"))


def installed_packages(current: dict) -> list[str]:
    """Tệp khai báo của các gói đã cài: gói có ít nhất một bảng đang đăng ký trong Hasura."""
    files = []
    for folder in sorted(f for pattern in PACKAGE_DECLARATIONS for f in glob.glob(pattern)):
        package = declaration_files((folder,))
        if package and load(package).keys() & current.keys():
            files += package
    return files


def untrack(declared: dict, current: dict) -> int:
    # cascade: quan hệ và quyền trên bảng đi theo, không cần liệt kê lại. Bảng chưa đăng ký thì bỏ qua, để gỡ
    # lại một gói đã gỡ không lỗi.
    actions = [
        {
            "type": "pg_untrack_table",
            "args": {"source": "default", "table": {"schema": s, "name": n}, "cascade": True},
        }
        for (s, n) in declared
        if (s, n) in current
    ]
    if actions:
        call({"type": "bulk", "args": actions})
    print(f"hasura: đã bỏ đăng ký {len(actions)} bảng")
    return 0


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in {"apply", "check", "lint", "untrack"}:
        print("Cách dùng: hasura-metadata.py apply|check|lint|untrack [tệp khai báo...]", file=sys.stderr)
        return 2
    mode, files = sys.argv[1], sys.argv[2:]
    if mode == "lint":
        declared = load(files or declaration_files(DECLARATIONS + PACKAGE_DECLARATIONS))
        problems = lint(declared)
        print(
            "\n".join(problems) or f"ok -- {len(declared)} bảng, mọi quyền lọc theo tenant", file=sys.stderr
        )
        return 1 if problems else 0
    current = running()
    if mode == "untrack":
        if not files:
            print("untrack cần tệp khai báo của gói, để không bỏ đăng ký bảng của lõi.", file=sys.stderr)
            return 2
        return untrack(load(files), current)
    declared = load(files or declaration_files(DECLARATIONS) + installed_packages(current))
    actions, drift = plan(declared, current)
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
