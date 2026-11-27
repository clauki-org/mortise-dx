# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đo trợ lý hỏi văn bản bằng bộ câu hỏi có đáp án của một gói (docs/assistant-eval.md), gọi từ
# `make assistant-eval`. Gửi từng câu qua cổng tới /v1/assistant/questions bằng token của một tài khoản
# demo, như cán bộ hỏi trên giao diện, nên đo cả tìm đoạn theo quyền, bước sinh và bước kiểm của bản đang
# chạy. Ghi một tệp JSON (mọi phản hồi) và một tệp markdown (tóm tắt) kèm ngày đo, máy, mô hình. `--check`
# chỉ kiểm bộ câu hỏi với văn bản của gói, không cần lõi; `make check-fast` gọi chế độ này.

import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import assistant_eval_score as score
import assistant_eval_set as qset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Trợ lý chờ mô hình tối đa ASSISTANT_TIMEOUT_SECONDS (150 s trong compose.yaml); chờ lâu hơn thế để lỗi
# quá giờ là của trợ lý, có lý do trong phản hồi, chứ không phải của lệnh đo.
REQUEST_TIMEOUT = 200


def env_value(name: str) -> str:
    """Biến môi trường trước, rồi tới .env; không in giá trị, vì có thể là mật khẩu."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as file:
            for line in file:
                if line.startswith(f"{name}="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def post(url: str, body: bytes, headers: dict) -> tuple[int, dict]:
    # S310: địa chỉ chỉ là MORTISE_PUBLIC_URL, run() đã kiểm nó bắt đầu bằng http(s)://.
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")  # noqa: S310
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:  # noqa: S310
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except ValueError:
            return error.code, {}


class TokenError(Exception):
    """Không lấy được token; câu đó ghi là lỗi của lượt đo, các câu sau vẫn chạy."""


def token(base: str, user: str, password: str) -> str:
    # Lấy token mới cho mỗi câu: cả lượt đo dài hơn hạn của access token, và cổng giới hạn tần suất theo
    # token.
    form = urllib.parse.urlencode(
        {"grant_type": "password", "client_id": "mortise-test", "username": user, "password": password}
    ).encode()
    try:
        status, body = post(
            f"{base}/auth/realms/mortise/protocol/openid-connect/token",
            form,
            {"Content-Type": "application/x-www-form-urlencoded"},
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise TokenError(f"Không gọi được {base}/auth ({error}); kiểm lõi đang chạy (make ps).") from error
    if status != 200 or "access_token" not in body:
        raise TokenError(
            f"Không lấy được token cho {user} (HTTP {status}); kiểm lõi đang chạy, đã `make seed`, "
            "và DEMO_USER_PASSWORD đúng với .env của bản đang chạy."
        )
    return body["access_token"]


def ask(base: str, access: str, question_set: qset.QuestionSet, text: str) -> tuple[int, dict, float]:
    body = json.dumps({"question": text, "app": question_set.app, "documents": list(question_set.documents)})
    started = time.monotonic()
    try:
        status, payload = post(
            f"{base}/v1/assistant/questions",
            body.encode(),
            {"Authorization": f"Bearer {access}", "Content-Type": "application/json"},
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        status, payload = 0, {"error": f"không gọi được trợ lý: {error}"}
    return status, payload, round(time.monotonic() - started, 1)


def result(question: qset.Question, status: int, payload: dict, seconds: float) -> dict:
    answer = payload if status == 200 else None
    return {
        "id": question.id,
        "kind": question.kind,
        "question": question.question,
        "expect": list(question.expect),
        "numbers": list(question.numbers),
        "refuse": question.refuse,
        "http_status": status,
        "verdict": score.verdict(question, status, answer),
        "refused_by": score.refused_by(answer) if answer else None,
        # Bước sinh hỏng (502, 504) cũng đã gọi mô hình: thời gian của nó thuộc độ trễ của các lần sinh.
        "model_called": bool(answer.get("model")) if answer else status in score.GENERATION_FAILED,
        "cited": score.cited(answer) if answer else [],
        "answer": answer.get("answer") if answer else None,
        "reason": answer.get("reason") if answer else payload.get("error"),
        "model": answer.get("model") if answer else None,
        "seconds": seconds,
    }


def _read_text(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as file:
            return file.read()
    except OSError:
        return ""


def machine() -> dict:
    # Chỉ loại máy, không tên máy hay địa chỉ: tệp kết quả được commit công khai.
    cpu = re.search(r"^model name\s*:\s*(.+)$", _read_text("/proc/cpuinfo"), re.M)
    ram = re.search(r"^MemTotal:\s*(\d+) kB", _read_text("/proc/meminfo"), re.M)
    return {
        "cpu": cpu.group(1).strip() if cpu else platform.processor() or platform.machine(),
        "cpus": os.cpu_count(),
        "ram_gib": round(int(ram.group(1)) / 1024**2, 1) if ram else None,
        "os": f"{platform.system()} {platform.release()}",
    }


def pinned_model(names: set[str]) -> str | None:
    for line in _read_text(os.path.join(ROOT, "core/ollama/models.txt")).splitlines():
        parts = line.split()
        if len(parts) == 2 and not line.startswith("#") and parts[0] in names:
            return f"{parts[0]} {parts[1]}"
    return None


def service_settings() -> str:
    # Giá trị trong compose.yaml của commit này; bản đang chạy dựng từ commit khác thì có thể khác.
    found = re.findall(
        r'(ASSISTANT_(?:MIN_SCORE|TOP_PASSAGES|NUM_PREDICT|TIMEOUT_SECONDS)): "([^"]+)"',
        _read_text(os.path.join(ROOT, "compose.yaml")),
    )
    return ", ".join(f"{name}={value}" for name, value in found)


def _git(*args: str) -> str:
    # git lấy theo PATH như mọi lệnh khác của Makefile; không có git thì commit ghi là không đọc được.
    command = ["git", *args]
    return subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()  # noqa: S603


def commit() -> str:
    try:
        head, dirty = _git("rev-parse", "--short", "HEAD"), _git("status", "--porcelain")
    except (OSError, subprocess.CalledProcessError):
        return "không đọc được"
    return f"{head}{' (có thay đổi chưa commit)' if dirty else ''}"


def meta(question_set: qset.QuestionSet, results: list[dict], complete: bool) -> dict:
    models = {json.dumps(r["model"], sort_keys=True) for r in results if r["model"]}
    model_list = [json.loads(m) for m in sorted(models)]
    with open(question_set.path, "rb") as file:
        digest = hashlib.sha256(file.read()).hexdigest()
    ollama = {m["name"] for m in model_list if m["provider"] == "ollama"}
    return {
        "date": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "complete": complete,
        "question_set": os.path.relpath(question_set.path, ROOT),
        "question_set_sha256": digest,
        "commit": commit(),
        "models": model_list,
        "pinned_model": pinned_model(ollama) if ollama else None,
        "machine": machine(),
        "service_settings": service_settings(),
    }


def run(args: argparse.Namespace) -> int:
    question_set = qset.load(args.questions)
    chosen = [q for q in question_set.questions if not args.only or q.id in args.only]
    unknown = set(args.only or ()) - {q.id for q in question_set.questions}
    if unknown or not chosen:
        raise SystemExit(f"Không có câu nào khớp --only ({', '.join(sorted(unknown)) or 'rỗng'}).")
    base = (env_value("MORTISE_PUBLIC_URL") or "http://localhost:9080").rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise SystemExit(f"MORTISE_PUBLIC_URL phải bắt đầu bằng http:// hay https://, nhận: {base}.")
    password = env_value("DEMO_USER_PASSWORD")
    if not password:
        raise SystemExit("Thiếu DEMO_USER_PASSWORD (biến môi trường hay .env).")
    results = []
    for number, question in enumerate(chosen, start=1):
        try:
            status, payload, seconds = ask(
                base, token(base, args.user, password), question_set, question.question
            )
        except TokenError as error:
            status, payload, seconds = 0, {"error": str(error)}, 0.0
        results.append(result(question, status, payload, seconds))
        print(f"[{number}/{len(chosen)}] {question.id}: {results[-1]['verdict']} ({seconds} s)", flush=True)
    complete = len(chosen) == len(question_set.questions) and not any(
        r["verdict"] == "error" for r in results
    )
    report = {
        "meta": meta(question_set, results, complete),
        "summary": score.summary(results),
        "results": results,
    }
    write(report, args.out)
    # Chọn một phần câu bằng --only không phải lỗi; chỉ lỗi của lượt đo làm lệnh trả mã lỗi.
    return 1 if report["summary"]["errors"] else 0


def write(report: dict, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    meta_ = report["meta"]
    model = (
        (meta_["models"][0]["name"] if meta_["models"] else "no-model").replace(":", "-").replace("/", "-")
    )
    stem = f"{meta_['date'][:10]}-{model}{'' if meta_['complete'] else '-partial'}"
    for suffix, text in (
        (".json", json.dumps(report, ensure_ascii=False, indent=2) + "\n"),
        (".md", score.markdown(report)),
    ):
        with open(os.path.join(out, stem + suffix), "w", encoding="utf-8") as file:
            file.write(text)
    print(score.markdown(report))
    print(f"Đã ghi {os.path.join(out, stem)}.json và .md")


def main() -> int:
    parser = argparse.ArgumentParser(description="Đo trợ lý hỏi văn bản bằng bộ câu hỏi có đáp án.")
    parser.add_argument("questions", nargs="+", help="apps/<gói>/tests/assistant-questions.yaml")
    parser.add_argument("--check", action="store_true", help="chỉ kiểm bộ câu hỏi, không gọi trợ lý")
    parser.add_argument(
        "--only", type=lambda v: [i for i in v.split(",") if i], help="mã câu, ngăn bằng dấu phẩy"
    )
    parser.add_argument("--user", default="user.a", help="tài khoản demo đặt câu hỏi")
    parser.add_argument(
        "--out", default=os.path.join(ROOT, "docs/assistant-eval"), help="thư mục ghi kết quả"
    )
    args = parser.parse_args()
    if args.check:
        found = [problem for path in args.questions for problem in qset.problems(path)]
        print(
            "\n".join(found) or f"Bộ câu hỏi hợp lệ: {', '.join(args.questions)}",
            file=sys.stderr if found else None,
        )
        return 1 if found else 0
    if len(args.questions) != 1:
        raise SystemExit("Đo từng gói một: make assistant-eval APP=<gói>.")
    args.questions = args.questions[0]
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
