# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nạp phần chạy lúc dùng của một gói vào lõi, cho mọi tenant đang có trong core.tenants: deploy BPMN lên
# Flowable, khai báo bước vào platform.workflow_steps, mục menu kèm nội dung tệp cấu hình vào
# platform.menu_items, luật ngưỡng vào core.threshold_rules, văn bản cho trợ lý vào bảng knowledge của
# platform (scripts/app_knowledge.py). Sáu lệnh:
#   install <thư mục gói>   đọc app.yaml (workflows, menu, rules, knowledge) và <gói>/workflows/*.yaml;
#                           app.sh gọi khi cài
#   remove <thư mục gói>    xóa deployment (kèm hồ sơ đang chạy), khai báo bước, menu, luật, văn bản của
#                           gói; gọi khi gỡ
#   workflows --bpmn ... --steps ...   chỉ deploy và nạp khai báo bước; make seed gọi cho quy trình mẫu
#   rules --owner core <tệp> ...       chỉ nạp luật ngưỡng; make seed gọi cho luật mẫu
#   knowledge --owner core <tệp> ...   chỉ nạp văn bản; make seed gọi cho văn bản mẫu
#   menu --owner core --id ... --label ... --component ... <tệp cấu hình>
#                                      chỉ nạp một mục menu; make seed gọi cho mục hỏi văn bản mẫu
# Chạy lại không tạo bản trùng: tên deployment mang băm của tệp, nên tệp không đổi thì không deploy lại.
# BPMN của gói có thể chứa {{tên}}: được thay bằng giá trị trong `settings` của app.yaml, ghi đè lúc cài
# bằng biến môi trường APP_SETTINGS (make app-install SETTINGS=tên=giá trị), trước khi băm và deploy
# (ADR 0019).
# Tenant tạo sau khi cài gói chưa có gì cho tới khi chạy lại `make app-install`. Biến môi trường lấy từ .env
# (scripts/app.sh, scripts/seed.sh nạp sẵn); `make check-fast` đã kiểm app.yaml, khai báo bước, cấu hình danh
# mục, và khóa quy trình không trùng giữa lõi và các gói. Gỡ gói xóa theo tệp đang có trong thư mục gói:
# đổi tên hay bỏ một quy trình khỏi gói thì gỡ gói trước, nếu không deployment cũ còn lại trong Flowable.

import argparse
import base64
import glob
import hashlib
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET

import app_knowledge
import yaml
from workflow_settings import SettingsError, merge, parse_overrides, render

BPMN = "{http://www.omg.org/spec/BPMN/20100524/MODEL}"


def load_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def psql(sql: str, **params: str) -> str:
    """Chạy SQL trong CSDL của lõi; giá trị truyền bằng biến psql (:'tên') nên không phải tự thoát chuỗi."""
    command = ["docker", "compose", "exec", "-T", "postgres", "psql", "-qAtX", "-v", "ON_ERROR_STOP=1"]
    command += ["--username", "hasura", "--dbname", "mortise"]
    for name, value in params.items():
        command += ["-v", f"{name}={value}"]
    # Lệnh cố định; tham số là nội dung tệp trong repo, đi qua biến psql chứ không ghép vào SQL.
    result = subprocess.run(command, input=sql, capture_output=True, text=True, check=False)  # noqa: S603
    if result.returncode != 0:
        raise SystemExit(f"PostgreSQL báo lỗi: {result.stderr.strip()}\nKiểm lõi đang chạy: make ps")
    return result.stdout


def tenants() -> list[str]:
    return psql("SELECT id FROM core.tenants ORDER BY id;").split()


def flowable(method: str, path: str, body: bytes | None = None, content_type: str = "") -> dict:
    base = f"http://127.0.0.1:{os.environ.get('FLOWABLE_PORT', '8083')}/flowable-rest/service"
    password = os.environ.get("FLOWABLE_ADMIN_PASSWORD")
    if not password:
        raise SystemExit("Thiếu FLOWABLE_ADMIN_PASSWORD; chạy make env rồi gọi qua make.")
    credentials = base64.b64encode(f"rest-admin:{password}".encode()).decode()
    request = urllib.request.Request(base + path, data=body, method=method)  # noqa: S310
    request.add_header("Authorization", f"Basic {credentials}")
    if content_type:
        request.add_header("Content-Type", content_type)
    try:
        # Địa chỉ cố định 127.0.0.1 ở trên, không lấy từ dữ liệu bên ngoài.
        with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
            raw = response.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise SystemExit(f"Flowable {method} {path}: {error}\nKiểm lõi đang chạy: make ps") from error
    return json.loads(raw) if raw else {}


