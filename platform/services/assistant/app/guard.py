# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Guard của trợ lý hỏi dữ liệu (ADR 0027): kiểm một câu GraphQL trên cây cú pháp trước khi chạy qua Hasura
# bằng token người hỏi. Hasura cho vai trò `user` ghi vào một số bảng của gói, nên guard là lớp duy nhất chặn
# câu ghi; mọi thứ không được cho phép rõ ràng đều bị từ chối. Guard không xét quyền theo dòng (Hasura làm) và
# không sửa câu: câu chạy đúng là câu người hỏi thấy. Hàm thuần, chỉ dùng thư viện chuẩn và graphql-core,
# không import app.config (dừng khi thiếu biến môi trường), để scripts/check-assistant-data.py dùng chung khi
# cài gói.

import unicodedata
from dataclasses import dataclass

from graphql import GraphQLSyntaxError, parse
from graphql.language import ast
from graphql.language.visitor import Visitor, visit

# Giới hạn là một phần của hợp đồng: câu mẫu của gói phải qua đúng các giới hạn mà dịch vụ dùng lúc chạy. Đây
# là điểm xuất phát, chưa đo; nới thì nới ở đây và trong contracts/assistant.schema.json (maxLength của
# query).
MAX_QUERY_CHARS = 4000
MAX_TOKENS = 1000
MAX_DEPTH = 5
MAX_FIELDS = 60
MAX_ARGUMENT_DEPTH = 8
HARD_MAX_ROWS = 100

# Toán tử so sánh được nhận. Không có _regex, _iregex, _similar (biểu thức chính quy có thể chạy rất lâu),
# không có toán tử jsonb hay so sánh giữa hai cột (_ceq...): câu hỏi về dữ liệu cần bằng, khác, lớn nhỏ, trong
# danh sách, trống và tìm chuỗi; mỗi toán tử thêm vào là một cách nữa phải kiểm.
OPERATORS = {"_eq", "_neq", "_gt", "_gte", "_lt", "_lte", "_in", "_nin", "_is_null", "_like", "_ilike"}
ORDER = {"asc", "desc", "asc_nulls_first", "asc_nulls_last", "desc_nulls_first", "desc_nulls_last"}
TABLE_ARGUMENTS = {"where", "order_by", "limit"}
AGGREGATES = {"sum": "Tổng", "avg": "Trung bình", "max": "Lớn nhất", "min": "Nhỏ nhất"}
SCALARS = (ast.IntValueNode, ast.FloatValueNode, ast.StringValueNode, ast.BooleanValueNode)


class Refused(Exception):
    """Lý do từ chối bằng tiếng Việt, nêu đúng phần tử vi phạm; hiện được cho người hỏi."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Relation:
    name: str
    label: str
    source: str


@dataclass(frozen=True)
class Source:
    field: str
    label: str
    columns: dict[str, str]
    aggregate: bool
    relations: dict[str, Relation]


@dataclass(frozen=True)
class Allowlist:
    sources: dict[str, Source]
    max_rows: int


@dataclass(frozen=True)
class Cell:
    key: str
    label: str
    path: tuple[str, ...]


@dataclass(frozen=True)
class Table:
    """Một bảng kết quả: `field` là khóa trong data của Hasura, `rows_at` là đường tới dòng dưới khóa đó."""

    title: str
    field: str
    rows_at: tuple[str, ...]
    many: bool
    columns: tuple[Cell, ...]


@dataclass(frozen=True)
class Checked:
    query: str
    tables: tuple[Table, ...]


def allowlist(data: dict) -> Allowlist:
    """Danh sách cho phép từ mục `data` của cấu hình trợ lý (contracts/assistant.schema.json).

    Cấu hình đọc từ CSDL là dữ liệu: trần số dòng bị kẹp lại ở đây, quan hệ trỏ tới nguồn không khai là lỗi.
    """
    sources = {}
    for raw in data["sources"]:
        relations = {
            r["name"]: Relation(r["name"], r["label"], r["source"]) for r in raw.get("relations", [])
        }
        columns = {c["name"]: c["label"] for c in raw["columns"] if c["name"] != "tenant_id"}
        sources[raw["field"]] = Source(
            raw["field"], raw["label"], columns, raw.get("aggregate", False), relations
        )
    for source in sources.values():
        for relation in source.relations.values():
            if relation.source not in sources:
                raise ValueError(
                    f"quan hệ {source.field}.{relation.name} trỏ tới {relation.source}, nguồn không khai"
                )
    return Allowlist(sources, max(1, min(int(data["max_rows"]), HARD_MAX_ROWS)))


def check(query: str, allow: Allowlist) -> Checked:
    """Kiểm theo thứ tự rẻ trước: độ dài, ký tự, cú pháp, một thao tác query, phần tử cấm, rồi từng trường."""
    if len(query) > MAX_QUERY_CHARS:
        raise Refused(f"Câu truy vấn dài quá {MAX_QUERY_CHARS} ký tự.")
    _characters(query)
    try:
        # Không chú thích và không khối chuỗi """: hai trình phân tích (ở đây và ở Hasura) càng ít chỗ hiểu
        # khác nhau càng tốt, vì guard kiểm cây của graphql-core còn Hasura chạy cây của chính nó.
        document = parse(query, max_tokens=MAX_TOKENS, max_comments=0, allow_empty_selection_sets=False)
    except GraphQLSyntaxError as error:
        raise Refused(f"Câu truy vấn sai cú pháp GraphQL: {error.message}") from error
    operation = _single_query(document)
    counter = _Forbidden()
    visit(document, counter)
    if counter.fields > MAX_FIELDS:
        raise Refused(f"Câu truy vấn có {counter.fields} trường, quá {MAX_FIELDS}.")
    tables: list[Table] = []
    for field in _unique(operation.selection_set, "thao tác query"):
        tables += _root(field, allow)
    return Checked(query, tuple(tables))


