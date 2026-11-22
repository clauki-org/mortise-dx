# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử bảng phân cấp thẩm quyền (ADR 0028): tìm bước đọc bảng trong BPMN, chọn dòng theo biến của hồ sơ,
# và nhóm ứng viên của dòng cấp tenant cha. Quy trình mẫu của lõi đọc từ core/workflow/fixtures.

from pathlib import Path

import pytest

from app.authority import PARENT, Row, authority_steps, group, pick

FIXTURE = Path(__file__).parents[2] / "workflow" / "fixtures" / "core-authority.bpmn20.xml"

ROOT = Row("default", None, None, "manager")
LARGE = Row("large", "amount", 1000.0, "tenant_admin")
HUGE = Row("huge", "amount", 5000.0, "director")
ROWS = [ROOT, LARGE, HUGE]


def bpmn(tasks: str, key: str = "p") -> bytes:
    return (
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" '
        'xmlns:flowable="http://flowable.org/bpmn">'
        f'<process id="{key}">{tasks}</process></definitions>'
    ).encode()


def test_core_fixture_reads_its_decide_step_from_the_table():
    assert authority_steps(FIXTURE.read_bytes(), "core-authority") == {"decide"}


def test_literal_roles_are_not_authority_steps():
    assert authority_steps(bpmn('<userTask id="t" flowable:candidateGroups="manager"/>'), "p") == frozenset()


def test_candidate_users_count_too():
    tasks = '<userTask id="t" flowable:candidateUsers="${authority_t}"/>'
    assert authority_steps(bpmn(tasks), "p") == {"t"}


def test_only_the_requested_process_is_scanned():
    other = b'<process id="q"><userTask id="t" flowable:candidateGroups="${authority_t}"/></process>'
    content = bpmn('<userTask id="u"/>').replace(b"</definitions>", other + b"</definitions>")
    assert authority_steps(content, "p") == frozenset()
    assert authority_steps(content, "q") == {"t"}


@pytest.mark.parametrize(("content", "key"), [(b"<definitions", "p"), (bpmn("<userTask id='t'/>"), "x")])
def test_unreadable_bpmn_is_an_error(content, key):
    with pytest.raises(ValueError):
        authority_steps(content, key)


@pytest.mark.parametrize(
    ("amount", "rule"),
    [(0, "default"), (1000, "default"), (1000.5, "large"), (5000, "large"), (5001, "huge")],
)
def test_highest_threshold_strictly_exceeded_wins(amount, rule):
    assert pick(ROWS, {"amount": amount}, None).rule == rule


@pytest.mark.parametrize(
    "variables",
    [{}, {"amount": None}, {"amount": "9000"}, {"amount": -1}, {"amount": float("nan")}, {"amount": True}],
)
def test_unusable_amount_goes_to_the_strictest_row(variables):
    # Người lập bỏ trống hay gửi sai biến thì không né được người có thẩm quyền cao nhất.
    assert pick(ROWS, variables, None).rule == "huge"


def test_root_row_alone_applies_whatever_the_variables():
    assert pick([ROOT], {}, None) == ROOT


def test_parent_rows_are_skipped_without_a_parent():
    province = Row("province", "amount", 2000.0, "manager", PARENT)
    assert pick([ROOT, LARGE, province], {"amount": 3000}, None) == LARGE
    assert pick([ROOT, LARGE, province], {"amount": 3000}, "tinh-mau") == province


def test_no_rows_means_no_choice():
    assert pick([], {"amount": 10}, None) is None


def test_equal_thresholds_choose_the_same_row_every_time():
    twin = Row("a-twin", "amount", 1000.0, "manager")
    assert pick([twin, ROOT, LARGE], {"amount": 2000}, None) == LARGE
    assert pick([LARGE, ROOT, twin], {"amount": 2000}, None) == LARGE


def test_parent_row_becomes_a_group_of_the_parent_tenant():
    province = Row("province", "amount", 2000.0, "manager", PARENT)
    assert group(province, "tinh-mau") == "tinh-mau/manager"
    assert group(LARGE, "tinh-mau") == "tenant_admin"
