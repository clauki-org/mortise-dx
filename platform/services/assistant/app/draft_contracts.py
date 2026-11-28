# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc contracts/ và tài liệu nền tảng docs/packages.md cho bản nháp cấu hình gói (ADR 0071): bản mô tả và ví
# dụ của từng thành phần cùng tài liệu cho prompt (draft_prompt.py), schema để kiểm bản nháp (draft_check.py).
# Hai thư mục gắn chỉ đọc vào container (ASSISTANT_CONTRACTS_DIR, ASSISTANT_PACKAGE_GUIDE, compose.yaml), nên
# dịch vụ đọc đúng hợp đồng và tài liệu của bản đang chạy, không bản chép riêng. Thành phần được đề xuất là
# thành phần vừa có bản mô tả vừa nằm trong danh sách menu của app.schema.json, dò lúc đọc: danh sách viết
# cứng sẽ lệch khi hợp đồng thêm hay bỏ thành phần.

import json
import logging
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .config import settings
from .errors import Denied

log = logging.getLogger("assistant.draft")

UNREADABLE = (
    "Không đọc được hợp đồng trong contracts/ hay tài liệu docs/packages.md để soạn bản nháp; người vận hành "
    "kiểm volume contracts và docs của dịch vụ assistant trong compose.yaml."
)


@dataclass(frozen=True)
class Component:
    name: str
    summary: str
    # Mã câu (`<thành phần>.c<số>` hay `.l<số>`) tới câu nguyên văn trong bản mô tả: mô hình chỉ trả mã, công
    # dụng trong lập luận hiện cho người dùng là câu chép từ hợp đồng, không phải chữ mô hình viết (ADR 0071).
    lines: dict[str, str]
    example: str
    validator: Draft202012Validator
    # Mục cấp đầu của schema: kiểu của khối trên trang (`variant`) và mục cấu hình mà kiểu đó cần đọc từ đây.
    properties: dict


@dataclass(frozen=True)
class Contracts:
    guide: str
    app_example: str
    # Mẫu đường dẫn tương đối trong gói của app.schema.json, dùng lại cho đường dẫn tệp của bản nháp.
    path_pattern: str
    app_validator: Draft202012Validator
    components: dict[str, Component]


def load() -> Contracts:
    """Hợp đồng đọc một lần rồi giữ; lỗi đọc là 503 cho người gọi, không dừng dịch vụ lúc khởi động."""
    try:
        return _load(settings.contracts_dir, settings.package_guide)
    except (OSError, ValueError, KeyError, TypeError, yaml.YAMLError) as error:
        log.error("Không đọc được contracts/ ở %s: %s", settings.contracts_dir, error)
        raise Denied(503, UNREADABLE) from error


@cache
def _load(directory: str, guide: str) -> Contracts:
    root = Path(directory)
    schemas = {path.name: json.loads(path.read_text(encoding="utf-8")) for path in root.glob("*.schema.json")}
    # catalog.schema.json trỏ tới documents.schema.json bằng tên tệp, ghép với $id của nó. Đăng ký mọi schema
    # theo $id để tham chiếu đó tìm thấy trong thư mục; không đăng ký thì bước kiểm danh mục dừng ở lỗi không
    # tìm được documents.schema.json.
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )
    app_schema = schemas["app.schema.json"]
    allowed = app_schema["properties"]["menu"]["items"]["properties"]["component"]["enum"]
    components: dict[str, Component] = {}
    for name in allowed:
        description = root / f"{name}.component.yaml"
        if description.is_file():
            components[name] = _component(
                root, yaml.safe_load(description.read_text(encoding="utf-8")), schemas, registry
            )
    return Contracts(
        guide=Path(guide).read_text(encoding="utf-8"),
        app_example=(root / "examples/app.example.yaml").read_text(encoding="utf-8"),
        path_pattern=app_schema["$defs"]["path"]["pattern"],
        app_validator=Draft202012Validator(app_schema, registry=registry),
        components=components,
    )


def _component(root: Path, described: dict, schemas: dict, registry: Registry) -> Component:
    name = described["component"]
    lines = {f"{name}.c{i}": text for i, text in enumerate(described["capabilities"], start=1)}
    lines |= {f"{name}.l{i}": text for i, text in enumerate(described["limits"], start=1)}
    schema = schemas[described["config_schema"]]
    return Component(
        name=name,
        summary=described["summary"],
        lines=lines,
        example=(root / described["example"]).read_text(encoding="utf-8"),
        validator=Draft202012Validator(schema, registry=registry),
        properties=schema.get("properties", {}),
    )