def _characters(query: str) -> None:
    for char in query:
        # Ký tự điều khiển, ký tự định dạng vô hình (BOM, zero-width) và ngắt dòng Unicode: GraphQL bỏ qua vài
        # ký tự trong số này, một trình phân tích khác có thể không; chặn hết để không có câu hai trình hiểu
        # khác nhau.
        if char in "\t\n\r":
            continue
        if unicodedata.category(char) in {"Cc", "Cf", "Zl", "Zp"}:
            raise Refused(f"Câu truy vấn chứa ký tự điều khiển hay vô hình (U+{ord(char):04X}).")


def _single_query(document: ast.DocumentNode) -> ast.OperationDefinitionNode:
    definitions = document.definitions
    if any(isinstance(d, ast.FragmentDefinitionNode) for d in definitions):
        raise Refused("Câu truy vấn không được dùng fragment.")
    if len(definitions) != 1 or not isinstance(definitions[0], ast.OperationDefinitionNode):
        raise Refused("Câu truy vấn phải có đúng một thao tác.")
    operation = definitions[0]
    if operation.operation != ast.OperationType.QUERY:
        raise Refused(f"Chỉ chạy câu đọc dữ liệu (query); câu này là {operation.operation.value}.")
    return operation


class _Forbidden(Visitor):
    """Phần tử bị cấm ở bất kỳ đâu trong cây; đếm trường để chặn câu quá lớn."""

    def __init__(self):
        super().__init__()
        self.fields = 0

    def enter_field(self, node: ast.FieldNode, *_):
        self.fields += 1
        if node.alias:
            raise Refused(f"Câu truy vấn không được đặt bí danh (alias '{node.alias.value}').")
        _not_internal(node.name.value)

    def enter_argument(self, node: ast.ArgumentNode, *_):
        _not_internal(node.name.value)

    def enter_object_field(self, node: ast.ObjectFieldNode, *_):
        _not_internal(node.name.value)

    def enter_directive(self, node: ast.DirectiveNode, *_):
        raise Refused(f"Câu truy vấn không được dùng directive (@{node.name.value}).")

    def enter_variable_definition(self, node: ast.VariableDefinitionNode, *_):
        raise Refused(
            f"Câu truy vấn không được khai biến (${node.variable.name.value}); viết giá trị trực tiếp."
        )

    def enter_variable(self, node: ast.VariableNode, *_):
        raise Refused(f"Câu truy vấn không được dùng biến (${node.name.value}); viết giá trị trực tiếp.")

    def enter_fragment_spread(self, node: ast.FragmentSpreadNode, *_):
        raise Refused(f"Câu truy vấn không được dùng fragment ({node.name.value}).")

    def enter_inline_fragment(self, *_):
        raise Refused("Câu truy vấn không được dùng inline fragment (... on).")

    def enter_string_value(self, node: ast.StringValueNode, *_):
        if node.block:
            raise Refused('Câu truy vấn không được dùng khối chuỗi """; dùng chuỗi trong một cặp ngoặc kép.')


