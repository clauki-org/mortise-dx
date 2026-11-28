# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Bước kiểm bản nháp (app/draft_check.py) phải nói "hợp lệ" đúng như bộ kiểm gói (`scripts/contracts.sh
# package`) với những luật áp được cho bản nháp: ví dụ đúng của contracts/ qua, ví dụ sai bị từ chối ở đúng vị
# trí với đúng thông điệp mà contracts/examples/expected-errors.txt ghi cho check-jsonschema; gói mẫu sai của
# luật nhiều tệp bị từ chối; luật trang cho cùng lỗi như scripts/check-page-config.py. Lệch ở đây thì trợ lý
# trả bản nháp "hợp lệ" mà check-fast từ chối, hay ngược lại.

import importlib.util
import json
import sys
from pathlib import Path

import pytest
import yaml

from app import draft_check, draft_contracts, draft_pages
from app.config import settings

EXAMPLES = Path(settings.contracts_dir) / "examples"
CONTRACTS = draft_contracts.load()
SCRIPTS = Path(settings.contracts_dir).parent / "scripts"


def _expected() -> dict[str, tuple[str, str]]:
    # Tệp viết như bộ lọc @tsv của jq in ra: dấu \ trong thông điệp được nhân đôi.
    expected = {}
    for line in (EXAMPLES / "expected-errors.txt").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            name, path, message = line.split("\t")
            expected[name] = (path, message.replace("\\\\", "\\"))
    return expected


EXPECTED = _expected()


def _invalid(prefix: str) -> list[Path]:
    return sorted((EXAMPLES / "invalid").glob(f"{prefix}.*.yaml"))


def test_components_are_those_described_and_allowed_in_the_menu():
    app_schema = json.loads((Path(settings.contracts_dir) / "app.schema.json").read_text(encoding="utf-8"))
    allowed = app_schema["properties"]["menu"]["items"]["properties"]["component"]["enum"]
    described = {path.name.split(".")[0] for path in Path(settings.contracts_dir).glob("*.component.yaml")}
    assert set(CONTRACTS.components) == set(allowed) & described
    # documents có bản mô tả nhưng không là mục menu (ADR 0041).
    assert "documents" not in CONTRACTS.components


@pytest.mark.parametrize("name", sorted(CONTRACTS.components))
def test_component_example_is_valid(name):
    document = yaml.safe_load((EXAMPLES / f"{name}.example.yaml").read_text(encoding="utf-8"))
    assert list(CONTRACTS.components[name].validator.iter_errors(document)) == []


@pytest.mark.parametrize(
    "path",
    _invalid("app") + [path for name in sorted(CONTRACTS.components) for path in _invalid(name)],
    ids=lambda path: path.name,
)
def test_invalid_example_fails_exactly_like_check_jsonschema(path):
    name = path.name.split(".")[0]
    validator = CONTRACTS.app_validator if name == "app" else CONTRACTS.components[name].validator
    result = draft_check.Checked()
    document = draft_check._parse(path.name, path.read_text(encoding="utf-8"), result)
    errors = list(validator.iter_errors(document))
    assert [(e.json_path, e.message) for e in errors] == [EXPECTED[path.name]]


def _app(menu: str) -> str:
    return (
        "id: draft\nname: Bản nháp\nversion: 0.1.0\n"
        "database:\n  schema: app_draft\n  migrations: schema/migrations\n"
        f"menu:\n{menu}"
    )


MAP_ITEM = "  - id: where\n    label: Bản đồ\n    component: map\n    config: map-layers/where.yaml\n"
MAP_EXAMPLE = (EXAMPLES / "map.example.yaml").read_text(encoding="utf-8")


def test_complete_draft_has_no_problems_and_files_get_their_menu_component():
    checked = draft_check.check(
        [("app.yaml", _app(MAP_ITEM)), ("map-layers/where.yaml", MAP_EXAMPLE)], CONTRACTS
    )
    assert checked.problems == []
    assert checked.components == {"app.yaml": None, "map-layers/where.yaml": "map"}


def test_config_is_checked_against_the_schema_its_menu_item_names():
    # Nội dung là cấu hình bản đồ, nhưng mục menu khai catalog: kiểm theo catalog, không theo tên thư mục.
    item = MAP_ITEM.replace("component: map", "component: catalog")
    checked = draft_check.check([("app.yaml", _app(item)), ("map-layers/where.yaml", MAP_EXAMPLE)], CONTRACTS)
    assert checked.components["map-layers/where.yaml"] == "catalog"
    assert checked.problems and all(p.path == "map-layers/where.yaml" for p in checked.problems)


