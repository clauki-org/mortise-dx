# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Chấm một lượt đo trợ lý hỏi văn bản (docs/assistant-eval.md) và viết bản tóm tắt markdown. Hàm thuần,
# không gọi mạng: scripts/assistant-eval.py gửi câu hỏi rồi đưa phản hồi vào đây. Cách chấm ghi ở
# docs/assistant-eval.md; đổi một luật ở đây thì sửa trang đó cùng lúc, vì số của các lượt đo chỉ so được khi
# cùng luật.

import re
import statistics
from decimal import Decimal, InvalidOperation

from assistant_eval_set import KINDS, Question

VERIFY_PREFIX = "Câu trả lời không qua bước kiểm"
# Mã của trợ lý khi bước sinh đã chạy mà hỏng: hết số token sinh, JSON sai dạng, mô hình trả lỗi (502), quá
# giờ (504). Đó là kết quả của mô hình trên câu đó, lặp lại được ở nhiệt độ 0, nên tính là trả lời sai chứ
# không làm hỏng cả lượt đo. Mã khác (503 mô hình chưa bật hay đang bận, 401, 429, không gọi được) là lỗi của
# lượt đo.
GENERATION_FAILED = (502, 504)
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")


def _value(raw: str) -> Decimal | None:
    # Đọc số theo cùng cách với bước kiểm số của trợ lý (verify.py): chấm ngăn hàng nghìn, phẩy thập phân, nên
    # "05" là 5 và "300" không khớp "30". Script không import mã của Tầng 2, nên chép luật đọc số ở đây.
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "." in raw and all(len(group) == 3 for group in raw.split(".")[1:]):
        raw = raw.replace(".", "")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def numbers(text: str) -> set[Decimal]:
    return {value for raw in _NUMBER.findall(text) if (value := _value(raw)) is not None}


def refused_by(answer: dict) -> str | None:
    """Bước đã từ chối: retrieval (không đoạn nào đạt ngưỡng), verify (bước kiểm), model (mô hình từ chối)."""
    if answer["outcome"] != "refused":
        return None
    if answer.get("model") is None:
        return "retrieval"
    return "verify" if (answer.get("reason") or "").startswith(VERIFY_PREFIX) else "model"


def cited(answer: dict) -> list[str]:
    keys = (f"{c['document_id']}/{c['passage_id']}" for c in answer.get("citations") or [])
    return list(dict.fromkeys(keys))


def verdict(question: Question, status: int, answer: dict | None) -> str:
    """correct, wrong-citation, missing-number, refused, answered (phải từ chối mà trả lời), failed, error."""
    if answer is None:
        return "failed" if status in GENERATION_FAILED else "error"
    if question.refuse:
        return "correct" if answer["outcome"] == "refused" else "answered"
    if answer["outcome"] == "refused":
        return "refused"
    if not set(cited(answer)) & set(question.expect):
        return "wrong-citation"
    wanted = {value for raw in question.numbers if (value := _value(raw)) is not None}
    return "correct" if wanted <= numbers(answer.get("answer") or "") else "missing-number"