def process_keys(path: str) -> list[str]:
    # Tệp BPMN nằm trong repo, do người đóng góp viết, không phải dữ liệu từ bên ngoài.
    root = ET.parse(path).getroot()  # noqa: S314
    return [process.get("id") for process in root.iter(f"{BPMN}process")]


def is_latest(name: str, keys: list[str], tenant: str) -> bool:
    # workflow-api mở hồ sơ theo khóa quy trình, tức phiên bản mới nhất. Chỉ hỏi "đã có deployment tên này
    # chưa" là chưa đủ: đổi settings A sang B rồi về A thì deployment của A đã có từ trước, bộ cài bỏ qua và
    # in A trong khi hồ sơ mới vẫn chạy B. Vì vậy chỉ bỏ qua khi phiên bản mới nhất của mọi khóa trong tệp
    # thuộc một deployment mang đúng tên này.
    for key in keys:
        query = urllib.parse.urlencode({"key": key, "tenantId": tenant, "latest": "true"})
        latest = flowable("GET", f"/repository/process-definitions?{query}")["data"]
        if not latest:
            return False
        if flowable("GET", f"/repository/deployments/{latest[0]['deploymentId']}")["name"] != name:
            return False
    return True


def deploy(files: list[str], every: list[str], settings: dict[str, str]) -> None:
    # Flowable đặt tên deployment theo tên tệp tải lên (bỏ qua trường deploymentName), nên băm của tệp
    # được gắn vào tên tệp: tệp không đổi thì không tạo phiên bản mới. Băm tính trên tệp đã thay giá trị: đổi
    # settings mà băm theo tệp gốc thì quy trình không được deploy lại và vẫn chạy với giá trị cũ.
    for path in files:
        with open(path, encoding="utf-8") as file:
            try:
                content = render(file.read(), settings, path).encode()
            except SettingsError as error:
                raise SystemExit(str(error)) from error
        stem = os.path.basename(path).removesuffix(".bpmn20.xml")
        name = f"{stem}-{hashlib.sha256(content).hexdigest()[:12]}"
        keys = process_keys(path)
        for tenant in every:
            if is_latest(name, keys, tenant):
                continue
            boundary = uuid.uuid4().hex
            body = (
                (
                    f'--{boundary}\r\nContent-Disposition: form-data; name="tenantId"\r\n\r\n{tenant}\r\n'
                    f'--{boundary}\r\nContent-Disposition: form-data; name="file"; '
                    f'filename="{name}.bpmn20.xml"\r\n'
                    "Content-Type: application/xml\r\n\r\n"
                ).encode()
                + content
                + f"\r\n--{boundary}--\r\n".encode()
            )
            flowable("POST", "/repository/deployments", body, f"multipart/form-data; boundary={boundary}")
            print(f"flowable: deploy {name} cho {tenant}")


def undeploy(files: list[str], every: list[str]) -> None:
    # Xóa mọi phiên bản của quy trình, kèm hồ sơ đang chạy và lịch sử (cascade): giữ lại thì Flowable vẫn chạy
    # hồ sơ của một gói không còn bảng, biểu mẫu hay menu nào.
    for key in [key for path in files for key in process_keys(path)]:
        for tenant in every:
            # Một quy trình hiếm khi có tới 1000 phiên bản trong một tenant; vượt thì chạy gỡ lại lần nữa.
            query = urllib.parse.urlencode({"key": key, "tenantId": tenant, "size": 1000})
            definitions = flowable("GET", f"/repository/process-definitions?{query}")["data"]
            for deployment in sorted({definition["deploymentId"] for definition in definitions}):
                flowable("DELETE", f"/repository/deployments/{deployment}?cascade=true")
                print(f"flowable: xóa deployment {deployment} ({key}) của {tenant}")


