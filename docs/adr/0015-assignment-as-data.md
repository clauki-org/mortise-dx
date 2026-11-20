<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0015. Luật quyền là khai báo, phân công là dữ liệu

- Trạng thái: Chấp nhận
- Ngày: 2026-11-20

## Bối cảnh

Trong một xã, mỗi cán bộ phụ trách một vài cơ sở nhà, đất. Cán bộ chỉ được thấy và sửa dữ liệu của cơ sở mình
phụ trách; ai phụ trách cơ sở nào thì đổi thường xuyên (điều động, nghỉ phép, tiếp nhận trụ sở sau sắp xếp).

Quyền Hasura nằm trong tệp khai báo, áp bằng `make seed` và kiểm lệch bằng `make smoke`. Không ai sửa quyền trên
trang quản trị (AGENTS.md). Các cách đã xét:

- **Ghi từng cán bộ vào luật quyền.** Mỗi lần đổi người phải sửa tệp, mở pull request và áp lại. Xã không tự làm
  được, và luật quyền phình theo số người.
- **Tạo một vai trò Keycloak cho mỗi cơ sở.** Số vai trò tăng theo số cơ sở. Token mang danh sách vai trò dài, và
  phân công vẫn phải sửa trên trang quản trị Keycloak.
- **Tách luật khỏi dữ liệu.** Luật cố định "cán bộ thấy cơ sở có phân công của mình" nằm trong tệp khai báo; phân
  công là dòng trong một bảng, xã tự sửa.

## Quyết định

Chọn cách thứ ba.

- **Luật quyền** nằm trong `apps/facilities-commune/hasura/tables.yaml` và chỉ đổi qua pull request.
  - Mọi quyền lọc theo tenant trong token trước, rồi mới xét phân công.
  - Quyền của tòa và phòng đi qua quan hệ tới cơ sở, rồi tới bảng phân công.
- **Phân công** là dòng trong `app_facilities_commune.facility_assignments`: cơ sở, `sub` của cán bộ trong token
  (`X-Hasura-User-Id`) và nhiệm vụ.
  - Có khóa ngoại ghép `(tenant_id, facility_id)`, nên CSDL tự chặn việc phân công vào cơ sở của xã khác.
  - Có nhật ký thay đổi (ADR 0009).
- **Ba vai trò; vai trò `user` chia theo hai nhiệm vụ.** Hasura chọn vai trò theo header `X-Hasura-Role`, trong
  số vai trò có trong token:
  - `user`, nhiệm vụ `custodian` (phụ trách): thấy cơ sở cùng tòa, phòng của nó; sửa cơ sở; thêm, sửa, xóa tòa và
    phòng. Không tạo hay xóa cơ sở.
  - `user`, nhiệm vụ `approver` (người duyệt): chỉ thấy, không sửa.
  - `manager`: chỉ đọc toàn xã. Vai trò này dùng cho lãnh đạo xã và người duyệt.
  - `tenant_admin` (quản trị xã): đọc, ghi toàn xã, và là vai trò duy nhất thêm, xóa được phân công.
    - `tenant_id` của dòng mới gán từ token, client không tự đặt được.
- **Quyền check của update cũng xét phân công**, để cán bộ không chuyển được tòa hay phòng sang cơ sở mình không
  phụ trách.
- **`scripts/hasura-metadata.py` quản lý cả quan hệ**, vì luật đi qua quan hệ.
  - Quan hệ khai tay (`manual_configuration`) theo cặp `(tenant_id, khóa)` cho khớp khóa ngoại ghép.
  - Hasura từ chối bỏ một quan hệ khi còn quyền ở bảng khác đi qua nó. Vì vậy, khi có quan hệ phải bỏ, `apply` bỏ
    mọi quyền trước, sửa quan hệ, rồi tạo lại quyền trong cùng một lô.

## Hệ quả

- **Xã tự đổi phân công qua GraphQL**, không cần pull request hay quyền quản trị kỹ thuật. Mọi thay đổi phân công
  có nhật ký ghi người làm.
- **Luật quyền vẫn được review và kiểm lệch như trước:** `make check-fast` kiểm mọi quyền lọc theo tenant,
  `make smoke` báo khi Hasura lệch tệp.
- **Cán bộ (`user`) không còn tạo hay xóa cơ sở**; việc đó thuộc `tenant_admin`. Dữ liệu demo nạp bằng tài khoản
  `admin.*`, rồi phân công `user.*`.
- **Cơ sở chưa phân công cho ai thì chỉ `manager` và `tenant_admin` thấy.**
- **Phân công dùng `ON DELETE CASCADE`**, khác `RESTRICT` của tòa và phòng: phân công không phải hồ sơ tài sản, và
  cơ sở chỉ xóa được khi đã hết tòa.
- **Chưa kiểm `sub` trong phân công có thuộc đúng xã không**, vì CSDL không biết thành viên nhóm Keycloak. Phân
  công một `sub` lạ chỉ tạo ra dòng vô hiệu: quyền vẫn lọc theo tenant trong token của người gọi.
- **Việc tiếp theo:**
  - workflow-api chưa đọc bảng phân công: người duyệt vẫn được xét theo vai trò, chưa theo cơ sở.
  - `tenant_admin` chưa bắt buộc OTP như `manager` (ADR 0011).
  - Chưa có màn hình phân công trên giao diện.
  - Giao diện web chưa gửi `X-Hasura-Role`, nên trên giao diện `manager` và `tenant_admin` hiện chỉ thấy như `user`:
    chưa phân công thì không thấy cơ sở nào.
