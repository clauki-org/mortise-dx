<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0009. Nhật ký thay đổi ghi bằng trigger, chuỗi băm để phát hiện sửa, đối chiếu băm cuối trong bản sao lưu

- Trạng thái: Chấp nhận
- Ngày: 2026-11-16

## Bối cảnh

Hồ sơ của cơ quan cần trả lời được ai sửa dòng nào, lúc nào, từ giá trị gì thành giá trị gì; và khi có tranh chấp,
cần biết chính nhật ký có bị sửa không. Dữ liệu đi vào CSDL qua nhiều đường: Hasura (vai trò `hasura`), dịch vụ tự
viết (files-api, vai trò `files_api`), script vận hành (`psql`). Ghi nhật ký ở từng ứng dụng thì đường nào quên ghi
là mất dấu.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Mỗi ứng dụng tự ghi | Đường ghi mới hay script vận hành dễ quên; không thấy thay đổi đi thẳng vào CSDL |
| Event trigger của Hasura | Chỉ thấy thay đổi đi qua Hasura; cần dịch vụ nhận sự kiện |
| Đọc WAL (logical decoding) | Thấy mọi thay đổi nhưng thêm thành phần chạy riêng, khó gắn người làm |
| Trigger của PostgreSQL ghi vào một bảng | Thấy mọi thay đổi trên bảng đã gắn, chạy trong cùng giao dịch, không thêm thành phần |

## Quyết định

- Bảng `core.audit_log` (migration của lõi) nhận một dòng cho mỗi thay đổi: thời điểm, tenant, bảng, thao tác, khóa
  của dòng, giá trị trước và sau (`jsonb`), người làm, vai trò khai trong token, tài khoản CSDL.
- Gắn nhật ký cho một bảng bằng `SELECT core.audit_attach('<bảng>')` trong migration (truyền tên cột tenant nếu
  không phải `tenant_id`); gỡ bằng `core.audit_detach`. Hàm tạo ba trigger: khóa ghi trước câu lệnh, ghi theo dòng
  (`core.audit_row()`), chặn `TRUNCATE` vì lệnh này không qua trigger theo dòng. Migration của lõi gắn cho
  `core.files`, `core.tenants`; của Tầng 2 gắn cho `platform.workflow_steps`; gói gắn cho bảng của mình.
- Người làm chọn theo tài khoản đã mở kết nối (`session_user`):
  - `hasura`: `x-hasura-user-id` trong biến phiên `hasura.user`. Đi qua JWT thì là `sub` của token, tin được. Đi
    bằng admin secret thì người gọi tự khai, nên ghi kèm `x-hasura-role` để người đọc biết mức tin. Đường ghi qua
    Hasura bằng JWT có bài kiểm từ gói `facilities-commune`: nhật ký ghi đúng `sub` và vai trò của token.
  - Dịch vụ tự viết: đặt `mortise.actor` bằng `set_config(..., true)` trong cùng giao dịch ghi (files-api làm vậy).
  - Không có hai nguồn trên: ghi tên tài khoản CSDL, ví dụ thay đổi của `make seed`.
- Chuỗi băm toàn cục, công thức phiên bản 1 (`core.audit_hash`): SHA-256 của mảng JSON `[phiên bản, prev_hash dạng
  hex, id, thời điểm dạng số micro giây từ epoch, tenant, bảng, thao tác, khóa, trước, sau, người làm, vai trò, tài
  khoản CSDL]`. Mảng JSON tránh nhập nhằng khi có NULL hay khi ghép chuỗi; `jsonb` chuẩn hóa thứ tự khóa; thời điểm
  không băm dạng chữ vì dạng chữ đổi theo múi giờ và `DateStyle` của phiên. Đổi công thức thì tăng `hash_version`.