STEPS_SQL = """
BEGIN;
CREATE TEMP TABLE declaration ON COMMIT DROP AS SELECT :'declaration'::jsonb AS d;
DELETE FROM platform.workflow_steps w USING declaration
WHERE w.process = d->>'process' AND NOT (d->'steps' ? w.step);
INSERT INTO platform.workflow_steps (tenant_id, process, step, config)
SELECT t.id, d->>'process', s.key, s.value
FROM core.tenants t, declaration, jsonb_each(d->'steps') s
ON CONFLICT (tenant_id, process, step) DO UPDATE SET config = EXCLUDED.config, updated_at = now()
    WHERE platform.workflow_steps.config IS DISTINCT FROM EXCLUDED.config;
COMMIT;
"""


def load_steps(files: list[str]) -> None:
    # Bước không còn trong tệp bị xóa, để chạy lại sau khi sửa tệp cho kết quả như trên dữ liệu trắng.
    for path in files:
        declaration = load_yaml(path)
        psql(STEPS_SQL, declaration=json.dumps(declaration))
        print(f"postgres: khai báo bước {declaration['process']} từ {path}")


MENU_SQL = """
BEGIN;
CREATE TEMP TABLE item ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(:'items'::jsonb)
    AS x(item text, position integer, label text, component text, config jsonb, roles text[]);
DELETE FROM platform.menu_items m WHERE m.app = :'app' AND m.item NOT IN (SELECT item FROM item);
INSERT INTO platform.menu_items (tenant_id, app, item, position, label, component, config, roles)
SELECT t.id, :'app', i.item, i.position, i.label, i.component, i.config, i.roles
FROM core.tenants t, item i
ON CONFLICT (tenant_id, app, item) DO UPDATE
    SET position = EXCLUDED.position, label = EXCLUDED.label,
    component = EXCLUDED.component, config = EXCLUDED.config, roles = EXCLUDED.roles, updated_at = now()
    WHERE (platform.menu_items.position, platform.menu_items.label, platform.menu_items.component,
           platform.menu_items.config, platform.menu_items.roles)
        IS DISTINCT FROM
        (EXCLUDED.position, EXCLUDED.label, EXCLUDED.component, EXCLUDED.config, EXCLUDED.roles);
COMMIT;
"""


def load_menu(directory: str, app: dict) -> None:
    items = [
        {
            "item": entry["id"],
            "position": position,
            "label": entry["label"],
            "component": entry["component"],
            "config": load_yaml(os.path.join(directory, entry["config"])),
            "roles": entry.get("roles") or None,
        }
        for position, entry in enumerate(app.get("menu", []))
    ]
    psql(MENU_SQL, app=app["id"], items=json.dumps(items))
    print(f"postgres: {len(items)} mục menu của {app['id']}")


RULES_SQL = """
BEGIN;
CREATE TEMP TABLE rule ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(:'rules'::jsonb)
    AS x(rule text, definition jsonb);
DELETE FROM core.threshold_rules r WHERE r.app = :'app' AND r.rule NOT IN (SELECT rule FROM rule);
INSERT INTO core.threshold_rules (tenant_id, app, rule, definition)
SELECT t.id, :'app', r.rule, r.definition
FROM core.tenants t, rule r
ON CONFLICT (tenant_id, app, rule) DO UPDATE SET definition = EXCLUDED.definition, updated_at = now()
    WHERE core.threshold_rules.definition IS DISTINCT FROM EXCLUDED.definition;
COMMIT;
"""


def load_rules(owner: str, files: list[str]) -> None:
    # Luật không còn trong danh sách bị xóa, như menu, để chạy lại sau khi sửa cho kết quả như trên dữ liệu
    # trắng.
    definitions = [load_yaml(path) for path in files]
    ids = [definition["id"] for definition in definitions]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"Luật ngưỡng của {owner} trùng id ({', '.join(sorted(ids))}).")
    rules = [{"rule": definition["id"], "definition": definition} for definition in definitions]
    psql(RULES_SQL, app=owner, rules=json.dumps(rules))
    print(f"postgres: {len(rules)} luật ngưỡng của {owner}")


def read_knowledge(owner: str, files: list[str]) -> list[dict]:
    documents = [load_yaml(path) for path in files]
    problems = app_knowledge.problems(documents)
    if problems:
        raise SystemExit(f"Văn bản của {owner} chưa nạp được:\n  " + "\n  ".join(problems))
    return documents


