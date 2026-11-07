# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm thử quy tắc quyền của task. Mỗi quy tắc một test, đặt tên theo điều nó bảo vệ.

import pytest

from app.policy import FOUR_EYES, Caller, Denied, TaskView, check_can_complete, check_variables

MANAGER_A = Caller(sub="m-a", username="manager.a", tenant="xuong-a", roles=frozenset({"user", "manager"}))
USER_A = Caller(sub="u-a", username="user.a", tenant="xuong-a", roles=frozenset({"user"}))


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
