# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bộ nạp chung cho dữ liệu demo khai báo của gói (apps/<gói>/seed/demo.yaml, contracts/seed.schema.json),
# để gói không phải viết mã nạp riêng (ADR 0022). Nạp qua cổng như quản trị của từng tenant nhập tay: lấy
# token của tài khoản khai trong tệp, kiểm token đúng tenant, rồi ghi bằng GraphQL với vai trò tenant_admin.
# tenant_id do Hasura gán từ token, nhật ký thay đổi ghi đúng người nạp. Dòng đã có (trùng các cột `key`)
# giữ nguyên, nên chạy lại không tạo bản trùng. `make seed-demo` gọi cho mỗi gói có seed/demo.yaml mà không
# có seed/load.py; `make check-fast` đã kiểm tệp theo schema. Tham số thứ hai là tệp dữ liệu khác cùng
# định dạng, ví dụ dữ liệu demo của một mẫu cài cho tenant của mẫu (scripts/install.sh, ADR 0058).

import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

BASE = os.environ.get("MORTISE_PUBLIC_URL") or "http://localhost:9080"
PASSWORD = os.environ.get("DEMO_USER_PASSWORD")
# Quản trị tenant đọc và ghi toàn tenant; vai trò user có thể chỉ thấy một phần nên không biết dòng nào đã có.
ROLE = "tenant_admin"


def post(path: str, body: bytes, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers)  # noqa: S310
    try:
        # Địa chỉ là cổng của bản cài, lấy từ .env, không từ dữ liệu bên ngoài.
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Cổng từ chối {path} ({error.code}): {error.read()[:300]!r}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Không gọi được cổng tại {BASE} ({error.reason}); kiểm tra `make ps`.") from error


def token(username: str) -> str:
    # Client kiểm thử do `make seed` tạo; quản trị tenant không phải người duyệt nên không cần mã OTP.
    form = {"grant_type": "password", "client_id": "mortise-test", "username": username, "password": PASSWORD}
    body = urllib.parse.urlencode(form).encode()
    return post("/auth/realms/mortise/protocol/openid-connect/token", body, {})["access_token"]


def tenant_of(access: str) -> str:
    payload = access.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return claims["tenant"][0]


def graphql(access: str, query: str, variables: dict, app: str) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json", "X-Hasura-Role": ROLE}
    reply = post("/v1/graphql", body, headers)
    if "errors" in reply:
        message = reply["errors"][0].get("message", "")
        # Bảng không có trong lược đồ GraphQL thường là gói chưa cài; lỗi khác (sai cột, thiếu quyền) báo
        # nguyên văn.
        if "not found in type" in message and "_root" in message:
            hint = f"Gói chưa cài thì chạy `make app-install APP={app}` trước."
            raise SystemExit(f"GraphQL báo lỗi: {message}\n{hint}")
        raise SystemExit(f"GraphQL báo lỗi: {message}")
    return reply["data"]


def existing(access: str, root: str, key: list[str], rows: list[dict], app: str) -> set[tuple]:
    """Giá trị khóa của các dòng trong `rows` đã có; Hasura chỉ trả dòng của tenant trong token."""
    where = {"_or": [{column: {"_eq": row[column]} for column in key} for row in rows]}
    query = f"query($w: {root}_bool_exp!) {{ {root}(where: $w) {{ {' '.join(key)} }} }}"
    found = graphql(access, query, {"w": where}, app)[root]
    return {tuple(row[column] for column in key) for row in found}


def load_table(access: str, schema: str, spec: dict, app: str) -> int:
    root = f"{schema}_{spec['table']}"
    key, rows = spec["key"], spec["rows"]
    for row in rows:
        missing = [column for column in key if column not in row]
        if missing:
            columns = ", ".join(missing)
            raise SystemExit(f"Dữ liệu demo: dòng {row} của {spec['table']} thiếu cột khóa {columns}.")
    have = existing(access, root, key, rows, app)
    new = [row for row in rows if tuple(row[column] for column in key) not in have]
    if new:
        # Một lệnh cho cả bảng: Hasura ghi trong một giao dịch, lỗi giữa chừng không để lại nửa bảng.
        insert = f"insert_{root}(objects: $rows) {{ affected_rows }}"
        graphql(access, f"mutation($rows: [{root}_insert_input!]!) {{ {insert} }}", {"rows": new}, app)
    return len(new)


def load_tenant(app: str, schema: str, tenant: str, spec: dict) -> None:
    access = token(spec["account"])
    # Tài khoản ghi nhầm tenant trong tệp thì dừng, thay vì nạp dữ liệu demo vào tenant khác.
    actual = tenant_of(access)
    if actual != tenant:
        raise SystemExit(f"Dữ liệu demo: tài khoản {spec['account']} thuộc {actual}, không phải {tenant}.")
    added = {table["table"]: load_table(access, schema, table, app) for table in spec["tables"]}
    summary = ", ".join(f"{table} {count}" for table, count in added.items())
    print(f"{app} / {tenant}: thêm {summary} dòng; dòng đã có giữ nguyên")


def read_yaml(path: Path) -> dict:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as error:
        raise SystemExit(f"Không đọc được {path}: {error}") from error


def main() -> int:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Cách dùng: app-seed.py apps/<gói> [<tệp dữ liệu>]; gọi qua `make seed-demo`.")
    if not PASSWORD:
        raise SystemExit("Thiếu DEMO_USER_PASSWORD; chạy qua `make seed-demo`, lệnh này đọc .env.")
    directory = Path(sys.argv[1])
    app = read_yaml(directory / "app.yaml")
    data = Path(sys.argv[2]) if len(sys.argv) == 3 else directory / "seed" / "demo.yaml"
    for tenant, spec in read_yaml(data).items():
        load_tenant(app["id"], app["database"]["schema"], tenant, spec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
