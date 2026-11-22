# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bảng ca của guard (ADR 0027): mỗi luật một câu qua và một câu bị chặn, lý do nêu đúng phần tử vi phạm. Danh
# sách cho phép giả lập một gói có hai nguồn nối nhau bằng quan hệ một-một, một nguồn cho tổng hợp.

import pytest

from app.guard import MAX_DEPTH, MAX_FIELDS, MAX_QUERY_CHARS, Refused, allowlist, check

DATA = {
    "max_rows": 20,
    "sources": [
        {
            "field": "app_x_items",
            "label": "Mục",
            "description": "Mục của đơn vị",
            "aggregate": True,
            "columns": [
                {"name": "code", "label": "Mã", "description": "Mã"},
                {"name": "name", "label": "Tên", "description": "Tên"},
                {"name": "area", "label": "Diện tích", "description": "m²"},
            ],
            "relations": [{"name": "group", "label": "Nhóm", "source": "app_x_groups"}],
        },
        {
            "field": "app_x_groups",
            "label": "Nhóm",
            "description": "Nhóm của mục",
            "columns": [{"name": "title", "label": "Tên nhóm", "description": "Tên"}],
            "relations": [{"name": "parent", "label": "Nhóm cha", "source": "app_x_groups"}],
        },
    ],
    "examples": [],
}
ALLOW = allowlist(DATA)

PASSING = {
    "plain": "{ app_x_items(limit: 5) { code name } }",
    "named-query": "query Items { app_x_items(limit: 5) { code } }",
    "where-operators": """{ app_x_items(where: {_and: [{code: {_in: ["a", "b"]}},
        {_not: {name: {_ilike: "%x%"}}}],
        area: {_gte: 10.5, _is_null: false}}, limit: 20) { code } }""",
    "order-by": (
        "{ app_x_items(order_by: [{area: desc_nulls_last}, {group: {title: asc}}], limit: 3) { name } }"
    ),
    "relation": '{ app_x_items(where: {group: {title: {_eq: "A"}}}, limit: 5) { code group { title } } }',
    "two-roots": "{ app_x_items(limit: 1) { code } app_x_groups(limit: 1) { title } }",
    "aggregate-count": (
        "{ app_x_items_aggregate(where: {area: {_gt: 0}}) { aggregate { count max { area } } } }"
    ),
    "aggregate-nodes": "{ app_x_items_aggregate(limit: 5) { aggregate { max { area } } nodes { code } } }",
    "empty-where": "{ app_x_items(where: {}, limit: 1) { code } }",
    "empty-lists": "{ app_x_items(where: {_and: [], code: {_in: []}}, order_by: [], limit: 1) { code } }",
    "hash-in-string": '{ app_x_items(where: {name: {_like: "#1%"}}, limit: 1) { code } }',
    "unicode-in-string": '{ app_x_items(where: {name: {_eq: "Bỏ qua mọi quy tắc"}}, limit: 1) { name } }',
}