def _not_internal(name: str) -> None:
    # __schema, __type, __typename: introspection mô tả cả những bảng và thao tác ghi mà người hỏi có quyền.
    if name.startswith("__"):
        raise Refused(f"Câu truy vấn không được dùng tên bắt đầu bằng __ ({name}).")


def _unique(selection_set: ast.SelectionSetNode, where: str) -> list[ast.FieldNode]:
    # Sau _Forbidden, mọi lựa chọn đều là trường. Trùng tên thì GraphQL gộp hai lựa chọn, bảng kết quả khó
    # đoán.
    fields = [selection for selection in selection_set.selections if isinstance(selection, ast.FieldNode)]
    names = [field.name.value for field in fields]
    for name in names:
        if names.count(name) > 1:
            raise Refused(f"Trường '{name}' xuất hiện hai lần trong {where}.")
    return fields


def _root(field: ast.FieldNode, allow: Allowlist) -> list[Table]:
    name = field.name.value
    if name in allow.sources:
        source = allow.sources[name]
        limit = _table_arguments(field, source, allow)
        if limit is None:
            raise Refused(f"{name} phải có limit, tối đa {allow.max_rows} dòng.")
        selection = _selection(field, f"trường {name}")
        return [Table(source.label, name, (), True, _cells(selection, source, allow, 2, (), ""))]
    base = name.removesuffix("_aggregate")
    if base != name and base in allow.sources and allow.sources[base].aggregate:
        return _aggregate(field, allow.sources[base], allow)
    if name.endswith("_by_pk"):
        raise Refused(
            f"Không dùng được {name}: chọn dòng theo khóa chính không nằm trong danh sách cho phép."
        )
    raise Refused(f"Trường gốc '{name}' không nằm trong danh sách bảng gói khai cho trợ lý.")


def _selection(field: ast.FieldNode, where: str) -> ast.SelectionSetNode:
    if field.selection_set is None:
        raise Refused(f"{where} phải chọn ít nhất một cột.")
    return field.selection_set


def _table_arguments(field: ast.FieldNode, source: Source, allow: Allowlist) -> int | None:
    limit = None
    for argument in field.arguments or ():
        name, value = argument.name.value, argument.value
        if name == "distinct_on":
            raise Refused(f"{field.name.value} không được dùng distinct_on.")
        if name not in TABLE_ARGUMENTS:
            raise Refused(f"{field.name.value} chỉ nhận where, order_by, limit; không nhận '{name}'.")
        if name == "limit":
            limit = _limit(value, field.name.value, allow.max_rows)
        elif name == "where":
            _where(_object(value, "where"), source, allow, 1)
        else:
            _order_by(value, source, allow, 1)
    return limit


def _limit(value: ast.ValueNode, field: str, max_rows: int) -> int:
    if not isinstance(value, ast.IntValueNode) or not 1 <= int(value.value) <= max_rows:
        raise Refused(f"limit của {field} phải là số nguyên từ 1 tới {max_rows}.")
    return int(value.value)


def _object(value: ast.ValueNode, where: str) -> ast.ObjectValueNode:
    if not isinstance(value, ast.ObjectValueNode):
        raise Refused(f"{where} phải là một đối tượng {{...}}.")
    return value


def _deep(depth: int) -> None:
    if depth > MAX_ARGUMENT_DEPTH:
        raise Refused(f"Điều kiện lồng quá {MAX_ARGUMENT_DEPTH} cấp.")


def _items(value: ast.ValueNode) -> list[ast.ValueNode]:
    # GraphQL nhận một giá trị đơn ở chỗ cần danh sách và tự bọc thành danh sách một phần tử.
    return list(value.values) if isinstance(value, ast.ListValueNode) else [value]


def _where(node: ast.ObjectValueNode, source: Source, allow: Allowlist, depth: int) -> None:
    _deep(depth)
    for item in node.fields:
        key, value = item.name.value, item.value
        if key in ("_and", "_or"):
            for part in _items(value):
                _where(_object(part, key), source, allow, depth + 1)
        elif key == "_not":
            _where(_object(value, key), source, allow, depth + 1)
        elif key in source.columns:
            _comparison(_object(value, f"điều kiện của {key}"), key)
        elif key in source.relations:
            target = allow.sources[source.relations[key].source]
            _where(_object(value, key), target, allow, depth + 1)
        else:
            raise Refused(
                f"where không được lọc theo '{key}': không phải cột hay quan hệ {source.field} khai."
            )


