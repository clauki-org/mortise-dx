# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Mở hồ sơ qua workflow-api bằng tài khoản dịch vụ mortise-iot-bridge (ADR 0017): lấy token bằng client
# credentials, gửi tenant ở header X-Mortise-Tenant. Chống mở trùng nằm ở workflow-api: cùng Idempotency-Key
# khi hồ sơ cũ còn mở thì nhận lại hồ sơ đó.

import time
from collections.abc import Callable

import httpx

# Lấy token mới trước khi token cũ hết hạn chừng này giây, để yêu cầu không mang token hết hạn giữa đường.
EARLY_REFRESH_SECONDS = 30


class CaseError(RuntimeError):
    pass


class Cases:
    def __init__(
        self,
        token_url: str,
        client_id: str,
        client_secret: str,
        workflow_url: str,
        client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._token_url = token_url
        self._credentials = {"grant_type": "client_credentials", "client_id": client_id}
        self._secret = client_secret
        self._workflow_url = workflow_url
        self._client = client or httpx.Client(timeout=5)
        self._clock = clock
        self._token: tuple[str, float] | None = None

    def open(self, tenant: str, process: str, key: str, variables: dict[str, object]) -> str:
        """Id hồ sơ đã mở, hay hồ sơ còn mở có cùng key."""
        try:
            response = self._client.post(
                f"{self._workflow_url}/v1/workflow/processes/{process}/instances",
                json={"variables": variables},
                headers={
                    "Authorization": f"Bearer {self._access_token()}",
                    "X-Mortise-Tenant": tenant,
                    "Idempotency-Key": key,
                },
            )
        except httpx.HTTPError as error:
            raise CaseError(f"không kết nối được workflow-api: {error}") from error
        if response.status_code != 201:
            raise CaseError(f"workflow-api trả {response.status_code}: {response.text[:300]}")
        return response.json()["id"]

    def _access_token(self) -> str:
        now = self._clock()
        if self._token and self._token[1] > now:
            return self._token[0]
        try:
            response = self._client.post(
                self._token_url, data=self._credentials | {"client_secret": self._secret}
            )
        except httpx.HTTPError as error:
            raise CaseError(f"không kết nối được Keycloak: {error}") from error
        if response.status_code != 200:
            raise CaseError(
                f"Keycloak từ chối cấp token cho tài khoản dịch vụ ({response.status_code}); "
                "kiểm IOT_BRIDGE_CLIENT_SECRET trong .env và chạy lại make seed"
            )
        body = response.json()
        self._token = (body["access_token"], now + body["expires_in"] - EARLY_REFRESH_SECONDS)
        return self._token[0]
