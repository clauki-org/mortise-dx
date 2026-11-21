# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử quy tắc của lớp đọc NGSI-LD: chỉ chuyển tham số truy vấn đã biết, mã entity đúng dạng.

import pytest

from app.policy import (
    MAX_HISTORY,
    MAX_LIMIT,
    MAX_PARAMETER_LENGTH,
    Denied,
    check_entity_id,
    check_tenant,
    clean_history,
    clean_query,
)


def test_known_parameters_pass_through():
    assert clean_query([("type", "Device"), ("limit", "20")]) == {"type": "Device", "limit": "20"}


@pytest.mark.parametrize("name", ["local", "format", "options", "geoQ", "csf", "NGSILD-Tenant"])
def test_unknown_parameters_are_rejected(name):
    with pytest.raises(Denied) as denied:
        clean_query([(name, "x")])
    assert denied.value.status == 400


def test_repeated_parameter_is_rejected():
    # Hai giá trị cho cùng tham số: không đoán Scorpio dùng giá trị nào.
    with pytest.raises(Denied):
        clean_query([("type", "Device"), ("type", "Room")])


@pytest.mark.parametrize("limit", ["0", "-1", "abc", str(MAX_LIMIT + 1)])
def test_limit_outside_range_is_rejected(limit):
    with pytest.raises(Denied):
        clean_query([("limit", limit)])


def test_entity_id_must_be_an_ngsi_ld_urn():
    check_entity_id("urn:ngsi-ld:Device:kho-01")
    for bad in ["kho-01", "urn:ngsi-ld:", "urn:ngsi-ld:Device/../x", "urn:ngsi-ld:Device:a?b"]:
        with pytest.raises(Denied):
            check_entity_id(bad)


def test_long_query_is_rejected():
    # q và idPattern chạy trên Scorpio dùng chung: một biểu thức quá dài không được tới đó.
    with pytest.raises(Denied):
        clean_query([("idPattern", "a" * (MAX_PARAMETER_LENGTH + 1))])


@pytest.mark.parametrize("offset", ["-1", "abc", "1.5"])
def test_offset_must_be_a_non_negative_integer(offset):
    with pytest.raises(Denied):
        clean_query([("offset", offset)])


def test_tenant_must_be_a_slug():
    check_tenant("xa-a")
    for bad in ["xưởng-a", "Xuong-A", "a b", "a\r\nX: y", ""]:
        with pytest.raises(Denied) as denied:
            check_tenant(bad)
        assert denied.value.status == 403


def test_history_needs_attrs_and_last_n():
    assert clean_history([("attrs", "humidity"), ("lastN", "50")]) == {"attrs": "humidity", "lastN": "50"}
    for params in (
        [("lastN", "5")],
        [("attrs", "humidity")],
        [("attrs", "humidity"), ("lastN", "0")],
        [("attrs", "humidity"), ("lastN", str(MAX_HISTORY + 1))],
    ):
        with pytest.raises(Denied) as denied:
            clean_history(params)
        assert denied.value.status == 400


@pytest.mark.parametrize("name", ["timerel", "timeAt", "options", "local"])
def test_history_rejects_other_parameters(name):
    with pytest.raises(Denied):
        clean_history([("attrs", "humidity"), ("lastN", "5"), (name, "x")])
