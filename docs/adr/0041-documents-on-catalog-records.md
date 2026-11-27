<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0041. Tài liệu đính kèm: phần của màn hình chi tiết danh mục, bảng nối của gói, tải tệp qua API tệp của lõi

- Trạng thái: Chấp nhận
- Ngày: 2026-11-25

## Bối cảnh

Người dùng cần đính kèm giấy tờ (biên bản, ảnh, quyết định) vào một bản ghi và mở lại được trên web. Lõi đã có API
tệp (`/v1/files`, [ADR 0010](0010-upload-malware-scan.md)): tải lên có quét mã độc và giới hạn cỡ, tải xuống theo
tenant trong token, tệp của tenant khác trả 404. API tệp không biết tệp thuộc bản ghi nào, không có route liệt kê hay
xóa, và `core.files` không đăng ký trong Hasura. Gói chỉ gồm tệp khai báo
([ADR 0022](0022-declarative-packages.md)) nên thành phần dùng chung phải làm phần giao diện theo cấu hình
([ADR 0013](0013-component-config-contracts.md)).

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Gắn tệp vào đâu | Bản ghi của danh mục | Màn hình chi tiết đã có; quyền đọc bản ghi đã khai trong Hasura của gói |
| | Hồ sơ quy trình | Biến của quy trình không có quyền theo dòng; cần thêm route ở workflow-api. Để sau |
| Hiện ở đâu | Mục menu `documents` riêng | Không có bản ghi nào để chọn; người dùng phải tìm lại bản ghi ở danh mục |
| | Một phần của màn hình chi tiết (`detail.documents`) | Mở bản ghi là thấy tệp; dùng lại đường dẫn, quyền và khóa của danh mục |
| Ai được thấy tệp nào | Thêm route liệt kê theo bản ghi vào files-api | Lõi phải biết bảng của gói, trái ranh giới tầng |
| | Bảng nối của gói, đọc qua Hasura | Quyền theo dòng do gói khai như mọi bảng khác; check-fast kiểm được |
| Schema của phần tài liệu | Viết lồng trong `catalog.schema.json` | Không có bản mô tả riêng cho một thành phần có năng lực, giới hạn riêng |
| | `documents.schema.json` riêng, `catalog.schema.json` trỏ tới bằng `$ref` | Một nguồn; check-jsonschema chỉ đọc được tệp bên cạnh khi chạy với `--base-uri` |

## Quyết định

- **Phần tài liệu thuộc màn hình chi tiết của danh mục.** Gói khai `detail.documents` ở bất kỳ cấp cha–con nào theo
  `contracts/documents.schema.json`: bảng nối (`source`), cột chứa khóa của bản ghi (`via`), cột chứa mã tệp
  (`file`), cột hiện thêm, thứ tự, số tệp tối đa (trần 50), và `upload` nếu cho đính kèm. Không có trang menu
  riêng cho tài liệu (bảng trên), nên `component: documents` bị bỏ khỏi danh sách thành phần của mục menu trong
  `contracts/app.schema.json`; bản 0.1.0 còn giá trị này, gói đã khai thì chuyển cấu hình vào `detail.documents`. `scripts/contracts.sh` kiểm schema danh mục với `--base-uri` trỏ vào `contracts/`.
- **Bảng nối của gói quyết định ai thấy tệp.** Danh sách đọc bảng nối qua GraphQL bằng vai trò `user`
  ([ADR 0023](0023-package-pages-in-the-web-shell.md)); tên, cỡ của tệp đọc từ `/v1/files/{id}`, không chép vào bảng
  nối. Đính kèm là tải tệp lên `/v1/files` rồi thêm một dòng nối bằng token người dùng; `tenant_id` và người đính kèm
  do quyền thêm dòng đặt từ token (`set`). Không có quyền sửa, xóa dòng nối.
- **Tải xuống bằng fetch kèm token thành Blob rồi `<a download>`.** Không xem trước trong trang, CSP của giao diện
  không đổi; files-api vẫn trả nội dung với `Content-Security-Policy: sandbox` và `nosniff`.
- **Tệp bị từ chối báo bằng tiếng Việt theo mã HTTP** (422 mã độc hay vượt giới hạn quét, 413 quá cỡ, 503 dịch vụ quét
  hay kho tệp chưa sẵn sàng, 429 quá tần suất), giữ nguyên lý do files-api viết. Bị từ chối thì không thêm dòng nối.
- **Kiểm theo gói lúc `make check-fast`** (`scripts/check-documents-config.py`): bảng nối thuộc gói, vai trò `user`
  đọc được mọi cột phần tài liệu nhắc tới; có `upload` thì vai trò của nó thêm được dòng với `via`, `file`, `note` và
  không cột nào trong đó gắn với tenant của token. Thành phần kiểm lại lúc chạy mọi tên nó ghép vào câu GraphQL.
- **Gói minh họa.** `facilities-commune` có bảng `facility_documents` (khóa ngoại ghép `(tenant_id, facility_id)` với
  `ON DELETE CASCADE`, `file_id` trỏ tới `core.files (id)`, `UNIQUE (tenant_id, facility_id, file_id)`, nhật ký). Ai
  thấy cơ sở thì thấy giấy tờ của nó; cán bộ phụ trách (custodian) và quản trị xã đính kèm. Khóa ngoại của `file_id`
  chỉ một cột vì `core.files` không có `UNIQUE (tenant_id, id)` và gói không sửa lược đồ core.

## Hệ quả

- Gói thêm giấy tờ cho một loại bản ghi bằng một bảng nối, quyền Hasura và vài dòng cấu hình, không viết giao diện.
  Năng lực và giới hạn ghi ở `contracts/documents.component.yaml`.
- Tải xuống được phép theo tenant và mã tệp, không theo bản ghi: người cùng đơn vị có mã tệp (uuid ngẫu nhiên) thì tải
  được tệp dù không thấy bản ghi. Danh sách tệp thì lọc theo quyền của bản ghi. Muốn chặn theo bản ghi, files-api phải
  hỏi gói trước khi trả tệp; chưa làm.
- Tệp đã lưu mà không thêm được dòng nối (không có quyền, mất mạng) nằm lại ở `core.files` không gắn vào đâu, vì API
  tệp không có lệnh xóa. Ô đính kèm hiện cho mọi người đọc được bản ghi, nên người duyệt bấm đính kèm cũng để lại tệp
  như vậy; lời báo nói rõ tệp chưa được gắn.
- Ở gói minh họa, lãnh đạo xã (vai trò `manager`) chỉ thấy cơ sở trên danh mục khi được phân công: danh mục đọc bằng
  vai trò `user`, quyền của vai trò này đi qua bảng phân công. Kịch bản người duyệt mở giấy tờ cần phân công
  `approver`: dữ liệu demo phân công `manager.a` làm người duyệt của trụ sở UBND xã A (`approvers` trong
  `seed/demo.yaml`; bộ nạp xin mã OTP cho tài khoản phải nhập OTP), nên số cơ sở chưa có người duyệt của xã A giảm
  một.
- Mỗi tệp tốn một lần gọi `/v1/files/{id}` khi mở bản ghi, trong giới hạn tần suất của cổng cho route tệp.
- Kiểm tự động: `make web-check` (cấu hình, câu truy vấn, lời báo), `make check-fast` (schema, ví dụ sai, luật theo
  gói), smoke của gói (`apps/facilities-commune/tests/documents.sh`) và `make e2e` (`e2e/documents.spec.ts`).
