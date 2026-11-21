# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử phần thuần của công cụ kho lạnh: CSV nạp lại vào PostgreSQL phân biệt chuỗi rỗng với NULL (sai thì
# băm tính lại không khớp), tên tệp theo đoạn, câu lệnh chỉ nhận số nguyên, mốc thời gian có múi giờ.

import csv
from datetime import UTC, datetime

import pytest

from app.archive import as_csv
from app.columns import live_rows, object_key
from app.main import anchor_of, cutoff


def test_csv_keeps_empty_string_apart_from_null():
    text = as_csv([(1, "", None, "a,b")]).getvalue()
    assert text.strip() == '"1","",,"a,b"'
    assert next(csv.reader([text.strip()])) == ["1", "", "", "a,b"]


def test_object_key_sorts_by_position_in_the_chain():
    assert object_key(2, 10) < object_key(11, 20)
    assert object_key(1, 5) == "audit_log/000000000001-000000000005.parquet"


def test_live_rows_only_takes_integers():
    assert "id > 7 AND id <= 9" in live_rows(7, 9)
    with pytest.raises(ValueError):
        live_rows("7; DROP TABLE core.audit_log")


def test_cutoff_date_is_utc_midnight_and_time_needs_a_zone():
    assert cutoff("2026-11-01") == datetime(2026, 11, 1, tzinfo=UTC)
    assert cutoff("2026-11-01T07:00:00+07:00") == datetime(2026, 11, 1, tzinfo=UTC)
    with pytest.raises(SystemExit):
        cutoff("2026-11-01T07:00:00")
    with pytest.raises(SystemExit):
        cutoff("hôm qua")


def test_anchor_must_be_id_and_sha256():
    assert anchor_of("12:" + "ab" * 32) == (12, bytes.fromhex("ab" * 32))
    for bad in ["12", "x:" + "ab" * 32, "12:" + "ab" * 31, "12:" + "AB" * 32]:
        with pytest.raises(SystemExit):
            anchor_of(bad)
