# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Hỏi registry image danh sách tag, không đăng nhập, cho phần "Bản mới" của scripts/deps-check.py (ADR 0039).
# Dùng API registry chung (`/v2/<repo>/tags/list`), nên Docker Hub, ghcr.io và quay.io đi cùng một đường:
# registry trả 401 kèm `WWW-Authenticate` chỉ chỗ xin token ẩn danh; danh sách dài thì chia trang qua header
# `Link`.

import json
import re
import urllib.error
import urllib.parse
import urllib.request

from deps_pins import tag_version

TIMEOUT = 30
USER_AGENT = "mortise-deps-check"


def registry_of(repo: str) -> tuple[str, str]:
    """(máy chủ registry, đường dẫn repo). Tên không có máy chủ là image của Docker Hub; tên một phần là image
    chính thức, nằm dưới `library/`."""
    first, _, rest = repo.partition("/")
    if rest and ("." in first or ":" in first or first == "localhost"):
        return first, rest
    return "registry-1.docker.io", repo if rest else f"library/{repo}"


def fetch(url: str, token: str | None = None, accept: str | None = None):
    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if accept:
        headers["Accept"] = accept
    request = urllib.request.Request(url, headers=headers)  # noqa: S310
    return urllib.request.urlopen(request, timeout=TIMEOUT)  # noqa: S310


def anonymous_token(challenge: str) -> str:
    fields = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    realm = fields.pop("realm", None)
    if not challenge.startswith("Bearer") or not realm:
        raise RuntimeError(f"registry đòi cách xác thực không hỗ trợ: {challenge[:60]}")
    with fetch(f"{realm}?{urllib.parse.urlencode(fields)}") as response:
        body = json.load(response)
    return body.get("token") or body["access_token"]


def get_json(
    url: str, token: str | None = None, accept: str | None = None
) -> tuple[dict, str | None, str | None]:
    """(JSON, header Link, token). Gặp 401 thì xin token ẩn danh theo challenge rồi hỏi lại một lần;
    token trả về để trang sau của cùng danh sách không phải xin lại."""
    try:
        with fetch(url, token, accept) as response:
            return json.load(response), response.headers.get("Link"), token
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
        token = anonymous_token(error.headers.get("WWW-Authenticate", ""))
    with fetch(url, token, accept) as response:
        return json.load(response), response.headers.get("Link"), token


def list_tags(repo: str) -> list[str]:
    host, path = registry_of(repo)
    url: str | None = f"https://{host}/v2/{path}/tags/list?n=10000"
    tags: list[str] = []
    token = None
    while url:
        body, link, token = get_json(url, token)
        tags += body.get("tags") or []
        match = re.search(r"<([^>]+)>;\s*rel=\"?next\"?", link or "")
        url = urllib.parse.urljoin(f"https://{host}/", match.group(1)) if match else None
    return tags


def newest_tag(current: str, tags: list[str]) -> str | None:
    """Tag mới nhất cùng khuôn với tag đang dùng: cùng tiền tố, hậu tố và số phần của phiên bản. Nhờ vậy
    bản rc, alpha hay biến thể khác (`-alpine`, `_full`) không lọt vào, và `pg17` trong tag của pgvector giữ
    nguyên."""
    parts = tag_version(current)
    if parts is None:
        return None
    prefix, version, suffix = parts
    pattern = re.compile(re.escape(prefix) + r"(\d+(?:\.\d+)*)" + re.escape(suffix))
    size = version.count(".")
    best, best_key = None, tuple(int(n) for n in version.split("."))
    for tag in tags:
        match = pattern.fullmatch(tag)
        if not match or match.group(1).count(".") != size:
            continue
        key = tuple(int(n) for n in match.group(1).split("."))
        if key > best_key:
            best, best_key = tag, key
    return best


def ollama_weights(name: str) -> str:
    """Digest lớp trọng số mà tag của mô hình đang trỏ tới trên registry của Ollama."""
    model, _, tag = name.partition(":")
    path = model if "/" in model else f"library/{model}"
    body, _, _ = get_json(
        f"https://registry.ollama.ai/v2/{path}/manifests/{tag}",
        accept="application/vnd.docker.distribution.manifest.v2+json",
    )
    layers = [la["digest"] for la in body.get("layers", []) if la.get("mediaType", "").endswith(".model")]
    if not layers:
        raise RuntimeError("manifest không có lớp trọng số")
    return layers[0]
