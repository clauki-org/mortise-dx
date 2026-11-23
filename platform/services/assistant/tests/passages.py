# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Đoạn dùng chung cho các kiểm thử, lấy theo văn bản mẫu hư cấu ở contracts/examples/knowledge*.example.yaml.

from app.retrieval import Caller, Passage

# Token giả: kiểm thử chỉ xem nó được chuyển nguyên cho Hasura.
USER_A = Caller(sub="u-a", tenant="xa-a", token="token-of-user-a", roles=("user",))  # noqa: S106

BOOKING = Passage(
    "example-rules",
    "Quy chế mẫu về đặt phòng họp (hư cấu)",
    "art-1-cl-2",
    "Điều 1 khoản 2",
    "Mỗi lần đặt không quá 4 giờ. Người đặt hủy trước giờ họp ít nhất 1 giờ nếu không dùng.",
)
AMENDMENT = Passage(
    "example-rules-amendment",
    "Quyết định mẫu sửa quy chế đặt phòng họp (hư cấu)",
    "art-1",
    "Điều 1",
    "Sửa khoản 1 Điều 1 của Quy chế mẫu như sau. Phòng họp được đặt trước tối đa 14 ngày.",
)
PASSAGES = [BOOKING, AMENDMENT]
