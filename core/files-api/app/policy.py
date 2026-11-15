# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Phần thuần của files-api, không gọi mạng nên kiểm thử đầy đủ được: người gọi, lỗi trả về,
# kiểm tên tệp, đếm cỡ và tính sha256 trong lúc nhận, tên tệp cho header tải xuống.

import hashlib
import unicodedata
from dataclasses import dataclass
from urllib.parse import quote

# Đủ cho tên tệp thật; giữ trong giới hạn của cột name (core.files) và của header HTTP.
MAX_NAME_LENGTH = 255


@dataclass(frozen=True)
class Caller:
    sub: str
    username: str
    tenant: str


class Denied(Exception):
    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def clean_name(name: str | None) -> str:
    """Tên tệp hiển thị: bỏ phần thư mục và ký tự điều khiển; tên rỗng hay quá dài thì từ chối."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if unicodedata.category(ch) != "Cc").strip()
    if not base or base in {".", ".."}:
        raise Denied(400, "Thiếu tên tệp: gửi kèm tham số name, ví dụ ?name=bien-ban.pdf.")
    if len(base) > MAX_NAME_LENGTH:
        raise Denied(400, f"Tên tệp dài quá {MAX_NAME_LENGTH} ký tự.")
    return base


class Receiver:
    """Đếm cỡ và tính sha256 từng đoạn trong lúc nhận; vượt giới hạn thì dừng ngay, không nhận hết tệp."""

    def __init__(self, limit: int):
        self.limit = limit
        self.size = 0
        self._digest = hashlib.sha256()

    def add(self, chunk: bytes) -> None:
        self.size += len(chunk)
        if self.size > self.limit:
            raise Denied(413, f"Tệp lớn quá giới hạn {self.limit // (1024 * 1024)} MB.")
        self._digest.update(chunk)

    def finish(self) -> str:
        if self.size == 0:
            raise Denied(400, "Tệp rỗng.")
        return self._digest.hexdigest()


def content_disposition(name: str) -> str:
    """Luôn tải về thay vì mở trong trình duyệt; tên có dấu đi qua filename* (RFC 6266)."""
    ascii_name = name.encode("ascii", "replace").decode().replace('"', "_").replace("?", "_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"