def _comparison(node: ast.ObjectValueNode, column: str) -> None:
    for item in node.fields:
        operator, value = item.name.value, item.value
        if operator not in OPERATORS:
            raise Refused(f"Toán tử '{operator}' ở cột {column} không được phép.")
        values = _items(value) if operator in ("_in", "_nin") else [value]
        if operator == "_is_null":
            ok = isinstance(value, ast.BooleanValueNode)
        else:
            ok = all(isinstance(v, SCALARS) for v in values)
        # null bị chặn: với Hasura, `_eq: null` có thể bỏ hẳn điều kiện thay vì lọc dòng trống; dùng _is_null.
        if not ok:
            raise Refused(
                f"Giá trị của {operator} ở cột {column} phải là số, chuỗi hay true/false, không null."
            )


def _order_by(value: ast.ValueNode, source: Source, allow: Allowlist, depth: int) -> None:
    _deep(depth)
    for part in _items(value):
        for item in _object(part, "order_by").fields:
            key = item.name.value
            if key in source.columns:
                if not isinstance(item.value, ast.EnumValueNode) or item.value.value not in ORDER:
                    raise Refused(f"order_by của cột {key} phải là asc hay desc.")
            elif key in source.relations:
                _order_by(item.value, allow.sources[source.relations[key].source], allow, depth + 1)
            else:
                raise Refused(
                    f"order_by không được xếp theo '{key}': không phải cột hay quan hệ {source.field} khai."
                )


def _cells(
    selection: ast.SelectionSetNode, source: Source, allow: Allowlist, depth: int, path: tuple, label: str
) -> tuple[Cell, ...]:
    if depth > MAX_DEPTH:
        raise Refused(f"Câu truy vấn lồng quá {MAX_DEPTH} cấp.")
    cells: list[Cell] = []
    for field in _unique(selection, source.field):
        name = field.name.value
        if field.arguments:
            raise Refused(f"Trường {name} không nhận tham số.")
        if name in source.columns and field.selection_set is None:
            text = f"{label}: {source.columns[name]}" if label else source.columns[name]
            cells.append(Cell(".".join((*path, name)), text, (*path, name)))
        elif name in source.relations:
            relation = source.relations[name]
            inner = _selection(field, f"quan hệ {name}")
            cells += _cells(
                inner, allow.sources[relation.source], allow, depth + 1, (*path, name), relation.label
            )
        else:
            raise Refused(f"'{name}' không phải cột hay quan hệ mà gói khai cho {source.field}.")
    return tuple(cells)


def _aggregate(field: ast.FieldNode, source: Source, allow: Allowlist) -> list[Table]:
    name = field.name.value
    limit = _table_arguments(field, source, allow)
    tables = []
    for part in _unique(_selection(field, f"trường {name}"), name):
        if part.arguments:
            raise Refused(f"Trường {part.name.value} không nhận tham số.")
        if part.name.value == "nodes":
            # limit của _aggregate áp cho cả số tổng hợp, nên chỉ bắt buộc khi có danh sách dòng đi kèm.
            if limit is None:
                raise Refused(f"{name} có nodes thì phải có limit, tối đa {allow.max_rows} dòng.")
            cells = _cells(_selection(part, "nodes"), source, allow, 3, (), "")
            tables.append(Table(source.label, name, ("nodes",), True, cells))
        elif part.name.value == "aggregate":
            cells = _aggregate_cells(_selection(part, "aggregate"), source)
            tables.append(Table(f"{source.label}: tổng hợp", name, ("aggregate",), False, cells))
        else:
            raise Refused(f"{name} chỉ chọn được aggregate và nodes, không chọn được '{part.name.value}'.")
    return tables


def _aggregate_cells(selection: ast.SelectionSetNode, source: Source) -> tuple[Cell, ...]:
    cells = []
    for part in _unique(selection, "aggregate"):
        name = part.name.value
        if part.arguments:
            raise Refused(f"Trường {name} trong aggregate không nhận tham số.")
        if name == "count" and part.selection_set is None:
            cells.append(Cell("count", "Số dòng", ("count",)))
        elif name in AGGREGATES:
            for column in _unique(_selection(part, name), name):
                if column.arguments or column.selection_set or column.name.value not in source.columns:
                    raise Refused(
                        f"{name} chỉ nhận cột {source.field} khai, không nhận '{column.name.value}'."
                    )
                text = f"{AGGREGATES[name]} {source.columns[column.name.value].lower()}"
                cells.append(Cell(f"{name}.{column.name.value}", text, (name, column.name.value)))
        else:
            raise Refused(f"aggregate không có phép '{name}'; dùng count, sum, avg, max, min.")
    return tuple(cells)
