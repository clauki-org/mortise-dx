# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm access token lần nữa sau APISIX (phòng thủ nhiều lớp) và rút ra người gọi:
# sub, tenant từ claim `tenant` (group Keycloak), vai trò từ realm_access.roles.
# Token của tài khoản dịch vụ (ADR 0017) không có tenant; tenant đến từ header X-Mortise-Tenant.

import re
from collections.abc import Collection
from typing import Annotated

import jwt
from fastapi import Header

from .config import settings
from .policy import Caller, Denied

_jwks = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=300)

TENANT_HEADER = "X-Mortise-Tenant"
# Cùng mẫu slug với contracts/token-claims.schema.json; tenant thành tenantId của Flowable.
_TENANT = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


def caller_from_token(
    authorization: str | None = Header(default=None),
    tenant: Annotated[
        str | None,
        Header(
            alias=TENANT_HEADER,
            description="Chỉ tài khoản dịch vụ gửi: tenant mà dịch vụ mở quy trình thay (ADR 0017)",
        ),
    ] = None,
) -> Caller:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Denied(401, "Thiếu access token.")
    token = authorization.split(" ", 1)[1]
    try:
        key = _jwks.get_signing_key_from_jwt(token)
        # Client công khai của Keycloak đặt aud là "account", nên không kiểm aud; issuer thì bắt buộc.
        claims = jwt.decode(
            token, key.key, algorithms=["RS256"], issuer=settings.issuer, options={"verify_aud": False}
        )
    except jwt.PyJWTError as error:
        raise Denied(401, f"Access token không hợp lệ: {error}.") from error
    return caller_from_claims(claims, tenant, settings.service_clients)


def caller_from_claims(claims: dict, tenant: str | None, service_clients: Collection[str]) -> Caller:
    # `azp` là client đã xin token. Client dịch vụ chỉ bật client credentials (scripts/seed.sh), nên người
    # dùng không lấy được token mang azp đó; nhận diện bằng vai trò thì vai trò đó thành vai trò chọn được ở
    # Hasura.
    if claims.get("azp") in service_clients:
        return _service(claims, tenant)
    # Người dùng gửi kèm header thì từ chối hẳn, không lặng lẽ bỏ qua: ai thử đổi tenant phải thấy là không
    # được.
    if tenant is not None:
        raise Denied(
            400, f"Chỉ tài khoản dịch vụ được gửi {TENANT_HEADER}; tenant của người dùng lấy từ token."
        )
    tenants = claims.get("tenant") or []
    if len(tenants) != 1:
        raise Denied(403, "Tài khoản phải thuộc đúng một tenant.")
    return Caller(
        sub=claims["sub"],
        username=claims.get("preferred_username", claims["sub"]),
        tenant=tenants[0],
        roles=frozenset(claims.get("realm_access", {}).get("roles", [])),
        methods=frozenset(claims.get("amr") or []),
    )


def _service(claims: dict, tenant: str | None) -> Caller:
    if tenant is None or not _TENANT.fullmatch(tenant):
        raise Denied(400, f"Tài khoản dịch vụ phải gửi {TENANT_HEADER} là mã tenant, ví dụ xa-a.")
    # Không lấy vai trò từ token: tài khoản dịch vụ không được là ứng viên của task nào.
    return Caller(
        sub=claims["sub"],
        username=claims.get("preferred_username", claims["sub"]),
        tenant=tenant,
        roles=frozenset(),
        service=True,
    )