- Ghi lần lượt bằng một khóa advisory giữ tới hết giao dịch, lấy ở trigger trước câu lệnh, tức trước khi câu lệnh
  khóa dòng nào. Lấy trong trigger theo dòng thì hai giao dịch cùng sửa nhiều dòng giữ khóa theo thứ tự ngược nhau
  và deadlock (đã tái hiện). `prev_hash` và `hash` là `UNIQUE`: ở REPEATABLE READ hay SERIALIZABLE, giao dịch có
  snapshot cũ đọc phải băm cuối cũ, ràng buộc chặn lại và trigger báo lỗi `40001` để người gọi chạy lại giao dịch.
- Nhật ký chỉ được thêm: trigger chặn `UPDATE`, `DELETE`, `TRUNCATE` trên `core.audit_log`, kể cả với chủ bảng.
- `core.audit_verify()` tính lại chuỗi, nối các dòng theo `prev_hash` (giao dịch rollback để lại lỗ trong dãy id, đó
  không phải lỗi) và trả dòng đầu tiên bị sửa hay chỗ đứt. `make audit-verify` gọi hàm này; smoke chạy cùng các lần
  thử sửa lén và xóa lén trong giao dịch rồi rollback.
- `make backup` ghi băm cuối chuỗi (`audit_head=<id>:<băm>`) vào MANIFEST, đọc trước khi dump. `make restore` và
  `make audit-verify ANCHOR=<thư mục sao lưu>` đối chiếu với băm đó.

Đã kiểm ngày 2026-11-16 trên PostgreSQL 17: sao lưu rồi khôi phục, chuỗi vẫn khớp và khớp băm ghi trong MANIFEST;
truyền băm neo sai thì lệnh kiểm báo lỗi.

## Hệ quả

- **Chặn được**: người dùng qua Hasura và dịch vụ tự viết (`files_api`) sửa nhật ký, vì không có quyền trên bảng;
  sửa hay xóa nhật ký bằng câu lệnh thường, kể cả chủ bảng, vì trigger chặn; xóa sạch bảng có nhật ký bằng
  `TRUNCATE`.
- **Phát hiện**: sửa hay xóa một dòng nằm trước dòng cuối mà không tính lại các dòng sau nó.
- **Chỉ phát hiện nếu có băm neo**: người giữ quyền chủ CSDL (`hasura`, gồm cả ai có admin secret của Hasura) hay
  superuser vẫn tắt được trigger và gọi được `core.audit_hash`. Sửa dòng thứ n tính từ cuối chỉ cần tính lại n băm;
  sửa hay chèn ở dòng cuối chỉ cần một băm (đã thử: `audit_verify` không thấy gì). Băm trong bản sao lưu bắt được
  mọi thay đổi trên các dòng tới thời điểm sao lưu, không bắt được thay đổi trên các dòng ghi sau đó.
- **Không phát hiện**: sửa các dòng ghi sau lần sao lưu gần nhất; khôi phục một bản sao lưu cũ hơn kèm MANIFEST
  của chính nó; thay đổi cấu trúc bảng (DDL), tắt trigger, phần `down` của migration.
- Việc nâng tiếp, chưa làm: ghi băm cuối ra nơi ngoài CSDL thường xuyên hơn mỗi lần sao lưu, vì các dòng sau băm
  neo gần như không được bảo vệ; tách tài khoản chủ bảng nhật ký khỏi `hasura`.
- Mọi lần ghi bảng có nhật ký chạy lần lượt do khóa toàn cục. Chưa đo mức nghẽn; cần đo trước khi dùng thật. Nếu
  nghẽn thì chuyển sang chuỗi theo tenant (cần chuỗi riêng cho dòng không có tenant và một băm neo cho mỗi chuỗi).
- Giá trị trước và sau sao chép dữ liệu cá nhân vào nhật ký và giữ mãi; cần chính sách lưu giữ trước khi dùng thật.
- Ngoài phạm vi: thao tác trong Flowable (CSDL riêng), sự kiện quản trị của Keycloak, lượt tải tệp xuống.
- Không đặt khóa ngoại từ nhật ký tới `core.tenants`: xóa tenant thì nhật ký của nó vẫn còn.
