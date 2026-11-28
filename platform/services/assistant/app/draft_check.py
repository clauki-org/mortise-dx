# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm bản nháp cấu hình gói (ADR 0071) theo những luật của `scripts/contracts.sh package` áp được cho một gói
# chỉ gồm app.yaml và cấu hình thành phần: app.yaml theo app.schema.json; mỗi tệp cấu hình theo schema của
# thành phần mà mục menu hay khối trỏ tới nó khai, không theo tên thư mục hay nhãn mô hình tự ghi; id của mục
# menu và khối không trùng (scripts/app-deploy.py); khối trên trang trỏ tới mục có thật, đúng kiểu
# (scripts/check-page-config.py). Thêm: mỗi mục có đúng tệp của nó, không có tệp thừa, đường dẫn nằm trong
# gói. Tệp quy trình, luật, văn bản, bảng thẩm quyền mà app.yaml khai không phải lỗi của bản nháp: chúng vào
# danh sách tệp còn phải viết trước khi cài. Kiểm chéo với BPMN, bảng hay quyền Hasura (scripts/check-*.py)
# không làm ở đây vì bản nháp chưa có những phần đó.

import re
from dataclasses import dataclass, field

import yaml
from jsonschema import Draft202012Validator

from . import draft_pages
from .draft_contracts import Contracts

APP_FILE = "app.yaml"
# Mục của app.yaml chứa danh sách tệp mà bản nháp không viết (scripts/check-app-manifest.py kiểm có thật).
FILE_LISTS = ("workflows", "rules", "knowledge", "authorities")


@dataclass(frozen=True)
class Problem:
    path: str
    message: str


@dataclass
class Checked:
    # Thành phần của từng tệp theo app.yaml; app.yaml, tệp thừa và tệp của mục khai thành phần chưa có bản mô
    # tả là None.
    components: dict[str, str | None] = field(default_factory=dict)
    # id mục menu hay khối tới thành phần nó khai, chỉ với thành phần có bản mô tả: lý do chọn tra theo bảng
    # này.
    items: dict[str, str] = field(default_factory=dict)
    problems: list[Problem] = field(default_factory=list)
    # Tệp app.yaml khai mà bản nháp không có; người dùng viết trước khi cài.
    to_write: list[Problem] = field(default_factory=list)


class _UniqueKeys(yaml.SafeLoader):
    """SafeLoader từ chối khóa trùng như check-jsonschema. SafeLoader thường giữ giá trị sau, bỏ giá trị
    trước, nên tệp có một khóa khai hai lần sẽ qua bước kiểm này mà bị check-fast từ chối."""


def _mapping(loader: _UniqueKeys, node: yaml.MappingNode, deep: bool = False) -> dict:
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise yaml.constructor.ConstructorError(
                None, None, f"khóa {key!r} bị khai hai lần", key_node.start_mark
            )
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


_UniqueKeys.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _mapping)


def check(files: list[tuple[str, str]], contracts: Contracts) -> Checked:
    """Kiểm các tệp (đường dẫn, nội dung YAML) của một bản nháp; trả thành phần của từng tệp và mọi lỗi."""
    result = Checked()
    contents = _contents(files, contracts.path_pattern, result)
    if APP_FILE not in contents:
        result.problems.append(Problem(APP_FILE, "Bản nháp không có app.yaml."))
        return result
    result.components[APP_FILE] = None
    app = _parse(APP_FILE, contents[APP_FILE], result)
    if app is None:
        return result
    _validate(APP_FILE, app, contracts.app_validator, result)
    if not isinstance(app, dict):
        return result
    entries = _entries(app)
    _unique_ids(entries, result)
    configs = {}
    for label, item in entries:
        configs[item.get("id")] = _check_item(label, item, contents, contracts, result)
    _check_pages(entries, configs, contracts, result)
    _files_to_write(app, contents, result)
    _extra_files(contents, result)
    return result


