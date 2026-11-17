<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0012. Dữ liệu thiết bị: nhận qua MQTT, giữ theo NGSI-LD trong Scorpio, đọc qua context-api

- Trạng thái: Chấp nhận
- Ngày: 2026-11-16

## Bối cảnh

Quy trình nghiệp vụ cần số đo của thiết bị hiện trường (cảm biến hiện diện, công tơ điện, nhiệt độ và độ ẩm). Trạng
thái thiết bị phải đọc được theo một chuẩn mở, để gói và ứng dụng khác dùng lại mà không phụ thuộc mã của nền tảng;
AGENTS.md chọn NGSI-LD (ETSI) cho việc này. Mỗi đơn vị chỉ được thấy thiết bị của mình.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Scorpio (BSD-3-Clause) | Broker NGSI-LD đầy đủ, lưu trên PostgreSQL có PostGIS, có bản native không cần Kafka |
| Orion-LD (AGPL-3.0) | Cần MongoDB, mà MongoDB theo SSPL, không phải giấy phép OSI |
| Stellio (Apache-2.0) | Cần thêm Kafka và TimescaleDB, nhiều dịch vụ hơn nhu cầu |
| Tự viết một phần NGSI-LD trên CSDL chính | Nhẹ nhất, nhưng chỉ là một phần của chuẩn |
| Bảng PostgreSQL đọc qua Hasura | Hợp với giao diện hiện có nhưng không phải NGSI-LD |

## Quyết định

- Scorpio `scorpiobroker/all-in-one-runner:linux-amd64-6.0.2` với CSDL riêng `postgis/postgis:17-3.6`. Scorpio
  bắt buộc PostGIS (thiếu thì không khởi động), image CSDL chính không có, và tự dựng image CSDL chính thì trái
  quy tắc dùng image chính thức. Scorpio tự tạo lược đồ, và tạo một CSDL cho mỗi tenant ở lần ghi đầu tiên.
- Scorpio không xác thực, nên không có route qua cổng. Lớp context-api (Python, cùng kiểu workflow-api, ADR 0004)
  đứng tại `/v1/context`:
  - kiểm lại token bằng JWKS của Keycloak;
  - đặt header `NGSILD-Tenant` bằng tenant trong token; header do người gọi gửi không được chuyển tiếp;
  - chỉ mở `GET /v1/context/entities` và `GET /v1/context/entities/{id}`; chỉ chuyển các tham số `type`, `id`,
    `idPattern`, `attrs`, `q`, `limit`, `offset`, mỗi tham số tối đa 300 ký tự; tham số khác trả 400;
  - tenant trong token phải là slug (chữ thường, số, gạch nối), vì nó thành header HTTP và tên CSDL ở Scorpio;
  - lỗi nội bộ của Scorpio chỉ ghi log, client nhận thông báo chung;
  - tenant chưa có dữ liệu thì danh sách rỗng; entity không có thì 404, như nhau với mọi lý do.
- Ghi dữ liệu không đi qua cổng mà qua MQTT:
  - Mosquitto `eclipse-mosquitto:2.1.2-alpine` (EPL-2.0) chỉ nằm trong mạng compose `ot` (`internal`, không có
    đường ra internet, các dịch vụ khác của lõi không nằm trong đó), không mở cổng ra máy chủ. Không cho kết nối
    không tài khoản.
  - Mỗi thiết bị một tài khoản `<tenant>.<thiết bị>` (`make device-add`, mật khẩu ngẫu nhiên), chỉ được gửi vào
    `mortise/<tenant>/<thiết bị>`; quyền ghi từng dòng cho từng tài khoản vì quyền theo mẫu của Mosquitto không
    nhận tên có `/`. Tin gửi sai chủ đề bị Mosquitto bỏ mà không báo lỗi.
  - Cầu nối `core/iot-bridge` (Python, paho-mqtt) đọc `mortise/+/+`, lấy tenant và thiết bị từ chủ đề, không bao
    giờ từ nội dung tin; kiểm tin theo `contracts/device-message.schema.json` (số đo là số hay true/false, tên
    không trùng tên dành riêng của NGSI-LD); chỉ ghi cho tenant có trong `core.tenants` (vai trò CSDL
    `iot_bridge` chỉ đọc bảng đó), CSDL lỗi thì không ghi; ghi bằng upsert `options=update` nên số đo gửi riêng
    không làm mất số đo khác. Tin hỏng chỉ bị bỏ kèm một dòng log.
  - Bộ giả lập `devices/simulator` đăng nhập bằng tài khoản của từng thiết bị demo và gửi đúng định dạng của hợp
    đồng, như thiết bị thật; `make smoke` (chạy trong CI) gửi một lượt và kiểm số đo tới `/v1/context`.
  - Cầu nối đặt ở lõi chứ không ở Tầng 2 (`platform/services/`), vì nó ghi thẳng vào Scorpio và đọc CSDL, còn
    Tầng 2 chỉ gọi lõi qua cổng.
  Cổng của Scorpio mở ở `127.0.0.1` cho người vận hành và smoke.
