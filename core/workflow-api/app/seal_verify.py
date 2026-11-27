# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm niêm phong (ADR 0053), chạy trong container workflow-api (scripts/seal-verify.sh, `make seal-verify`):
# với mỗi dòng của core.case_seals, dựng lại bản JSON chuẩn từ lịch sử Flowable bằng đúng hàm lúc niêm phong
# (sealing.case_digest) và so băm. In mỗi hồ sơ lệch một dòng, bắt đầu bằng mã hồ sơ; thoát 1 nếu có hồ sơ
# lệch.

import sys

from . import db, sealing
from .policy import Denied
from .seal import VERSION


def problem(case: str, version: int, expected: str) -> str | None:
    """Lý do hồ sơ `case` không khớp băm đã niêm phong, hay None nếu khớp."""
    if version != VERSION:
        return f"phiên bản {version} của cách dựng bản JSON không còn trong workflow-api (đang là {VERSION})"
    built = sealing.case_digest(case)
    if built is None:
        # Gỡ gói xóa lịch sử của quy trình trong Flowable (cascade); xóa lịch sử là mất bằng chứng, nên vẫn
        # báo.
        return "Flowable không còn lịch sử của hồ sơ này"
    if built[1].hex() != expected:
        return "lịch sử trong Flowable khác lúc niêm phong: biến của bước, bước hay kết quả đã bị sửa"
    return None


def main() -> int:
    try:
        rows = db.seals()
        found = [
            (case, tenant, process, reason)
            for case, tenant, process, version, expected in rows
            if (reason := problem(case, version, expected)) is not None
        ]
    except Denied as error:
        print(f"seal-verify: {error.reason}", file=sys.stderr)
        return 2
    for case, tenant, process, reason in found:
        print(f"{case} ({tenant}, {process}): {reason}", file=sys.stderr)
    if found:
        print(f"seal-verify: {len(found)}/{len(rows)} hồ sơ không khớp niêm phong", file=sys.stderr)
        return 1
    print(f"seal-verify: {len(rows)} hồ sơ đã niêm phong, mọi băm khớp lịch sử Flowable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
