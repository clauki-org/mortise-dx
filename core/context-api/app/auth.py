# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm access token lần nữa sau APISIX (phòng thủ nhiều lớp) và rút ra người gọi: sub và
# tenant từ claim `tenant` (group Keycloak). Cùng cách kiểm với workflow-api và files-api; các
# dịch vụ không dùng chung mã vì mỗi dịch vụ đóng gói và triển khai riêng.

import jwt
from fastapi import Header

from .config import settings
from .policy import Caller, Denied, check_tenant

_jwks = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=300)


def caller_from_token(authorization: str | None = Header(default=None)) -> Caller:
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

    tenants = claims.get("tenant") or []
    if len(tenants) != 1:
        raise Denied(403, "Tài khoản phải thuộc đúng một tenant.")
    check_tenant(tenants[0])
    return Caller(sub=claims["sub"], tenant=tenants[0])
