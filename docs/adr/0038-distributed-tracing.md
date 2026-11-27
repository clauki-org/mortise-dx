<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0038. Truy vết phân tán bằng OpenTelemetry, lưu trong Jaeger của profile `observability`, mặc định tắt

- Trạng thái: Chấp nhận
- Ngày: 2026-11-25

## Bối cảnh

Một yêu cầu chậm hay lỗi đi qua cổng, một dịch vụ tự viết rồi tới Flowable, Scorpio, CSDL hay mô hình ngôn ngữ. Số
liệu và log của ADR 0037 cho biết route nào chậm, không cho biết chậm ở chặng nào của một yêu cầu (#171). Truy vết
phân tán ghi mỗi chặng thành một span, các span của một yêu cầu chung một mã vết.

Ràng buộc: vết không được chứa token hay dữ liệu cá nhân; lõi chạy như cũ khi tắt truy vết và khi không bật profile
`observability`; xem trong Grafana đã có.

Đã kiểm ngày 2026-11-25 trên đúng phiên bản ghim:

- APISIX 3.19.0 có plugin `opentelemetry` (gửi OTLP HTTP), nhưng plugin này không nằm trong danh sách plugin mặc định;
  khai `plugins` trong `config.yaml` thì APISIX chỉ nạp đúng các plugin liệt kê. Span của plugin có `http.target` kèm
  chuỗi truy vấn và user-agent; không ghi header hay địa chỉ người gọi.
- Dịch vụ tự viết dùng FastAPI và HTTPX, có instrumentation OpenTelemetry chính thức; pg8000 thì không có.
- Jaeger 2.21.0 trở đi bỏ các endpoint HTTP `/api/services`, `/api/operations` và tìm vết `/api/traces` (Jaeger PR
  #9260); nguồn dữ liệu Jaeger của Grafana 13.3.1 (plugin 13.0.8) dùng chúng để kiểm kết nối và tìm vết: với Jaeger
  2.23.0, Grafana chỉ mở được vết theo mã, kiểm kết nối báo 404. Jaeger 2.20.0 còn đủ các endpoint đó.

Nơi lưu vết đã xét:

| Lựa chọn | Giấy phép | Đánh giá |
|---|---|---|
| Jaeger v2 | Apache-2.0 | Một container: nhận OTLP, lọc thuộc tính bằng processor `attributes` của OpenTelemetry Collector có sẵn trong bản dựng, lưu Badger trên volume, có API truy vấn cho Grafana |
| Grafana Tempo | AGPL-3.0 | Nhận OTLP; tài liệu cấu hình của Tempo không có processor xóa thuộc tính, nên lọc phải đặt ở một collector phía trước: thêm một container, và thêm một thành phần AGPL-3.0 |

## Quyết định

**Thành phần.** Jaeger 2.20.0 (image `jaegertracing/jaeger`, Apache-2.0), một container trong profile
`observability`, cấu hình ở `core/observability/jaeger.yaml`. Ghim 2.20.0 vì lý do ở Bối cảnh; nâng bản khi plugin
Jaeger của Grafana dùng API v3. Không mở cổng nào ra máy chủ: APISIX và dịch vụ gửi vết tới `jaeger:4318`, Grafana đọc
ở `jaeger:16686`, đều trong mạng nội bộ. Badger lưu ở volume `jaegerdata`, giữ 7 ngày như log; là điểm xuất phát, chưa
đo dung lượng đĩa.

**Công tắc.** `MORTISE_TRACING` trong `.env`, chỉ nhận `on` hoặc `off`, mặc định `off`; đổi xong chạy `make up`.
`scripts/compose.sh` từ chối giá trị khác, vì `compose.yaml` ghép giá trị thành tên bộ lấy mẫu của cổng
(`always_on`, `always_off`) và tên lạ làm cổng trả 503 cho mọi API dưới /v1 (đã thử). Biến ở môi trường thắng `.env`,
như mọi biến của compose. Bật truy vết mà chưa `make obs-up` thì yêu cầu vẫn chạy, cổng và dịch vụ ghi lỗi gửi vết vào
log theo từng lô (thử ngày 2026-11-25: một lượt `make smoke` để lại khoảng 20 dòng ở cổng và 30 dòng ở các dịch vụ).

**Cổng.** Plugin `opentelemetry` nằm trong bộ xác thực chung `bearer-token` của `apisix.yaml`, nên chỉ các API dưới
/v1 có route (graphql, workflow, files, context, assistant) được truy vết, kể cả yêu cầu bị 401. `/auth` và giao diện
`/` không được truy vết vì URL của chúng mang mã đăng nhập. Bật thì lưu mọi yêu cầu (`always_on`). Địa chỉ Jaeger và
`set_ngx_var` nằm trong `plugin_metadata`. Danh sách `plugins` trong `config.yaml` liệt kê mọi plugin đang dùng; dùng
thêm plugin nào thì thêm vào đó.

**Dịch vụ tự viết.** workflow-api, files-api, context-api và assistant: bật thì Dockerfile chạy uvicorn dưới
`opentelemetry-instrument`, tắt thì chạy như trước, không instrumentation nào được nạp. Ghi span server của FastAPI
(trừ `/healthz`), span client của HTTPX (Flowable, Scorpio, Ollama hay API mô hình, cổng khi assistant gọi GraphQL) và
span tự viết quanh mỗi lần dùng CSDL qua pg8000, chỉ ghi loại câu (`SELECT`, `INSERT`...). Dịch vụ theo quyết định lấy
mẫu của cổng (mặc định `parentbased_always_on`). Gói OpenTelemetry ghim đúng bản trong `pyproject.toml` (SDK 1.45.2,
instrumentation 0.66b2, còn là bản beta).

**Không truy vết.** Keycloak, Hasura, Flowable, Scorpio, SeaweedFS, ClamAV bên trong; lời gọi S3 và clamd của
files-api; iot-bridge (MQTT, không có FastAPI): lời gọi của nó tới workflow-api thành một vết riêng bắt đầu ở
workflow-api.

**Dữ liệu cá nhân.** Processor `attributes/privacy` của Jaeger chạy trước khi lưu: xóa `url.query`, `http.target`,
user-agent, địa chỉ và cổng của người gọi; `url.full`, `http.url` được tách phần trước dấu `?` sang `url_without_query`
rồi xóa, vì chuỗi truy vấn mà workflow-api gửi Flowable có id người dùng. Không nơi nào ghi header (không đặt
`OTEL_INSTRUMENTATION_HTTP_CAPTURE_HEADERS_*`, không đặt `additional_header_prefix_attributes` cho plugin), thân yêu cầu,
câu SQL hay tham số.

**Nối log với vết.** Log truy cập của cổng thêm `trace_id=` ở cuối; dịch vụ tự viết khi bật truy vết ghi log mức
WARNING trở lên kèm `trace_id=`. Grafana có nguồn dữ liệu Jaeger (uid `jaeger`); trong Loki, trường `trace_id` mở vết
trong Jaeger, và từ một span mở các dòng log chứa mã vết của mọi dịch vụ. Không lọc theo dịch vụ được: nguồn Jaeger của
Grafana tách `service.name` khỏi thẻ của span, nên cách nối theo thẻ không ra nhãn `service`.

**Kiểm tra.** Khi cổng đang bật truy vết, `make obs-check` lấy token của `user.a`, gọi `GET /v1/workflow/tasks` qua cổng
với một chuỗi truy vấn và user-agent ngẫu nhiên, tìm mã vết trong log của cổng ở Loki, đọc vết qua Grafana và kiểm: có
span server của cổng, span server của workflow-api là con của nó, span client từ workflow-api tới Flowable; vết không
chứa `Bearer`, chữ ký token, `?`, chuỗi ngẫu nhiên hay `user.a`. Đã thử tắt processor lọc thì bài cuối báo lỗi. Truy
vết tắt thì chỉ kiểm Grafana đọc được Jaeger. CI bật truy vết cho bước giám sát, chạy `make obs-check` và `make smoke`,
rồi dựng lại lõi với truy vết tắt.

## Hệ quả

- **Chi phí khi bật chưa đo** (độ trễ, CPU, dung lượng vết); đo trước khi bật trên máy chủ thật hay trước khi ghi con
  số.
- **Khi tắt, lõi gần như như cũ:** cổng vẫn tạo span không lưu, chuyển header `traceparent` cho dịch vụ phía sau, và
  log truy cập có `trace_id` của vết không được lưu. Dịch vụ tự viết không nạp instrumentation; chỉ span quanh CSDL
  gọi API OpenTelemetry, không làm gì khi không có SDK.
- **Vẫn còn định danh trong vết:** `url.path` giữ id của task, tệp, thiết bị; tên tenant nằm trong id thiết bị. Không
  có tên hay id người dùng. Lỗi không bắt được trong FastAPI thành sự kiện của span kèm thông điệp lỗi.
- **Mã vết do client gửi được giữ:** cổng nhận header `traceparent` của client, nên client chọn được mã vết của yêu
  cầu mình. Vết chỉ người vận hành xem được trong Grafana.
- **Ai vào Grafana thì thấy vết của mọi tenant**, như log (ADR 0037).
- **Kết nối không mã hóa:** cổng ghi cảnh báo lúc khởi động vì gửi vết tới Jaeger qua HTTP; mọi lời gọi nằm trong mạng
  nội bộ của compose.
- **Plugin của cổng là danh sách đóng:** thêm plugin vào `apisix.yaml` mà quên `config.yaml` thì cấu hình đó bị từ chối.
- Vết không nằm trong `make backup`; `make reset` xóa cả volume `jaegerdata`.
- Bản cài cũ: `make up` không dựng lại image đã có, nên dịch vụ tự viết vẫn chạy image cũ, không có gói OpenTelemetry và
  không gửi vết khi bật. Dựng lại bằng `docker compose build workflow-api files-api context-api assistant` rồi `make
  up`; cổng nạp danh sách plugin mới khi được dựng lại (`make up` dựng lại vì biến môi trường mới).
