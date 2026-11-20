# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Ghi số đo vào Scorpio (ADR 0012). upsert với options=update: thuộc tính có trong tin thì thay, thuộc
# tính khác của entity giữ nguyên, nên thiết bị gửi từng số đo riêng không làm mất số đo kia.
# Đọc lịch sử một số đo qua API temporal của Scorpio để xét luật ngưỡng (watch.py).

from datetime import datetime

import httpx

from .rules import Sample


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

    def history(self, tenant: str, entity_id: str, attribute: str, last: int) -> list[Sample]:
        """`last` lần đo mới nhất của một thuộc tính; entity hay thuộc tính chưa có lịch sử thì rỗng."""
        try:
            response = self._client.get(
                f"/temporal/entities/{entity_id}",
                params={"attrs": attribute, "lastN": last},
                headers={"NGSILD-Tenant": tenant, "Accept": "application/json"},
            )
        except httpx.HTTPError as error:
            raise Unavailable(f"không kết nối được Scorpio: {error}") from error
        if response.status_code == 404:
            return []
        if not response.is_success:
            raise Unavailable(f"Scorpio trả {response.status_code}: {response.text[:300]}")
        # Một lần đo thì Scorpio trả một đối tượng, nhiều lần đo thì trả danh sách.
        found = response.json().get(attribute) or []
        instances = found if isinstance(found, list) else [found]
        return [
            Sample(datetime.fromisoformat(item["observedAt"]), item.get("value"))
            for item in instances
            if "observedAt" in item
        ]