- `make backup` dump cả cụm CSDL của Scorpio (`scorpio.sql.gz`), vì mỗi tenant là một CSDL; `make restore` nạp lại.
  Bản sao lưu cũ không có tệp này thì giữ CSDL Scorpio hiện tại.

Đã thử ngày 2026-11-16 trên Scorpio 6.0.2:
- đọc tenant khác hay tenant không tồn tại trả 404 `TenantNotFound` và không tạo CSDL; chỉ lần ghi đầu mới tạo;
- `/types`, `/attributes`, `/subscriptions`, `/temporal/entities` đều lọc theo tenant; không gửi tenant thì đọc
  tenant mặc định, trống; tenant truyền bằng tham số URL bị bỏ qua; `/jsonldContexts` dùng chung cho mọi tenant;
- chạy trong mạng Docker không có đường ra internet vẫn ghi và đọc được (ngữ cảnh lõi NGSI-LD có sẵn trong image);
- sao lưu, xóa sạch lõi, dựng lại, khôi phục: entity của tenant đọc lại được.

Đã thử ngày 2026-11-17 trên Mosquitto 2.1.2 (`make smoke`): thiết bị gửi vào chủ đề của tenant khác thì số đo không
tới; không tài khoản hay sai mật khẩu bị từ chối; thiết bị đăng ký đọc `mortise/#` được Mosquitto nhận lệnh nhưng
không nhận được tin nào của thiết bị khác; tin không phải JSON gửi trước không làm mất tin hợp lệ gửi sau. Đo cùng
ngày bằng `docker stats` khi rảnh: Mosquitto 3 MiB, iot-bridge 26 MiB; `make up` từ dữ liệu trắng 38–49 giây (ba lần đo).

Đo ngày 2026-11-16 bằng `docker stats` khi rảnh, sau khi khôi phục: Scorpio 53 MiB, CSDL của nó 112 MiB, context-api
44 MiB; cả lõi khoảng 3,0 GiB. `make up` từ dữ liệu trắng vẫn 43 giây.

## Hệ quả

- Thêm hai container bên thứ ba và một dịch vụ tự viết. Bản native của Scorpio chỉ có cho amd64; máy ARM chạy qua
  giả lập của Docker, chậm hơn, chưa đo.
- Tách tenant dựa vào hai điều: context-api luôn đặt header tenant từ token, và Scorpio tách mỗi tenant một CSDL.
  Ai gọi thẳng được cổng của Scorpio (trong máy chủ hay trong mạng compose) thì đọc và ghi được mọi tenant.
- Một tenant mới chỉ có CSDL ở Scorpio khi thiết bị của nó gửi số đo lần đầu; cầu nối chặn ghi cho tenant không có
  trong `core.tenants`, và `make device-add` không cấp tài khoản cho tenant đó.
- Không bảo đảm mọi số đo đều tới: tin gửi lúc cầu nối đang kết nối lại bị mất (Mosquitto không giữ phiên); tin
  cầu nối đã nhận mà Scorpio hay CSDL đang lỗi thì bị bỏ kèm log. Với số đo gửi định kỳ, số đo sau thay số đo mất.
  Tenant vừa bị xóa vẫn ghi được tới 60 giây (thời gian cầu nối nhớ tenant có thật).
- Mật khẩu MQTT đi trên mạng compose không mã hóa. Thiết bị thật ở ngoài máy chủ sẽ cần một cổng MQTT qua TLS và
  cách cấp tài khoản không phải lệnh trên máy chủ: kế hoạch, chưa làm. Tài khoản thiết bị demo dùng chung
  `DEMO_DEVICE_PASSWORD`.
- `q` và `idPattern` (biểu thức chính quy) chạy trên Scorpio dùng chung cho mọi tenant. Giới hạn độ dài và giới
  hạn tần suất của cổng không chặn hết được một biểu thức chạy lâu; người của một tenant có thể làm chậm việc đọc của
  tenant khác. Chưa đo.
- Chưa mở qua cổng: lịch sử số đo (`/temporal`), loại entity (`/types`), đăng ký nhận thông báo; mở thêm thì phải
  kiểm từng đường như trên.
- Lược đồ của Scorpio nằm ngoài dbmate (ADR 0005): đó là dữ liệu của thành phần bên thứ ba, Scorpio tự nâng cấp.
- Số đo thiết bị không gắn nhật ký thay đổi (ADR 0009): đó là dữ liệu thiết bị ghi thêm, không phải dữ liệu người
  dùng sửa.
