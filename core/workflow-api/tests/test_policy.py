# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử quy tắc quyền của task. Mỗi quy tắc một test, đặt tên theo điều nó bảo vệ.

from dataclasses import replace

import pytest

from app.policy import (
    FOUR_EYES,
    Caller,
    Denied,
    TaskView,
    check_can_complete,
    check_idempotency_key,
    check_variables,
)

MANAGER_A = Caller(
    sub="m-a",
    username="manager.a",
    tenant="xuong-a",
    roles=frozenset({"user", "manager"}),
    methods=frozenset({"pwd", "otp"}),
)
USER_A = Caller(
    sub="u-a", username="user.a", tenant="xuong-a", roles=frozenset({"user"}), methods=frozenset({"pwd"})
)


def review_task(**changes) -> TaskView:
    base = dict(
        tenant="xuong-a",
        assignee=None,
        candidate_groups=frozenset({"manager"}),
        category=FOUR_EYES,
        initiator="u-a",
    )
    return TaskView(**(base | changes))


def test_manager_of_same_tenant_can_complete():
    check_can_complete(MANAGER_A, review_task())


def test_other_tenant_sees_not_found():
    with pytest.raises(Denied) as error:
        check_can_complete(MANAGER_A, review_task(tenant="xuong-b"))
    assert error.value.status == 404


def test_role_outside_candidate_groups_is_denied():
    with pytest.raises(Denied) as error:
        check_can_complete(USER_A, review_task(initiator="someone-else"))
    assert error.value.status == 403


def test_initiator_cannot_approve_own_request():
    with pytest.raises(Denied) as error:
        check_can_complete(MANAGER_A, review_task(initiator="m-a"))
    assert "bốn mắt" in error.value.reason


def test_initiator_may_complete_task_without_four_eyes():
    check_can_complete(MANAGER_A, review_task(initiator="m-a", category=None))


def test_task_assigned_to_someone_else_is_denied():
    with pytest.raises(Denied) as error:
        check_can_complete(MANAGER_A, review_task(assignee="x"))
    assert error.value.status == 403


def test_reserved_variables_are_rejected():
    with pytest.raises(Denied):
        check_variables({"initiator": "fake", "title": "ok"})
    check_variables({"title": "ok", "approved": True})


def test_idempotency_variable_is_reserved():
    with pytest.raises(Denied):
        check_variables({"idempotencyKey": "chosen-by-client"})


def test_uuid_is_a_valid_idempotency_key():
    check_idempotency_key("3f2b8c1e-9a4d-4e7b-8f60-1c2d3e4f5a6b")


@pytest.mark.parametrize("key", ["short", "x" * 101, "có dấu cách", "a/b/c/d/e"])
def test_malformed_idempotency_key_is_rejected(key):
    with pytest.raises(Denied) as error:
        check_idempotency_key(key)
    assert error.value.status == 400


def test_approver_without_second_factor_is_denied():
    password_only = replace(MANAGER_A, methods=frozenset({"pwd"}))
    with pytest.raises(Denied) as denied:
        check_can_complete(password_only, review_task())
    assert denied.value.status == 403
    assert "hai bước" in denied.value.reason


def test_approver_without_second_factor_still_sees_not_found_for_other_tenant():
    # Không lộ việc task của tenant khác tồn tại, kể cả khi người gọi thiếu OTP.
    password_only = replace(MANAGER_A, methods=frozenset({"pwd"}))
    with pytest.raises(Denied) as denied:
        check_can_complete(password_only, review_task(tenant="xuong-b"))
    assert denied.value.status == 404


def test_user_without_approver_role_needs_no_second_factor():
    check_can_complete(USER_A, review_task(candidate_groups=frozenset({"user"}), category=None))
