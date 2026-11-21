# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm access token lần nữa sau APISIX và giữ nguyên token để đọc văn bản qua GraphQL thay cho người hỏi (ADR
# 0021): Hasura lọc đoạn theo tenant của chính token đó, dịch vụ không có quyền đọc dữ liệu nào của riêng nó.
# Cùng cách kiểm với các dịch vụ của lõi; không dùng chung mã vì mỗi dịch vụ đóng gói và triển khai riêng.

import re

import jwt
from fastapi import Header

from .config import settings
from .errors import Denied
from .retrieval import Caller

_jwks = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=300)
_TENANT = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


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
    if len(tenants) != 1 or not _TENANT.fullmatch(tenants[0]):
        raise Denied(403, "Tài khoản phải thuộc đúng một tenant.")
    return Caller(sub=claims["sub"], tenant=tenants[0], token=token)