def _quantiles(values: list[float]) -> dict | None:
    if not values:
        return None
    ordered = sorted(values)
    # p90 theo hạng gần nhất: với vài chục câu, nội suy cho một số không phải thời gian của câu nào.
    p90 = ordered[max(0, -(-len(ordered) * 9 // 10) - 1)]
    return {"count": len(ordered), "median": round(statistics.median(ordered), 1), "p90": round(p90, 1)}


def summary(results: list[dict]) -> dict:
    answerable = [r for r in results if not r["refuse"]]
    out_of_scope = [r for r in results if r["refuse"]]
    by_kind = {}
    for kind in KINDS:
        rows = [r for r in results if r["kind"] == kind]
        if rows:
            by_kind[kind] = {
                v: sum(r["verdict"] == v for r in rows) for v in sorted({r["verdict"] for r in rows})
            }
            by_kind[kind]["total"] = len(rows)
    timed = [r for r in results if r["verdict"] != "error"]
    return {
        "citation_correct": sum(r["verdict"] == "correct" for r in answerable),
        "answerable": len(answerable),
        "number_correct": sum(r["verdict"] == "correct" for r in answerable if r["numbers"]),
        "number_questions": sum(bool(r["numbers"]) for r in answerable),
        "refusal_correct": sum(r["verdict"] == "correct" for r in out_of_scope),
        "out_of_scope": len(out_of_scope),
        "failed": sum(r["verdict"] == "failed" for r in results),
        "errors": sum(r["verdict"] == "error" for r in results),
        "refused_by": {
            stage: sum(r["refused_by"] == stage for r in answerable)
            for stage in ("retrieval", "model", "verify")
        },
        "by_kind": by_kind,
        "latency_all_s": _quantiles([r["seconds"] for r in timed]),
        "latency_model_s": _quantiles([r["seconds"] for r in timed if r["model_called"]]),
    }


def _latency(value: dict | None) -> str:
    return (
        "không có"
        if value is None
        else f"trung vị {value['median']} s, p90 {value['p90']} s ({value['count']} câu)"
    )


def markdown(run: dict) -> str:
    s, meta = run["summary"], run["meta"]
    models = (
        "; ".join(f"{m['name']} ({m['provider']}, {m['location']})" for m in meta["models"]) or "không gọi"
    )
    # Tệp kết quả được commit vào docs/, nên mang header giấy phép như mọi tệp khác (make check-fast kiểm).
    # REUSE-IgnoreStart
    lines = [
        "<!--",
        "SPDX-FileCopyrightText: 2026 Mortise DX contributors",
        "SPDX-License-Identifier: Apache-2.0",
        "-->",
        # REUSE-IgnoreEnd
        "",
        f"# Lượt đo trợ lý hỏi văn bản {meta['date']}",
        "",
        "Lượt đủ bộ câu."
        if meta["complete"]
        else "**Lượt không đủ bộ** (chọn một phần câu, hay có lỗi): không dùng làm kết quả.",
        "",
        f"- Bộ câu: `{meta['question_set']}` ({meta['question_set_sha256'][:12]}), commit {meta['commit']}",
        f"- Mô hình: {models}; ghim: {meta['pinned_model'] or 'không đọc được'}",
        f"- Máy chạy lệnh đo: {meta['machine']['cpu']}, {meta['machine']['cpus']} luồng, "
        f"{meta['machine']['ram_gib']} GiB RAM, {meta['machine']['os']}",
        f"- Cấu hình trợ lý trong compose.yaml: {meta['service_settings']}",
        "",
        "| Chỉ số | Kết quả |",
        "|---|---|",
        f"| Trích đúng (câu có đáp án) | {s['citation_correct']}/{s['answerable']} |",
        f"| Trong đó câu hỏi số | {s['number_correct']}/{s['number_questions']} |",
        f"| Từ chối đúng (ngoài phạm vi) | {s['refusal_correct']}/{s['out_of_scope']} |",
        "| Câu có đáp án bị từ chối, theo bước | "
        + ", ".join(f"{k} {v}" for k, v in s["refused_by"].items())
        + " |",
        f"| Bước sinh hỏng (502, 504), tính là sai | {s['failed']} |",
        f"| Lỗi của lượt đo (không gọi được, 503, 401, 429) | {s['errors']} |",
        f"| Độ trễ, câu có gọi mô hình | {_latency(s['latency_model_s'])} |",
        f"| Độ trễ, mọi câu | {_latency(s['latency_all_s'])} |",
        "",
        "| Loại câu | Chấm |",
        "|---|---|",
        *(
            f"| {kind} | "
            + ", ".join(f"{v} {n}" for v, n in counts.items() if v != "total")
            + f" (trên {counts['total']}) |"
            for kind, counts in s["by_kind"].items()
        ),
        "",
        "| Câu | Loại | Chấm | Đoạn trích | Giây | Lý do từ chối |",
        "|---|---|---|---|---|---|",
    ]
    for r in run["results"]:
        reason = (r["reason"] or "").replace("|", "/")[:120]
        cells = (r["id"], r["kind"], r["verdict"], ", ".join(r["cited"]) or "-", r["seconds"], reason)
        lines.append("| " + " | ".join(str(cell) for cell in cells) + " |")
    return "\n".join(lines) + "\n"
