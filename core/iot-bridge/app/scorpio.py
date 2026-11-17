# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Ghi số đo vào Scorpio (ADR 0012). upsert với options=update: thuộc tính có trong tin thì thay, thuộc
# tính khác của entity giữ nguyên, nên thiết bị gửi từng số đo riêng không làm mất số đo kia.

import httpx


class Unavailable(RuntimeError):
    pass


class Scorpio:
    def __init__(self, base_url: str, client: httpx.Client | None = None):
        self._client = client or httpx.Client(base_url=f"{base_url}/ngsi-ld/v1", timeout=10)

    def upsert(self, tenant: str, entity: dict) -> None:
        try:
            response = self._client.post(
                "/entityOperations/upsert",
                params={"options": "update"},
                json=[entity],
                headers={"NGSILD-Tenant": tenant, "Content-Type": "application/json"},
            )
        except httpx.HTTPError as error:
            raise Unavailable(f"không kết nối được Scorpio: {error}") from error
        # 207: lô được nhận nhưng có entity bị từ chối (chi tiết trong "errors"); với một entity là ghi hỏng.
        if not response.is_success or response.status_code == 207:
            raise Unavailable(f"Scorpio trả {response.status_code}: {response.text[:300]}")