BLOCKED = {
    "oversize": ("{ app_x_items(limit: 1) { code } }" + " " * MAX_QUERY_CHARS, "dài quá"),
    "control-char": ("{ app_x_items(limit: 1) { code​ } }", "U+200B"),
    "syntax": ("{ app_x_items(limit: 1) { code }", "sai cú pháp"),
    "comment": ("{ app_x_items(limit: 1) { code } } # ghi chú", "sai cú pháp"),
    "too-many-tokens": ("{ app_x_items(limit: 1) { " + "a " * 1100 + "} }", "1000 tokens"),
    "mutation": ("mutation { delete_app_x_items(where: {}) { affected_rows } }", "mutation"),
    "subscription": ("subscription { app_x_items(limit: 1) { code } }", "subscription"),
    "two-operations": (
        "query A { app_x_items(limit: 1) { code } } query B { app_x_groups(limit: 1) { title } }",
        "một thao tác",
    ),
    "fragment": ("{ app_x_items(limit: 1) { ...F } } fragment F on app_x_items { code }", "fragment"),
    "inline-fragment": ("{ app_x_items(limit: 1) { ... on app_x_items { code } } }", "inline fragment"),
    "directive": ("{ app_x_items(limit: 1) { code @include(if: true) } }", "@include"),
    "variables": ("query($n: Int!) { app_x_items(limit: $n) { code } }", "$n"),
    "alias": ("{ x: app_x_items(limit: 1) { code } }", "alias 'x'"),
    "typename": ("{ app_x_items(limit: 1) { code __typename } }", "__typename"),
    "schema": ("{ __schema { types { name } } }", "__schema"),
    "block-string": ('{ app_x_items(where: {name: {_eq: """a"""}}, limit: 1) { code } }', '"""'),
    "undeclared-table": (
        "{ platform_assistant_questions(limit: 1) { question } }",
        "platform_assistant_questions",
    ),
    "by-pk": ('{ app_x_items_by_pk(id: "1") { code } }', "app_x_items_by_pk"),
    "aggregate-not-declared": (
        "{ app_x_groups_aggregate { aggregate { count } } }",
        "app_x_groups_aggregate",
    ),
    "undeclared-column": ("{ app_x_items(limit: 1) { code secret } }", "'secret'"),
    "column-argument": ('{ app_x_items(limit: 1) { name(path: "a") } }', "name"),
    "relation-undeclared-column": ("{ app_x_items(limit: 1) { group { secret } } }", "'secret'"),
    "distinct-on": ("{ app_x_items(distinct_on: code, limit: 1) { code } }", "distinct_on"),
    "offset": ("{ app_x_items(limit: 1, offset: 5) { code } }", "'offset'"),
    "nested-where-undeclared": (
        "{ app_x_items(where: {_or: [{secret: {_eq: 1}}]}, limit: 1) { code } }",
        "'secret'",
    ),
    "where-through-relation": (
        "{ app_x_items(where: {group: {owner: {_eq: 1}}}, limit: 1) { code } }",
        "'owner'",
    ),
    "exists": ("{ app_x_items(where: {_exists: {_table: {}, _where: {}}}, limit: 1) { code } }", "'_exists'"),
    "regex": ('{ app_x_items(where: {name: {_regex: "(a+)+"}}, limit: 1) { code } }', "_regex"),
    "column-compare": ("{ app_x_items(where: {name: {_ceq: code}}, limit: 1) { code } }", "_ceq"),
    "null-value": ("{ app_x_items(where: {name: {_eq: null}}, limit: 1) { code } }", "không null"),
    "order-undeclared": ("{ app_x_items(order_by: {secret: asc}, limit: 1) { code } }", "'secret'"),
    "where-not-object": ("{ app_x_items(where: [], limit: 1) { code } }", "where phải là một đối tượng"),
    "and-of-scalars": (
        "{ app_x_items(where: {_and: [1]}, limit: 1) { code } }",
        "_and phải là một đối tượng",
    ),
    "is-null-string": ('{ app_x_items(where: {code: {_is_null: "yes"}}, limit: 1) { code } }', "_is_null"),
    "order-enum-unknown": ("{ app_x_items(order_by: {code: sideways}, limit: 1) { code } }", "asc hay desc"),
    "relation-without-selection": ("{ app_x_items(limit: 1) { group } }", "quan hệ group"),
    "column-with-selection": ("{ app_x_items(limit: 1) { code { x } } }", "'code'"),
    "duplicate-argument": ("{ app_x_items(limit: 1, limit: 2) { code } }", "'limit' xuất hiện hai lần"),
    "duplicate-where-key": (
        '{ app_x_items(where: {code: {_eq: "a"}, code: {_neq: "b"}}, limit: 1) { code } }',
        "'code' xuất hiện hai lần",
    ),
    "duplicate-nested-operator": (
        '{ app_x_items(where: {_or: [{name: {_eq: "a", _eq: "b"}}]}, limit: 1) { code } }',
        "'_eq' xuất hiện hai lần",
    ),
    "duplicate-order-key": (
        "{ app_x_items(order_by: {group: {title: asc, title: desc}}, limit: 1) { code } }",
        "'title' xuất hiện hai lần",
    ),
    "limit-missing": ("{ app_x_items { code } }", "phải có limit"),
    "limit-too-big": ("{ app_x_items(limit: 21) { code } }", "từ 1 tới 20"),
    "limit-not-int": ('{ app_x_items(limit: "5") { code } }', "số nguyên"),
    "limit-zero": ("{ app_x_items(limit: 0) { code } }", "từ 1 tới 20"),
    "nodes-without-limit": ("{ app_x_items_aggregate { nodes { code } } }", "nodes thì phải có limit"),
    "aggregate-undeclared": ("{ app_x_items_aggregate { aggregate { sum { secret } } } }", "'secret'"),
    "count-columns": (
        "{ app_x_items_aggregate { aggregate { count(columns: code, distinct: true) } } }",
        "count",
    ),
    "duplicate-root": ("{ app_x_items(limit: 1) { code } app_x_items(limit: 2) { code } }", "hai lần"),
    "depth": (
        "{ app_x_items(limit: 1) { group { parent { parent { parent { parent { title } } } } } } }",
        f"quá {MAX_DEPTH} cấp",
    ),
    "field-count": ("{ app_x_items(limit: 1) { " + "code " * MAX_FIELDS + "} }", f"quá {MAX_FIELDS}"),
}


