<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0067. Gói vận hành hiện trường: cột sửa cuối qua hàm của nền tảng, việc sửa chữa do luật mở là hồ sơ

- Trạng thái: Đề xuất
- Ngày: 2026-11-28
- Bổ sung: [ADR 0022](0022-declarative-packages.md), [ADR 0062](0062-shared-warehouse-package.md) (thêm một hàm của
  nền tảng mà gói khai báo gọi được)

## Bối cảnh

Bản cài thứ hai của #243 là một công ty điện mặt trời hư cấu (tenant `dmt`). Gói `field-ops` (#246) cần khách hàng,
điểm lắp đặt trên bản đồ, thiết bị tại điểm, phiếu công việc có ảnh và biên bản, nghiệm thu có người thứ hai xác nhận,
và việc sửa chữa khi sản lượng một điểm thấp quá lâu. Gói phải chỉ gồm tệp khai báo như gói kho.

Ví dụ: kỹ thuật viên mở phiếu PCV-003 trên điện thoại, đổi trạng thái sang "Đang làm" và gắn ảnh hiện trường. Cùng lúc
người điều phối đổi hạn của phiếu; lần lưu của kỹ thuật viên bị báo thay vì ghi đè hạn mới.

Ba câu hỏi:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Sửa phiếu trên giao diện | Không sửa, chỉ thêm dòng "cập nhật" nối tiếp | Khai báo được, nhưng trạng thái hiện tại phải tính bằng view lấy dòng mới nhất; danh mục, bản đồ, bảng việc kiểu Kanban sau này đều phải đọc view đó |
| | Nút sửa của danh mục (ADR 0054) | Cần cột `version` do CSDL đặt ở mọi UPDATE, tức một trigger; gói khai báo không được viết trigger |
| | Hàm của nền tảng gắn trigger cột sửa cuối | Một hàm chung, không chữ nghiệp vụ, như `platform.empty_guard_attach` |
| Việc sửa chữa khi sản lượng thấp | Luật mở một dòng phiếu công việc | iot-bridge chỉ mở quy trình qua workflow-api (ADR 0018); quy trình của gói khai báo không có bước chạy mã để ghi dòng |
| | Luật mở hồ sơ `site-repair` cho người điều phối | Dùng đúng đường đã có; hồ sơ không có ảnh, vật tư như phiếu |
| Phát hiện mất kết nối | Luật "không có số đo trong N phút" | Lõi chỉ xét luật khi có số đo tới; cần một cơ chế mới |
| | Luật `below` trên công suất phát | Có sẵn; không bắt được thiết bị im lặng |

## Quyết định

- **`platform.row_version_attach(bảng, cột)`** trong migration của Tầng 2: gắn trigger BEFORE UPDATE đặt cột bằng
  `clock_timestamp()`. Hàm từ chối cột không phải `timestamptz NOT NULL`, vì cột trống thì biểu mẫu sửa không so được.
  Gói tự khai cột trong `CREATE TABLE`; quyền Hasura không cho vai trò nào ghi cột này.
- **Phiếu công việc là dòng của gói**, mọi nhân viên (vai trò `user`) lập và sửa được trạng thái, người thực hiện, hạn,
  ghi chú; không đổi được điểm của phiếu. Ảnh, biên bản là bảng nối giấy tờ (ADR 0041); không ai xóa được dòng nối.
- **Nghiệm thu bốn mắt là quy trình `work-acceptance`** mở từ nút trên chi tiết phiếu (ADR 0026); người có vai trò
  `manager` xác nhận, người đề nghị không tự xác nhận được. Kết quả nằm ở hồ sơ, không ghi lại vào phiếu.
- **Luật `low-output`**: công suất `power` dưới 1 kW liên tục 600 giây thì mở hồ sơ `site-repair` cho người điều phối
  của tenant có thiết bị. Ngưỡng là số minh họa.
- **Thiết bị demo của mẫu cài nằm ở tệp riêng** `devices/simulator/dien-mat-troi.yaml`: `make seed` chỉ cấp tài khoản
  MQTT khi tenant đã có, bộ giả lập đọc tệp đó khi được gọi với `--devices`. Bộ giả lập có thêm số đo `power`.

## Hệ quả

- Gói khai báo khác dùng được nút sửa của danh mục bằng một dòng `SELECT platform.row_version_attach(...)`.
- Phiếu và hồ sơ sửa chữa là hai thứ: người điều phối tự lập phiếu sửa chữa từ hồ sơ nếu cần. Luật không biết ngày
  đêm, ban đêm công suất thật về 0; bản cài có thiết bị thật phải đổi luật.
- Thiết bị mất kết nối không mở hồ sơ nào cho tới khi có cơ chế xét "không có số đo".
- Smoke và e2e của gói chạy trên tenant `dmt` khi bản cài có, không thì trên xã A, nên CI của bản cài chính quyền vẫn
  kiểm được gói.
