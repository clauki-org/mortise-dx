# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Mã OTP (TOTP, RFC 6238) cho các tài khoản demo phải nhập OTP, tính từ DEMO_OTP_SECRET trong .env
# mà `make seed` gắn cho họ (ADR 0011, ADR 0040). Chỉ dùng cho bản cài demo và kiểm thử; người dùng
# thật cài OTP trên điện thoại khi đăng nhập lần đầu.
#   show         in mã hiện tại và khóa để nhập vào ứng dụng OTP trên điện thoại (make otp)
#   next <tên>   in một mã chưa dùng cho tài khoản đó (smoke, e2e)
# Keycloak không nhận lại mã đã dùng (otpPolicyCodeReusable false) và nhận mã của khung 30 giây trước, hiện
# tại và sau (otpPolicyLookAheadWindow 1). `next` nhớ khung đã dùng của từng tài khoản trong thư mục tạm, lấy
# khung kế tiếp trong hai khung hiện tại và sau, và chờ sang khung mới khi đã dùng hết, để các lần đăng nhập
# liên tiếp không bị từ chối vì dùng lại mã.

import base64
import fcntl
import hashlib
import hmac
import os
import re
import struct
import sys
import tempfile
import time
from pathlib import Path

PERIOD = 30
DIGITS = 6


def env_value(name: str) -> str | None:
    """Biến ở môi trường, không có thì đọc .env của checkout."""
    value = os.environ.get(name)
    if not value:
        env = Path(__file__).resolve().parent.parent / ".env"
        text = env.read_text(encoding="utf-8") if env.exists() else ""
        found = re.search(rf"^{name}=(.+)$", text, re.M)
        value = found.group(1).strip() if found else None
    return value


def secret() -> str:
    value = env_value("DEMO_OTP_SECRET")
    if not value:
        raise SystemExit("Thiếu DEMO_OTP_SECRET trong .env; chạy `make env` rồi `make seed`.")
    return value


def code(key: str, counter: int) -> str:
    # Keycloak dùng chính các byte của chuỗi khóa làm khóa HMAC.
    digest = hmac.new(key.encode(), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(number % 10**DIGITS).zfill(DIGITS)


def fresh_counter(username: str) -> int:
    """Khung chưa dùng sớm nhất mà Keycloak còn nhận; ghi lại để lần sau không dùng lại."""
    if not re.fullmatch(r"[A-Za-z0-9._-]+", username):
        raise SystemExit(f"Tên tài khoản không hợp lệ: {username}")
    # Một tệp cho mỗi bản cài (tên dự án compose), không cho mỗi checkout: nhiều worktree có thể cùng gọi một
    # Keycloak. Hai bản cài trên cùng máy (ADR 0058) có tài khoản trùng tên ở hai Keycloak; chung tệp thì lần
    # đăng nhập ở bản này phải chờ khung mới chỉ vì mã đã dùng ở bản kia.
    project = env_value("COMPOSE_PROJECT_NAME") or "mortise"
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise SystemExit(f"COMPOSE_PROJECT_NAME không hợp lệ: {project}")
    suffix = "" if project == "mortise" else f"-{project}"
    path = Path(tempfile.gettempdir()) / f"mortise-otp-{os.getuid()}{suffix}-{username}"
    # Khóa tệp trong lúc đọc và ghi: hai tiến trình (smoke và e2e chạy cùng lúc) đọc cùng khung đã dùng sẽ lấy
    # cùng một mã, và Keycloak từ chối lần thứ hai.
    with path.open("a+") as state:
        fcntl.flock(state, fcntl.LOCK_EX)
        state.seek(0)
        # Tệp hỏng (ví dụ tiến trình bị dừng giữa lúc ghi) thì coi như chưa dùng mã nào; tệ nhất là một lần bị
        # từ chối vì dùng lại mã.
        recorded = state.read().strip()
        last = int(recorded) if recorded.isdigit() else 0
        while True:
            now = int(time.time()) // PERIOD
            # Không dùng khung trước dù Keycloak còn nhận: lấy mã ở cuối khung thì tới lúc Keycloak kiểm,
            # khung đã sang và mã thành quá cũ, đăng nhập bị từ chối ngẫu nhiên (smoke, e2e đỏ khi lời gọi rơi
            # đúng ranh giới 30 giây). Mã của khung hiện tại vẫn được nhận khi khung đã sang.
            counter = max(now, last + 1)
            if counter <= now + 1:
                state.seek(0)
                state.truncate()
                state.write(str(counter))
                return counter
            time.sleep(PERIOD - time.time() % PERIOD + 0.5)


def main() -> int:
    if sys.argv[1:2] == ["show"]:
        key = secret()
        print(f"Mã hiện tại: {code(key, int(time.time()) // PERIOD)}")
        base32 = base64.b32encode(key.encode()).decode()
        print(f"Khóa nhập vào ứng dụng OTP (TOTP, SHA1, 6 số, 30 giây): {base32}")
        return 0
    if len(sys.argv) == 3 and sys.argv[1] == "next":
        print(code(secret(), fresh_counter(sys.argv[2])))
        return 0
    print("Cách dùng: otp.py show | otp.py next <tên tài khoản>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
