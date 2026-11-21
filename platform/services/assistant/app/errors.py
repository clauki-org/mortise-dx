# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Lỗi mà main.py đổi thành phản hồi {"error": "..."} cùng mã HTTP, như các dịch vụ của lõi. Từ chối trả lời vì
# không đủ căn cứ không phải lỗi: đó là câu trả lời hợp lệ (pipeline.py).


class Denied(Exception):
    def __init__(self, status: int, reason: str):
        super().__init__(reason)
        self.status = status
        self.reason = reason
