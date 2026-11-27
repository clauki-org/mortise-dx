<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Bản ghi quyết định kiến trúc

Mỗi quyết định quan trọng là một tệp đánh số ở đây, theo định dạng của Michael Nygard trong
[Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Trạng thái, Bối cảnh, Quyết định, Hệ quả. Chúng giải thích vì sao dự án như hiện nay, để không ai phải đoán lại.

## Quy tắc

- Mỗi tệp một quyết định, tên `NNNN-short-title.md`, đánh số theo thứ tự. Sao chép từ [template.md](template.md).
- Quyết định thay đổi kiến trúc, phạm vi, thành phần hay quy ước có bản ghi trong cùng pull request.
- Bản ghi đã chấp nhận không sửa, trừ lỗi chính tả hoặc thêm liên kết. Quyết định thay đổi là một bản ghi mới thay
  thế bản cũ; trạng thái bản cũ đổi thành `Bị thay thế bởi NNNN`.
- Câu hỏi còn mở là issue gắn nhãn `needs-decision`. Khi chốt, kết quả thành một bản ghi ở đây và issue trỏ tới nó.

## Danh sách

| Số | Quyết định | Trạng thái |
|---|---|---|
| [0001](0001-project-conventions.md) | Tiếng Việt, Apache-2.0 và quy ước làm việc | Chấp nhận |
| [0002](0002-core-components.md) | Chọn thành phần lõi và kiểm tra giấy phép | Chấp nhận |
| [0003](0003-three-tier-layout.md) | Bố cục ba tầng: thành phần dùng chung và gói nghiệp vụ khai báo | Chấp nhận |
| [0004](0004-workflow-access-control.md) | Workflow: Flowable REST đứng sau lớp kiểm soát quyền workflow-api | Chấp nhận |
| [0005](0005-schema-migrations.md) | Thay đổi lược đồ CSDL bằng migration dbmate, mỗi gói một lịch sử riêng | Chấp nhận |
| [0006](0006-frontend-stack.md) | Giao diện Tầng 2: React, Mantine và component đọc cấu hình gói | Chấp nhận |
| [0007](0007-login-page-exception.md) | Trang đăng nhập là bề mặt giao diện duy nhất của lõi | Chấp nhận |
| [0008](0008-shared-api-contracts.md) | Hợp đồng API giữa các tầng trong `contracts/`, CI kiểm cả ví dụ đúng và ví dụ sai | Chấp nhận |
| [0009](0009-tamper-evident-audit-log.md) | Nhật ký thay đổi ghi bằng trigger, chuỗi băm phát hiện sửa, đối chiếu băm trong bản sao lưu | Chấp nhận |
| [0010](0010-upload-malware-scan.md) | Quét mã độc tệp tải lên bằng ClamAV, trước khi lưu, từ chối khi chưa quét được | Chấp nhận |
| [0011](0011-approver-mfa.md) | Người duyệt đăng nhập hai bước bằng OTP; workflow-api kiểm lại bằng claim `amr` | Chấp nhận |
| [0012](0012-device-context-ngsi-ld.md) | Dữ liệu thiết bị: nhận qua MQTT, giữ theo NGSI-LD trong Scorpio, đọc qua context-api | Chấp nhận |
| [0013](0013-component-config-contracts.md) | Thành phần Tầng 2 chỉ biết cấu hình của nó; schema cấu hình và bản mô tả trong `contracts/` | Chấp nhận |
| [0014](0014-cold-audit-archive.md) | Kho lạnh cho nhật ký thay đổi: Parquet trên SeaweedFS, truy vấn bằng DuckDB, chuỗi băm nối qua đoạn | Chấp nhận |
| [0015](0015-assignment-as-data.md) | Luật quyền là khai báo, phân công cán bộ theo cơ sở là dữ liệu xã tự sửa | Chấp nhận |
| [0016](0016-parent-tenant-rollup.md) | Tenant cha đọc tổng hợp của tenant con qua view của gói và vai trò `rollup_reader` | Chấp nhận |
| [0017](0017-service-account-for-tenant.md) | Tài khoản dịch vụ mở quy trình thay cho tenant ghi ở header, chỉ được khởi tạo | Chấp nhận |
| [0018](0018-threshold-rules-in-bridge.md) | Luật ngưỡng do gói khai, iot-bridge xét sau khi ghi số đo và mở hồ sơ qua workflow-api | Chấp nhận |
| [0019](0019-workflow-settings-at-deploy.md) | Ngưỡng và thời hạn của quy trình gói là `settings`, bộ cài thay vào BPMN lúc deploy | Chấp nhận |
| [0020](0020-facility-locations.md) | Tọa độ cơ sở là hai cột số; tenant cha thấy vị trí trụ sở đang dùng của tenant con qua view | Chấp nhận |
| [0021](0021-document-assistant.md) | Trợ lý hỏi văn bản: mô hình tại chỗ, tìm bằng token người hỏi, câu trích do hệ thống chép | Chấp nhận |
| [0022](0022-declarative-packages.md) | Gói chỉ gồm tệp khai báo: danh sách tệp được phép, dữ liệu demo nạp bằng bộ nạp chung | Chấp nhận |
| [0023](0023-package-pages-in-the-web-shell.md) | Mục menu của gói mở ở `/apps/<gói>/<mục>`, tra thành phần theo tên; menu ẩn hiện theo vai trò, truy vấn chạy với vai trò `user` | Chấp nhận |
| [0024](0024-map-component.md) | Thành phần bản đồ: nền trơn, điểm là nút HTML, vai trò Hasura khai theo lớp và chỉ gửi khi token có | Chấp nhận |
| [0025](0025-decision-variables.md) | Người lập không đặt sẵn được biến quyết định: workflow-api đọc tên từ điều kiện rẽ nhánh sau userTask trong BPMN đã deploy | Chấp nhận |
| [0026](0026-start-process-from-catalog-row.md) | Nút của danh mục khởi tạo quy trình của cùng gói, biến lấy từ dòng đang xem; Idempotency-Key ngẫu nhiên cho mỗi lần mở hộp xác nhận | Chấp nhận |
| [0027](0027-data-assistant-guarded-graphql.md) | Trợ lý hỏi dữ liệu: câu GraphQL chỉ đọc qua guard trên cây cú pháp, chạy qua Hasura bằng token người hỏi; bảng, cột được phép do mục menu khai | Chấp nhận |
| [0028](0028-step-authority-table.md) | Vai trò của một bước lấy từ bảng phân cấp theo tenant; workflow-api đọc lúc khởi tạo bằng vai trò CSDL chỉ đọc, tenant cha sửa, bước đọc bảng cần OTP với mọi vai trò | Chấp nhận |
| [0029](0029-parent-completes-delegated-step.md) | Tenant cha hoàn thành bước thuộc thẩm quyền của mình trong hồ sơ tenant con: workflow-api tìm theo nhóm `<tenant cha>/<vai trò>`, kiểm tenant cha lúc gọi, mọi bước khác vẫn 404 | Chấp nhận |
| [0030](0030-form-component.md) | Thành phần biểu mẫu: cấu hình riêng dịch sang rjsf, khởi tạo quy trình hoặc thêm dòng của gói, Idempotency-Key đổi theo dữ liệu, check-fast kiểm theo gói | Chấp nhận |
| [0031](0031-step-fields.md) | Trường của một bước chỉ do người làm bước đó ghi: userTask khai trường bằng `flowable:formProperty`, workflow-api từ chối người lập và người làm bước khác gửi nó | Chấp nhận |
| [0032](0032-case-tracking-for-initiators.md) | Người lập theo dõi hồ sơ của mình: route riêng lọc theo tenant và `initiator` trong một truy vấn, không trả trường của bước hay danh tính người xử lý; thành phần `cases` | Chấp nhận |
| [0033](0033-dashboard-component.md) | Thành phần bảng điều hành: mọi số là cột do gói tính sẵn trong view, không tính trên trình duyệt; mỗi số kèm cách tính, mỗi khối kèm câu truy vấn đã gửi; biểu đồ cột ngang luôn kèm bảng số liệu; check-fast kiểm theo quyền của gói | Chấp nhận |
| [0034](0034-model-written-guarded-graphql.md) | Câu hỏi dữ liệu gõ tự do: mô hình viết đúng một câu GraphQL chỉ đọc từ mô tả bảng, cột của mục menu, không thấy dòng dữ liệu; câu qua cùng guard, sửa tối đa một lần theo lý do của guard trong một hạn chung; chạy bằng token người hỏi | Chấp nhận |
| [0035](0035-case-counts-and-device-readings-on-dashboards.md) | Số hồ sơ và số đo thiết bị trên bảng điều hành: workflow-api trả tổng Flowable đếm theo tenant, quy trình, bước, chỉ cho người có vai trò của một bước; việc đang chờ người xem đếm trên trình duyệt; số đo đọc qua context-api | Chấp nhận |
| [0036](0036-pull-based-gitops-with-compose.md) | Phát hành theo tag: CI dựng image lên GHCR và tạo Release từ CHANGELOG; máy chủ demo tự kéo tag mới về chạy bằng Compose (image theo `MORTISE_IMAGE_PREFIX`, `MORTISE_VERSION`, `MORTISE_NO_BUILD=1` cấm dựng tại chỗ), smoke lỗi thì quay về tag trước, CSDL không tự khôi phục; Argo CD khi chuyển lên Kubernetes | Chấp nhận |
| [0037](0037-observability-profile.md) | Giám sát trong profile `observability`: Prometheus, Loki, Grafana chỉ ở 127.0.0.1; log container đọc qua docker-socket-proxy chỉ cho đọc, trong mạng riêng với Alloy | Chấp nhận |
| [0038](0038-distributed-tracing.md) | Truy vết phân tán bằng OpenTelemetry, mặc định tắt (`MORTISE_TRACING`): cổng truy vết API dưới /v1, dịch vụ FastAPI tự viết chạy dưới `opentelemetry-instrument`; Jaeger 2.20.0 (Apache-2.0, không chọn Tempo AGPL-3.0) trong profile `observability` bỏ chuỗi truy vấn, user-agent, địa chỉ người gọi trước khi lưu | Chấp nhận |
| [0039](0039-dependency-check-script.md) | Ghim phiên bản và giấy phép phụ thuộc kiểm bằng script trong repo, chạy trong `make check-fast`; bản mới chỉ báo, mỗi tuần đăng báo cáo vào issue theo dõi; chính sách ở `scripts/deps-policy.toml` | Chấp nhận |
| [0040](0040-tenant-login-policy.md) | Chính sách đăng nhập theo tenant: gán vai trò `otp_required` cho group của tenant, không đổi luồng; người vận hành đặt bằng `make tenant-login` | Chấp nhận |
| [0041](0041-documents-on-catalog-records.md) | Tài liệu đính kèm là phần `detail.documents` của màn hình chi tiết danh mục: bảng nối của gói quyết định ai thấy tệp nào, tệp tải lên, tải xuống qua `/v1/files`; tải xuống theo tenant và mã tệp, không theo bản ghi; check-fast kiểm theo quyền của gói | Chấp nhận |
| [0042](0042-passkey-login.md) | Đăng nhập bằng Passkey theo tenant: bước WebAuthn riêng ngang ô mật khẩu ghi amr `hwk`, từ chối khi thiếu vai trò `passkey_allowed` gán cho group của tenant; Passkey thay mật khẩu, không thay OTP | Chấp nhận |
| [0043](0043-design-tokens-and-install-branding.md) | Bộ quy ước giao diện đạt AA và thương hiệu theo bản cài | Chấp nhận |
| [0044](0044-menu-groups-and-icons.md) | Menu chia nhóm theo gói, biểu tượng theo ý nghĩa, tên gói lưu cùng mục menu | Chấp nhận |
| [0045](0045-readable-dashboard.md) | Bảng điều hành dễ đọc: số chính nổi bật, cách tính và nguồn thu gọn, biểu đồ có nhãn số | Chấp nhận |
| [0046](0046-shared-ui-states.md) | Trạng thái đang tải, rỗng, lỗi dùng chung; lỗi đổi sang lời tiếng Việt theo mã | Chấp nhận |
| [0047](0047-page-header-status-badge-formatting.md) | Đầu trang, nhãn trạng thái, định dạng ngày giờ và số dùng chung | Chấp nhận |
| [0048](0048-bento-tokens-status-tones-font.md) | Kiểu Bento dịu, bộ nghĩa màu chung, phông Be Vietnam Pro | Chấp nhận |
| [0049](0049-bento-dashboard.md) | Bảng điều hành dạng lưới Bento, mức độ thẻ, vòng đo, biểu đồ có trần | Chấp nhận |
| [0050](0050-catalog-tones-cards-form-help.md) | Nghĩa màu cho giá trị của danh mục, dạng thẻ, chi tiết dạng lưới ô và dòng gợi ý của biểu mẫu | Chấp nhận |
| [0051](0051-home-page.md) | Trang chủ: ô lối tắt theo gói và việc đang chờ | Chấp nhận |
| [0052](0052-catalog-export.md) | Xuất danh sách của danh mục ra CSV, Excel và PDF ngay trong trình duyệt, bằng quyền của người xuất | Chấp nhận |
| [0053](0053-case-seals-and-timer-deadlines.md) | Niêm phong hồ sơ đã kết thúc bằng băm nối vào nhật ký, và ghi hạn của bước chờ hẹn giờ | Chấp nhận |
| [0054](0054-edit-and-add-child-from-catalog.md) | Sửa dòng và thêm dòng con từ màn hình danh mục, so cột version để không ghi đè | Chấp nhận |
| [0056](0056-self-hosted-osm-basemap.md) | Nền bản đồ OpenStreetMap tự lưu trữ dạng PMTiles, mặc định không chữ | Chấp nhận |
| [0059](0059-custom-fields.md) | Trường tùy chỉnh: giá trị jsonb, định nghĩa theo tenant gốc, CSDL kiểm | Chấp nhận |
| [0060](0060-config-overrides.md) | Ghi đè cấu hình theo org: bảng riêng, đích theo tên, trộn và kiểm lại trên trình duyệt | Chấp nhận |

## Quyết định còn mở

Hiện không có.
