# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kiểm phần quét mã độc với một clamd giả trên socket cục bộ: đọc đúng câu trả lời, gửi đủ nội dung theo
# giao thức INSTREAM, và từ chối (503) mọi trường hợp chưa quét được thay vì cho tệp đi qua.

import io
import socket
import struct
import threading

import pytest

from app import scan
from app.policy import Denied


def test_verdict_reads_clean_infected_and_error():
    assert scan.verdict(b"stream: OK\0") is None
    assert scan.verdict(b"stream: Eicar-Test-Signature FOUND\0") == "Eicar-Test-Signature"
    with pytest.raises(ValueError, match="size limit"):
        scan.verdict(b"INSTREAM size limit exceeded. ERROR\0")
    with pytest.raises(ValueError):
        scan.verdict(b"")


def _fake_clamd(reply: bytes) -> tuple[int, list[bytes]]:
    """clamd giả: nhận một yêu cầu INSTREAM, ghi lại nội dung đã nhận, trả `reply`."""
    server = socket.create_server(("127.0.0.1", 0))
    received: list[bytes] = []

    def serve():
        conn, _ = server.accept()
        with conn, server:
            stream = conn.makefile("rb")
            assert stream.read(10) == b"zINSTREAM\0"
            body = b""
            while size := struct.unpack(">I", stream.read(4))[0]:
                body += stream.read(size)
            received.append(body)
            conn.sendall(reply)

    threading.Thread(target=serve, daemon=True).start()
    return server.getsockname()[1], received


def test_clean_file_passes_and_whole_body_is_sent():
    port, received = _fake_clamd(b"stream: OK\0")
    body = b"x" * (200 * 1024)
    scan.check(io.BytesIO(body), "127.0.0.1", port, timeout=5)
    assert received == [body]


def test_infected_file_is_refused_with_422():
    port, _ = _fake_clamd(b"stream: Eicar-Test-Signature FOUND\0")
    with pytest.raises(scan.Infected) as caught:
        scan.check(io.BytesIO(b"abc"), "127.0.0.1", port, timeout=5)
    assert caught.value.status == 422
    assert "Eicar-Test-Signature" in caught.value.reason


def test_scan_limit_is_refused_with_its_own_reason():
    port, _ = _fake_clamd(b"stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND\0")
    with pytest.raises(scan.Infected) as caught:
        scan.check(io.BytesIO(b"abc"), "127.0.0.1", port, timeout=5)
    assert caught.value.status == 422
    assert "vượt giới hạn quét" in caught.value.reason


def test_clamd_error_is_refused_with_503():
    port, _ = _fake_clamd(b"INSTREAM size limit exceeded. ERROR\0")
    with pytest.raises(Denied) as caught:
        scan.check(io.BytesIO(b"abc"), "127.0.0.1", port, timeout=5)
    assert caught.value.status == 503


def test_clamd_down_is_refused_with_503():
    # Lấy một cổng vừa được cấp rồi đóng lại: không còn ai nghe ở đó.
    with socket.create_server(("127.0.0.1", 0)) as closed:
        port = closed.getsockname()[1]
    with pytest.raises(Denied) as caught:
        scan.check(io.BytesIO(b"abc"), "127.0.0.1", port, timeout=5)
    assert caught.value.status == 503
