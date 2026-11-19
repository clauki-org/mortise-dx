# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nạp dữ liệu demo của gói (demo.yaml) qua cổng, như một cán bộ xã nhập tay: lấy token của tài khoản từng xã
# rồi ghi bằng GraphQL. Gói không đụng thẳng vào CSDL (AGENTS.md), và nhật ký thay đổi ghi đúng người làm của
# từng xã. Cơ sở đã có (trùng mã trong xã) thì bỏ qua cả cây của nó, nên chạy lại không tạo bản trùng.
# Gọi bằng `make seed-demo` sau `make seed` và `make app-install APP=facilities-commune`.

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
DATA = Path(__file__).with_name("demo.yaml")
TABLE = "app_facilities_commune"


def post(path: str, body: bytes, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(f"{BASE}{path}", data=body, headers=headers)  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Cổng từ chối {path} ({error.code}): {error.read()[:300]!r}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Không gọi được cổng tại {BASE} ({error.reason}); kiểm tra `make ps`.") from error


def token(username: str) -> str:
    # Client kiểm thử do `make seed` tạo; tài khoản demo của xã là người dùng thường nên không cần mã OTP.
    form = {"grant_type": "password", "client_id": "mortise-test", "username": username, "password": PASSWORD}
    body = urllib.parse.urlencode(form).encode()
    reply = post("/auth/realms/mortise/protocol/openid-connect/token", body, {})
    return reply["access_token"]


def graphql(access: str, query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    reply = post("/v1/graphql", body, headers)
    if "errors" in reply:
        message = reply["errors"][0].get("message", "")
        # Chỉ khi chính bảng của gói không có trong lược đồ GraphQL; lỗi sai cột hay thiếu quyền báo
        # nguyên văn.
        if f"field '{TABLE}_" in message and "not found in type" in message and "_root" in message:
            raise SystemExit("Gói chưa được cài: chạy `make app-install APP=facilities-commune` trước.")
        raise SystemExit(f"GraphQL báo lỗi: {message}")
    return reply["data"]


def insert(access: str, table: str, row: dict) -> str:
    name = f"{TABLE}_{table}"
    mutation = f"mutation($row: {name}_insert_input!) {{ insert_{name}_one(object: $row) {{ id }} }}"
    return graphql(access, mutation, {"row": row})[f"insert_{name}_one"]["id"]


def codes(access: str, table: str, where: dict) -> dict[str, str]:
    """Mã → id của các dòng đã có trong bảng, theo điều kiện `where` (ví dụ tòa của một cơ sở)."""
    name = f"{TABLE}_{table}"
    query = f"query($w: {name}_bool_exp!) {{ {name}(where: $w) {{ id code }} }}"
    return {row["code"]: row["id"] for row in graphql(access, query, {"w": where})[name]}


def tenant_of(access: str) -> str:
    payload = access.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    return claims["tenant"][0]


def load_tenant(tenant: str, spec: dict) -> int:
    access = token(spec["user"])
    # Tenant thật lấy từ token; tài khoản ghi nhầm xã trong demo.yaml thì dừng thay vì nạp vào xã khác.
    actual = tenant_of(access)
    if actual != tenant:
        raise SystemExit(f"demo.yaml: tài khoản {spec['user']} thuộc {actual}, không phải {tenant}.")
    # Kiểm từng tầng (cơ sở, tòa, phòng) thay vì chỉ cơ sở: lần chạy trước dừng giữa chừng (mất mạng) thì lần
    # sau thêm nốt phần còn thiếu, không để lại cây dở dang.
    added = 0
    facilities = codes(access, "facilities", {})
    for facility in spec["facilities"]:
        facility_id = facilities.get(facility["code"])
        if facility_id is None:
            fields = {k: facility[k] for k in ("code", "name", "address", "status")}
            facility_id, added = insert(access, "facilities", fields), added + 1
        buildings = codes(access, "buildings", {"facility_id": {"_eq": facility_id}})
        for building in facility["buildings"]:
            building_id = buildings.get(building["code"])
            if building_id is None:
                fields = {k: building[k] for k in ("code", "name", "floors")} | {"facility_id": facility_id}
                building_id, added = insert(access, "buildings", fields), added + 1
            rooms = codes(access, "rooms", {"building_id": {"_eq": building_id}})
            for room in building["rooms"]:
                if room["code"] not in rooms:
                    insert(access, "rooms", room | {"building_id": building_id})
                    added += 1
    print(f"{tenant}: thêm {added} dòng (cơ sở, tòa, phòng); phần đã có giữ nguyên")
    return added


def main() -> int:
    if not PASSWORD:
        raise SystemExit("Thiếu DEMO_USER_PASSWORD; chạy qua `make seed-demo`, lệnh này đọc .env.")
    data = yaml.safe_load(DATA.read_text(encoding="utf-8"))
    for tenant, spec in data.items():
        load_tenant(tenant, spec)
    return 0


if __name__ == "__main__":
    sys.exit(main())