def load_knowledge(owner: str, documents: list[dict]) -> None:
    # Văn bản và đoạn không còn trong danh sách bị xóa, như luật ngưỡng.
    rows, passages = app_knowledge.rows(documents)
    psql(app_knowledge.SQL, app=owner, documents=json.dumps(rows), passages=json.dumps(passages))
    print(f"postgres: {len(rows)} văn bản, {len(passages)} đoạn của {owner}")


def package(directory: str) -> tuple[dict, list[str], list[str]]:
    app = load_yaml(os.path.join(directory, "app.yaml"))
    # Kiểm trước khi ghi gì: schema không buộc id menu duy nhất, và trùng id làm câu INSERT báo lỗi khó hiểu
    # sau khi quy trình đã deploy.
    ids = [entry["id"] for entry in app.get("menu", [])]
    if len(ids) != len(set(ids)):
        raise SystemExit(f"{directory}/app.yaml: id trong menu bị trùng ({', '.join(sorted(ids))}).")
    bpmn = [os.path.join(directory, path) for path in app.get("workflows", [])]
    steps = sorted(glob.glob(os.path.join(directory, "workflows", "*.yaml")))
    return app, bpmn, steps


def package_settings(app: dict) -> dict[str, str]:
    try:
        settings = merge(app.get("settings") or {}, parse_overrides(os.environ.get("APP_SETTINGS", "")))
    except SettingsError as error:
        raise SystemExit(str(error)) from error
    # In ra để người cài thấy quy trình chạy với giá trị nào, nhất là khi ghi đè thời hạn cho demo.
    for name, value in sorted(settings.items()):
        print(f"settings: {name} = {value}")
    return settings


def main() -> int:
    parser = argparse.ArgumentParser(description="Nạp quy trình, khai báo bước và menu của gói vào lõi")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("install", "remove"):
        commands.add_parser(name).add_argument("directory")
    workflows = commands.add_parser("workflows")
    workflows.add_argument("--bpmn", nargs="+", required=True)
    workflows.add_argument("--steps", nargs="+", required=True)
    for name in ("rules", "knowledge"):
        command = commands.add_parser(name)
        command.add_argument("--owner", required=True)
        command.add_argument("files", nargs="+")
    menu = commands.add_parser("menu")
    for flag in ("--owner", "--id", "--label", "--component"):
        menu.add_argument(flag, required=True)
    menu.add_argument("config")
    args = parser.parse_args()

    every = tenants()
    if args.command == "workflows":
        deploy(args.bpmn, every, {})
        load_steps(args.steps)
        return 0
    if args.command == "rules":
        load_rules(args.owner, args.files)
        return 0
    if args.command == "knowledge":
        load_knowledge(args.owner, read_knowledge(args.owner, args.files))
        return 0
    if args.command == "menu":
        # Mục menu của lõi không có app.yaml; dựng đúng dạng một mục của `menu` để dùng chung bộ nạp với gói.
        entry = {"id": args.id, "label": args.label, "component": args.component, "config": args.config}
        load_menu(".", {"id": args.owner, "menu": [entry]})
        return 0
    app, bpmn, steps = package(args.directory)
    if args.command == "install":
        # Văn bản và cấu hình trợ lý kiểm trước khi ghi gì, như id menu trong package().
        files = [os.path.join(args.directory, path) for path in app.get("knowledge", [])]
        documents = read_knowledge(app["id"], files)
        problems = app_knowledge.menu_problems(args.directory, app, documents)
        if problems:
            raise SystemExit(f"{args.directory}/app.yaml: " + "; ".join(problems))
        deploy(bpmn, every, package_settings(app))
        load_steps(steps)
        load_menu(args.directory, app)
        load_rules(app["id"], [os.path.join(args.directory, path) for path in app.get("rules", [])])
        load_knowledge(app["id"], documents)
        return 0
    undeploy(bpmn, every)
    processes = [load_yaml(path)["process"] for path in steps]
    psql(
        "DELETE FROM platform.workflow_steps WHERE process = ANY(string_to_array(:'processes', ','));"
        "DELETE FROM platform.menu_items WHERE app = :'app';"
        "DELETE FROM core.threshold_rules WHERE app = :'app';"
        "DELETE FROM platform.knowledge_passages WHERE app = :'app';"
        "DELETE FROM platform.knowledge_documents WHERE app = :'app';",
        processes=",".join(processes),
        app=app["id"],
    )
    print(f"postgres: xóa khai báo bước, menu, luật ngưỡng và văn bản của {app['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
