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
| [0030](0030-form-component.md) | Thành phần biểu mẫu: cấu hình riêng dịch sang rjsf, khởi tạo quy trình hoặc thêm dòng của gói, Idempotency-Key đổi theo dữ liệu, check-fast kiểm theo gói | Chấp nhận |
| [0031](0031-step-fields.md) | Trường của một bước chỉ do người làm bước đó ghi: userTask khai trường bằng `flowable:formProperty`, workflow-api từ chối người lập và người làm bước khác gửi nó | Chấp nhận |

## Quyết định còn mở

Hiện không có.