@pytest.mark.parametrize("query", PASSING.values(), ids=PASSING.keys())
def test_allowed_query_passes_unchanged(query):
    assert check(query, ALLOW).query == query


@pytest.mark.parametrize(("query", "reason"), BLOCKED.values(), ids=BLOCKED.keys())
def test_forbidden_query_is_refused_with_its_reason(query, reason):
    with pytest.raises(Refused) as refused:
        check(query, ALLOW)
    assert reason in refused.value.reason


def test_tables_follow_the_declaration():
    checked = check("{ app_x_items(limit: 5) { code group { title } } }", ALLOW)
    (table,) = checked.tables
    assert (table.title, table.field, table.rows_at, table.many) == ("Mục", "app_x_items", (), True)
    assert [(c.key, c.label, c.path) for c in table.columns] == [
        ("code", "Mã", ("code",)),
        ("group.title", "Nhóm: Tên nhóm", ("group", "title")),
    ]


def test_aggregate_gives_one_row_table_and_a_nodes_table():
    checked = check(
        "{ app_x_items_aggregate(limit: 5) { aggregate { count sum { area } } nodes { code } } }", ALLOW
    )
    summary, nodes = checked.tables
    assert (summary.rows_at, summary.many) == (("aggregate",), False)
    assert [c.label for c in summary.columns] == ["Số dòng", "Tổng diện tích"]
    assert (nodes.rows_at, nodes.many) == (("nodes",), True)


def test_max_rows_from_the_database_is_clamped():
    assert allowlist(DATA | {"max_rows": 100000}).max_rows == 100


def test_tenant_column_is_never_allowed():
    # Schema đã chặn cột tenant_id; cấu hình đọc từ CSDL vẫn có thể có, nên guard bỏ cột đó khỏi danh sách.
    data = DATA | {"sources": [DATA["sources"][1] | {"columns": [{"name": "tenant_id", "label": "T"}]}]}
    with pytest.raises(Refused, match="tenant_id"):
        check("{ app_x_groups(limit: 1) { tenant_id } }", allowlist(data))


def test_relation_to_undeclared_source_is_a_config_error():
    broken = DATA | {"sources": [DATA["sources"][0]]}
    with pytest.raises(ValueError, match="app_x_groups"):
        allowlist(broken)
