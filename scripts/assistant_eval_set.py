# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đọc và kiểm bộ câu hỏi đo trợ lý hỏi văn bản (docs/assistant-eval.md) của một gói: apps/<gói>/tests/
# assistant-questions.yaml. Đáp án trỏ tới đoạn trong knowledge/ của gói; đoạn bị xóa, đổi mã hay bị thay
# (superseded_by) mà câu hỏi vẫn trỏ tới thì lần đo sau chấm sai mà không ai biết vì sao, nên
# `make check-fast` chạy phần kiểm này, không cần lõi. scripts/assistant-eval.py dùng cùng hàm để nạp bộ câu.

import os
from dataclasses import dataclass, field

import yaml

KINDS = ("direct", "paraphrase", "superseded", "out-of-scope")


@dataclass(frozen=True)
class Question:
    id: str
    kind: str
    question: str
    # Mã `<văn bản>/<đoạn>`; rỗng với câu phải từ chối.
    expect: tuple[str, ...] = ()
    numbers: tuple[str, ...] = ()
    refuse: bool = False


@dataclass(frozen=True)
class QuestionSet:
    path: str
    app: str
    documents: tuple[str, ...]
    questions: tuple[Question, ...] = field(default_factory=tuple)


def _read(path: str):
    with open(path, encoding="utf-8") as file:
        return yaml.safe_load(file)


def _app_dir(path: str) -> str:
    # Bộ câu nằm ở apps/<gói>/tests/, nên thư mục gói là cha của tests/.
    return os.path.dirname(os.path.dirname(os.path.abspath(path)))


def _passages(app_dir: str) -> dict[str, bool]:
    """Mọi đoạn của gói: `<văn bản>/<đoạn>` -> còn hiệu lực (không có superseded_by)."""
    found = {}
    for entry in _read(os.path.join(app_dir, "app.yaml")).get("knowledge") or []:
        document = _read(os.path.join(app_dir, entry))
        for passage in document["passages"]:
            found[f"{document['id']}/{passage['id']}"] = "superseded_by" not in passage
    return found


def load(path: str) -> QuestionSet:
    raw = _read(path)
    app_dir = _app_dir(path)
    config = _read(os.path.join(app_dir, raw["assistant"]))
    questions = tuple(
        Question(
            id=item["id"],
            kind=item["kind"],
            question=item["question"].strip(),
            expect=tuple(item.get("expect") or ()),
            numbers=tuple(str(number) for number in item.get("numbers") or ()),
            refuse=bool(item.get("refuse")),
        )
        for item in raw["questions"]
    )
    return QuestionSet(path, os.path.basename(app_dir), tuple(config["documents"]), questions)


def _question_problems(
    question: Question, documents: tuple[str, ...], passages: dict[str, bool]
) -> list[str]:
    where = f"câu {question.id}"
    found = []
    if question.kind not in KINDS:
        found.append(f"{where}: kind '{question.kind}' không thuộc {', '.join(KINDS)}")
    if question.refuse == bool(question.expect):
        found.append(f"{where}: cần đúng một trong `expect` và `refuse: true`")
    if question.refuse and (question.numbers or question.kind != "out-of-scope"):
        found.append(f"{where}: câu phải từ chối có kind out-of-scope và không có `numbers`")
    for key in question.expect:
        if key not in passages:
            found.append(f"{where}: đoạn {key} không có trong knowledge/ của gói")
        elif not passages[key]:
            # Trợ lý không bao giờ tìm đoạn đã bị thay, nên đáp án như vậy không bao giờ đúng được.
            found.append(f"{where}: đoạn {key} đã bị thay (superseded_by); trỏ tới đoạn đang có hiệu lực")
        elif key.split("/")[0] not in documents:
            found.append(f"{where}: văn bản của {key} không có trong `documents` của cấu hình trợ lý")
    return found


def problems(path: str) -> list[str]:
    try:
        question_set = load(path)
        passages = _passages(_app_dir(path))
    except (OSError, KeyError, TypeError, AttributeError, yaml.YAMLError) as error:
        return [f"{path}: không đọc được bộ câu hỏi hay văn bản của gói ({error!r})"]
    found = []
    ids = [question.id for question in question_set.questions]
    found += [f"mã câu {i} trùng" for i in sorted({i for i in ids if ids.count(i) > 1})]
    for question in question_set.questions:
        found += _question_problems(question, question_set.documents, passages)
    return [f"{path}: {problem}" for problem in found]