def _contents(files: list[tuple[str, str]], path_pattern: str, result: Checked) -> dict[str, str]:
    contents: dict[str, str] = {}
    for path, content in files:
        if path in contents:
            result.problems.append(Problem(path, "Tệp này có hai lần trong bản nháp."))
        elif not re.fullmatch(path_pattern, path):
            result.problems.append(
                Problem(path, "Đường dẫn phải nằm trong thư mục gói, không có đoạn . hay ..")
            )
        else:
            contents[path] = content
    return contents


def _extra_files(contents: dict[str, str], result: Checked) -> None:
    # Tệp chưa có thành phần sau mọi bước trên là tệp không mục menu hay khối nào trỏ tới.
    for path in contents:
        if path not in result.components:
            result.components[path] = None
            result.problems.append(
                Problem(path, "Bản nháp chỉ gồm app.yaml và tệp cấu hình mà menu hay blocks trỏ tới.")
            )


def _entries(app: dict) -> list[tuple[str, dict]]:
    # Mục menu rồi tới khối, như scripts/app_entries.py: khối có cùng dạng và qua cùng bước kiểm.
    found = []
    for section in ("menu", "blocks"):
        listed = app.get(section)
        for index, item in enumerate(listed if isinstance(listed, list) else []):
            if isinstance(item, dict):
                found.append((f"$.{section}[{index}]", item))
    return found


def _unique_ids(entries: list[tuple[str, dict]], result: Checked) -> None:
    ids = [str(item.get("id")) for _, item in entries]
    if len(ids) != len(set(ids)):
        listed = ", ".join(sorted(ids))
        result.problems.append(Problem(APP_FILE, f"id trong menu và blocks bị trùng ({listed})."))


def _check_item(
    label: str, item: dict, contents: dict[str, str], contracts: Contracts, result: Checked
) -> object | None:
    """Kiểm tệp cấu hình của một mục; trả cấu hình đã đọc, None khi không đọc được."""
    name, path = item.get("component"), item.get("config")
    if not isinstance(name, str) or not isinstance(path, str):
        return None  # app.schema.json đã báo thiếu hay sai kiểu.
    component = contracts.components.get(name)
    if component is None:
        result.problems.append(
            Problem(APP_FILE, f"{label}.component: thành phần {name!r} không có bản mô tả trong contracts/.")
        )
        if path in contents:
            result.components[path] = None
        return None
    if isinstance(item.get("id"), str):
        result.items.setdefault(item["id"], name)
    if path not in contents:
        result.problems.append(
            Problem(path, f"Mục {item.get('id')!r} trỏ tới tệp này nhưng bản nháp không có.")
        )
        return None
    result.components[path] = name
    config = _parse(path, contents[path], result)
    if config is not None:
        _validate(path, config, component.validator, result)
    return config


def _check_pages(
    entries: list[tuple[str, dict]], configs: dict, contracts: Contracts, result: Checked
) -> None:
    items = {item.get("id"): item.get("component") for _, item in entries}
    for _, item in entries:
        if item.get("component") != "page":
            continue
        page = configs.get(item.get("id"))
        if not isinstance(page, dict):
            continue
        for problem in draft_pages.page_problems(page, items, configs, contracts):
            result.problems.append(Problem(item["config"], problem))


def _files_to_write(app: dict, contents: dict[str, str], result: Checked) -> None:
    for section in FILE_LISTS:
        listed = app.get(section)
        for index, path in enumerate(listed if isinstance(listed, list) else []):
            # Tệp có trong bản nháp thì là tệp thừa (check() báo): bản nháp không viết quy trình hay luật.
            if isinstance(path, str) and path not in contents:
                result.to_write.append(
                    Problem(path, f"app.yaml khai ở {section}[{index}]; viết tệp này trước khi cài.")
                )


def _parse(path: str, content: str, result: Checked) -> object | None:
    try:
        return yaml.load(content, Loader=_UniqueKeys)  # noqa: S506 - _UniqueKeys là SafeLoader.
    except yaml.YAMLError as error:
        result.problems.append(Problem(path, f"Không đọc được YAML: {error}"))
        return None


def _validate(path: str, document: object, validator: Draft202012Validator, result: Checked) -> None:
    for error in sorted(validator.iter_errors(document), key=lambda e: (e.json_path, e.message)):
        result.problems.append(Problem(path, f"{error.json_path}: {error.message}"))
