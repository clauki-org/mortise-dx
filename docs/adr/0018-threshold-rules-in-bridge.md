<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0018. Luật ngưỡng xét trong iot-bridge, mở hồ sơ qua workflow-api

- Trạng thái: Chấp nhận
- Ngày: 2026-11-20

## Bối cảnh

Số đo vượt ngưỡng liên tục một khoảng thời gian thì lõi phải tự mở hồ sơ kiểm tra trên bảng việc của đúng đơn vị,
không mở trùng khi hồ sơ cũ còn mở (#89). Ngưỡng và quy trình là nghiệp vụ nên do gói khai; lõi chỉ biết cách xét.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Một dịch vụ riêng hỏi Scorpio định kỳ | Thêm một dịch vụ phải bảo trì; hồ sơ mở chậm tới một chu kỳ hỏi |
| Đăng ký nhận thông báo (subscription) của Scorpio | Thêm một đường vào từ Scorpio và một nơi giữ đăng ký theo từng tenant |
| iot-bridge xét luật ngay sau khi ghi số đo | Không thêm dịch vụ; mọi số đo đã đi qua đây cùng tenant lấy từ chủ đề MQTT |

## Quyết định

- Luật theo `contracts/threshold-rule.schema.json`. Gói khai tệp luật ở mục `rules` của `app.yaml`; bộ cài gói nạp
  vào `core.threshold_rules` cho mọi tenant, gỡ gói thì xóa. `make seed` nạp luật mẫu của lõi
  (`contracts/examples/threshold-rule.example.yaml`) để `make smoke` kiểm đường mở hồ sơ.
- iot-bridge ghi số đo vào Scorpio trước, rồi mới xét luật của tenant. Lỗi khi xét luật hay khi mở hồ sơ chỉ ghi
  log: số đo không bị mất, vòng nhận tin không dừng.
- "Vượt liên tục" tính theo `observedAt`: từ lần đo vượt đầu tiên của chuỗi lần đo vượt liền nhau tới lần đo mới
  nhất. Lịch sử lấy từ API temporal của Scorpio (`RULE_HISTORY` lần đo gần nhất, mặc định 200), nên cầu nối khởi
  động lại hay dừng trong lúc sao lưu vẫn xét đúng.
- Scorpio ghi lịch sử sau khi trả lời lệnh ghi. Đo ngày 2026-11-20 trên bản cài cục bộ (gửi một tin rồi hỏi lịch sử
  mỗi 0,5 giây): lần đo vừa ghi xuất hiện sau khoảng 2,5 giây. Cầu nối nhớ thêm 20 lần đo gần nhất của mỗi thiết bị
  và số đo có luật, gộp với lịch sử, để lần đo vừa tới luôn được tính.
- Hồ sơ mở qua workflow-api bằng tài khoản dịch vụ ([ADR 0017](0017-service-account-for-tenant.md)), gọi thẳng trong
  mạng nội bộ. `Idempotency-Key` là băm của gói, luật và thiết bị: còn hồ sơ mở thì workflow-api trả lại hồ sơ đó.

## Hệ quả

- Đóng hồ sơ khi số đo vẫn vượt ngưỡng thì lần đo vượt kế tiếp mở hồ sơ mới.
- Luật giữ lâu hơn khoảng thời gian `RULE_HISTORY` lần đo phủ được thì không bao giờ mở hồ sơ; cầu nối ghi cảnh báo
  khi gặp trường hợp này.
- Mỗi lần đo vượt ngưỡng gây một lần hỏi lịch sử của Scorpio và, khi đủ lâu, một lần gọi workflow-api, chạy lần lượt
  trong vòng nhận tin. Thiết bị gửi dồn dập nhiều số đo có luật thì tin xếp hàng chờ.
- Luật chỉ có ngưỡng trên hoặc dưới một số đo của một loại entity; luật gộp nhiều số đo hay nhiều thiết bị cần quyết
  định riêng.
