# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Quét mã độc nội dung tệp bằng clamd (dịch vụ clamav trong compose.yaml) qua giao thức INSTREAM
# trên TCP, trước khi tệp được lưu. Chưa quét được thì từ chối tải lên: cho tệp đi qua khi clamd
# chết thì kẻ tấn công chỉ cần làm clamd quá tải là lọt. Chỉ module này biết clamd.

import logging
import socket
import struct
from typing import BinaryIO

from .policy import Denied

log = logging.getLogger("files-api.scan")

# clamd nhận nội dung theo từng khối có tiền tố độ dài 4 byte; khối độ dài 0 báo hết tệp.
_CHUNK = 64 * 1024


# clamd chạy với AlertExceedsMax (compose.yaml): phần tệp vượt giới hạn quét được báo bằng mẫu có tiền tố này.
_LIMITS = "Heuristics.Limits.Exceeded"


class Infected(Denied):
    """Tệp bị từ chối theo kết quả quét: khớp mẫu mã độc, hoặc không quét hết được vì vượt giới hạn quét."""

    def __init__(self, signature: str):
        if signature.startswith(_LIMITS):
            reason = f"Tệp vượt giới hạn quét ({signature}) nên không kiểm hết được; tệp không được lưu."
        else:
            reason = f"Tệp chứa mã độc ({signature}); tệp không được lưu."
        super().__init__(422, reason)
        self.signature = signature


def verdict(reply: bytes) -> str | None:
    """Đọc câu trả lời của clamd: None nếu sạch, tên mẫu nhận diện nếu nhiễm; lỗi khác thì ValueError.

    Dạng trả lời: `stream: OK`, `stream: <mẫu> FOUND`, hoặc `<lý do> ERROR` (ví dụ vượt StreamMaxLength).
    """
    text = reply.rstrip(b"\0\n").decode("utf-8", "replace")
    if text == "stream: OK":
        return None
    if text.startswith("stream: ") and text.endswith(" FOUND"):
        return text.removeprefix("stream: ").removesuffix(" FOUND")
    raise ValueError(text or "clamd đóng kết nối mà không trả lời")


def _unavailable(reason: object) -> Denied:
    log.error("Không quét được mã độc: %s", reason)
    return Denied(503, "Chưa quét được mã độc nên chưa nhận tệp; báo người vận hành kiểm tra dịch vụ clamav.")


def _exchange(body: BinaryIO, host: str, port: int, timeout: float) -> bytes:
    with socket.create_connection((host, port), timeout=timeout) as conn:
        conn.sendall(b"zINSTREAM\0")
        try:
            while chunk := body.read(_CHUNK):
                conn.sendall(struct.pack(">I", len(chunk)) + chunk)
            conn.sendall(struct.pack(">I", 0))
        except (BrokenPipeError, ConnectionResetError):
            # clamd đóng chiều nhận khi gặp lỗi (ví dụ vượt StreamMaxLength) nhưng vẫn gửi lý do; đọc
            # tiếp để báo đúng lý do thay vì lỗi mạng chung chung.
            pass
        reply = b""
        while not reply.endswith(b"\0") and (part := conn.recv(4096)):
            reply += part
        return reply


def check(body: BinaryIO, host: str, port: int, timeout: float) -> None:
    """Quét nội dung từ vị trí hiện tại tới hết.

    Nhiễm thì Infected (422); không quét được thì Denied (503).
    """
    try:
        reply = _exchange(body, host, port, timeout)
    except OSError as error:
        raise _unavailable(error) from error
    try:
        signature = verdict(reply)
    except ValueError as error:
        raise _unavailable(error) from error
    if signature is not None:
        raise Infected(signature)
