# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm phần tài liệu đính kèm của cấu hình danh mục (detail.documents, contracts/documents.schema.json, ADR
# 0041) với quyền Hasura của gói chứa nó, những luật JSON Schema không diễn đạt được: bảng nối thuộc gói;
# vai trò user, vai trò mà danh mục dùng để đọc (ADR 0023), đọc được mọi cột phần tài liệu nhắc tới; có
# upload thì vai trò của nó thêm được dòng với cột via, file, note, và không cột nào trong đó gắn với tenant
# của token. Thiếu bước này, lỗi chỉ lộ ra khi người dùng mở cơ sở hay đính kèm xong một tệp mà không gắn
# được. Thành phần kiểm lại luật tên lúc chạy (documents.ts). Gọi từ scripts/contracts.sh: --app <app.yaml>;
# mặc định đọc quyền Hasura và mọi danh mục trên menu theo app.yaml, còn --hasura, --catalog thay từng phần
# để kiểm một cấu hình với tệp mẫu.

import argparse
import glob
import os
import sys

import yaml
from form_permissions import permission, tables_of, tenant_columns

# Danh mục không gửi X-Hasura-Role khi đọc, nên Hasura dùng vai trò mặc định của token là user (ADR 0023).
READ_ROLE = "user"


def read_yaml(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def read_problems(documents: dict, label: str, tables: dict) -> list[str]:
    source = documents["source"]
    if source not in tables:
        return [f"{label}: bảng nối '{source}' không có trong quyền Hasura của gói"]
    allowed = permission(tables[source], "select_permissions", READ_ROLE)
    if allowed is None:
        return [f"{label}: vai trò '{READ_ROLE}' không đọc được '{source}'; danh mục đọc bằng vai trò này"]
    readable = allowed.get("columns", [])
    names = [documents["via"], documents["file"], *(f["name"] for f in documents.get("fields", []))]
    if documents.get("sort"):
        names.append(documents["sort"]["field"])
    return [
        f"{label}: vai trò '{READ_ROLE}' không đọc được cột '{name}' của '{source}'"
        for name in dict.fromkeys(names)
        if readable != "*" and name not in readable
    ]


def upload_problems(documents: dict, label: str, tables: dict) -> list[str]:
    upload, source = documents.get("upload"), documents["source"]
    if upload is None or source not in tables:
        return []
    role = upload.get("role", "user")
    allowed = permission(tables[source], "insert_permissions", role)
    if allowed is None:
        return [
            f"{label}: vai trò '{role}' không thêm được dòng vào '{source}'; "
            "sửa upload.role hoặc quyền của gói"
        ]
    writable, bound = allowed.get("columns", []), tenant_columns(allowed)
    errors = []
    for name in dict.fromkeys(n for n in (documents["via"], documents["file"], upload.get("note")) if n):
        # Cột gắn với tenant do token quyết định; trình duyệt gửi giá trị cho cột đó thì Hasura từ chối
        # hoặc bỏ qua.
        if name in bound:
            errors.append(
                f"{label}: cột '{name}' gắn với tenant của token, không dùng làm via, file hay note"
            )
        elif writable != "*" and name not in writable:
            errors.append(f"{label}: vai trò '{role}' không ghi được cột '{name}' của '{source}'")
    return errors


def node_problems(node: dict, tables: dict, where: str) -> list[str]:
    detail = node.get("detail") or {}
    errors = []
    documents = detail.get("documents")
    if documents:
        label = f"{where}phần tài liệu"
        errors += read_problems(documents, label, tables) + upload_problems(documents, label, tables)
    for child in detail.get("children", []):
        errors += node_problems(child, tables, f"{where}{child['id']}: ")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True)
    parser.add_argument("--hasura", nargs="*")
    parser.add_argument("--catalog")
    args = parser.parse_args()
    directory = os.path.dirname(args.app)
    try:
        app = read_yaml(args.app)
        hasura = os.path.join(directory, app["hasura"]) if app.get("hasura") else None
        tables = tables_of(args.hasura or (sorted(glob.glob(f"{hasura}/*.yaml")) if hasura else []))
        if args.catalog:
            paths = [args.catalog]
        else:
            entries = [e for e in app.get("menu", []) if e["component"] == "catalog"]
            paths = [os.path.join(directory, e["config"]) for e in entries]
        errors = []
        for path in paths:
            errors += [f"{path}: {error}" for error in node_problems(read_yaml(path), tables, "")]
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError) as error:
        errors = [f"không đọc được tệp: {error}; sửa theo contracts/documents.schema.json"]
    for error in errors:
        print(error, file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