def test_missing_extra_and_outside_files_are_problems():
    files = [
        ("app.yaml", _app(MAP_ITEM)),
        ("notes.yaml", "title: x\n"),
        ("../core/keycloak/realm.yaml", "x: 1\n"),
    ]
    checked = draft_check.check(files, CONTRACTS)
    messages = {(p.path, p.message.split(" ")[0]) for p in checked.problems}
    assert ("map-layers/where.yaml", "Mục") in messages
    assert ("notes.yaml", "Bản") in messages
    assert ("../core/keycloak/realm.yaml", "Đường") in messages


def test_component_without_description_is_a_problem():
    item = MAP_ITEM.replace("component: map", "component: tasks")
    checked = draft_check.check([("app.yaml", _app(item)), ("map-layers/where.yaml", "x: 1\n")], CONTRACTS)
    assert any("'tasks'" in p.message for p in checked.problems)
    assert [p.path for p in checked.problems] == ["app.yaml"]
    assert checked.components["map-layers/where.yaml"] is None


def test_duplicate_yaml_key_is_rejected_like_check_fast():
    content = MAP_EXAMPLE + "title: lần hai\n"
    checked = draft_check.check([("app.yaml", _app(MAP_ITEM)), ("map-layers/where.yaml", content)], CONTRACTS)
    assert [p.path for p in checked.problems] == ["map-layers/where.yaml"]
    assert "hai lần" in checked.problems[0].message


def test_draft_without_app_yaml_stops_early():
    checked = draft_check.check([("map-layers/where.yaml", MAP_EXAMPLE)], CONTRACTS)
    assert [(p.path, p.message) for p in checked.problems] == [("app.yaml", "Bản nháp không có app.yaml.")]


def test_blocks_are_checked_like_menu_items_and_ids_do_not_repeat():
    app = _app(MAP_ITEM) + "blocks:\n" + MAP_ITEM.replace("config: map-layers/where.yaml", "config: b.yaml")
    checked = draft_check.check(
        [("app.yaml", app), ("map-layers/where.yaml", MAP_EXAMPLE), ("b.yaml", "title: x\n")], CONTRACTS
    )
    assert checked.components["b.yaml"] == "map"
    messages = [(p.path, p.message) for p in checked.problems]
    assert ("app.yaml", "id trong menu và blocks bị trùng (where, where).") in messages
    assert any(path == "b.yaml" for path, _ in messages)


def test_declared_workflow_is_a_file_to_write_not_a_problem():
    app = _app(MAP_ITEM).replace("menu:\n", "workflows:\n  - bpmn/a.bpmn20.xml\nmenu:\n")
    checked = draft_check.check([("app.yaml", app), ("map-layers/where.yaml", MAP_EXAMPLE)], CONTRACTS)
    assert checked.problems == []
    assert [p.path for p in checked.to_write] == ["bpmn/a.bpmn20.xml"]


@pytest.mark.parametrize("name", ["duplicate-menu-id", "missing-config-file"])
def test_invalid_package_of_the_shared_validator_is_rejected(name):
    # Gói mẫu sai của scripts/check-app-manifest.py mà luật áp được cho bản nháp; các gói khác sai ở văn bản
    # cho trợ lý, bản nháp không viết văn bản.
    directory = EXAMPLES / "invalid-packages" / name
    files = [
        (str(p.relative_to(directory)), p.read_text(encoding="utf-8")) for p in directory.rglob("*.yaml")
    ]
    assert draft_check.check(files, CONTRACTS).problems


def _page_script():
    sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location("check_page_config", SCRIPTS / "check-page-config.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PAGE_CASES = [
    {"title": "T", "blocks": [{"item": "nope"}]},
    {"title": "T", "blocks": [{"item": "overview"}]},
    {"title": "T", "blocks": [{"item": "items", "variant": "timeline"}]},
    {"title": "T", "blocks": [{"item": "items", "variant": "kanban"}]},
    {
        "title": "T",
        "blocks": [{"item": "sites", "variant": "list"}, {"item": "reports", "variant": "compact"}],
    },
]


@pytest.mark.parametrize("page", PAGE_CASES)
def test_page_rules_match_check_page_config(page):
    app = yaml.safe_load((EXAMPLES / "app.example.yaml").read_text(encoding="utf-8"))
    entries = app["menu"] + app["blocks"]
    items = {entry["id"]: entry["component"] for entry in entries}
    configs = {
        e["id"]: yaml.safe_load((EXAMPLES / f"{e['component']}.example.yaml").read_text(encoding="utf-8"))
        for e in entries
        if e["component"] in CONTRACTS.components
    }
    script = _page_script()
    expected = script.page_problems(
        page, items, {k: v for k, v in configs.items() if script.variants_of(items[k])}
    )
    assert draft_pages.page_problems(page, items, configs, CONTRACTS) == expected
