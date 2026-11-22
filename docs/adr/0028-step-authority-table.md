<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0028. Vai trò của một bước lấy từ bảng phân cấp theo tenant, workflow-api đọc lúc khởi tạo

- Trạng thái: Chấp nhận
- Ngày: 2026-11-22

## Bối cảnh

Mỗi tỉnh phân cấp thẩm quyền khác nhau: cùng một loại hồ sơ, tỉnh này để xã tự duyệt, tỉnh kia đòi lãnh đạo hay cấp
cao hơn khi hồ sơ vượt một mức (#111). Đổi phân cấp thì hồ sơ lập sau phải tới đúng người mới mà không sửa phần mềm,
không deploy lại quy trình. Hiện người nhận bước viết cứng trong BPMN (`candidateGroups="manager"`), và `settings` của
gói ([ADR 0019](0019-workflow-settings-at-deploy.md)) chỉ cho một giá trị cho mọi tenant của bản cài.

Ràng buộc:

- **Người lập và người xử lý bước không tự chọn được người duyệt.** workflow-api chuyển mọi biến client gửi sang
  Flowable, nên vai trò không được là biến client gửi.
- **Tenant con không tự nới phân cấp mà tenant cha đã đặt.** Xã tự sửa được bảng thì xã tự đổi ai duyệt hồ sơ của
  mình.
- **Đổi bảng không làm bước cần thẩm quyền mất OTP.** workflow-api chỉ đòi OTP với vai trò `manager`
  ([ADR 0011](0011-approver-mfa.md)); chuyển một bước sang vai trò khác là bỏ được yếu tố thứ hai.

Các cách đã xét:

| Cách | Đánh giá |
|---|---|
| `settings` thay vào BPMN lúc deploy | Một giá trị cho mọi tenant; đổi là cài lại gói |
| Flowable đọc bảng (listener, bước gọi HTTP) | Gói khai báo không được có listener hay bước chạy mã ([ADR 0022](0022-declarative-packages.md)); Flowable phải giữ khóa đọc dữ liệu |
| workflow-api đọc bảng qua Hasura | Token dịch vụ không có tenant nên Hasura từ chối nó ([ADR 0017](0017-service-account-for-tenant.md)), trong khi iot-bridge mở hồ sơ bằng token đó; dùng token người lập thì vai trò `user` phải đọc được bảng; admin secret đã bị loại vì giữ khóa vượt mọi quyền theo dòng, một lỗi là lộ mọi tenant ([ADR 0016](0016-parent-tenant-rollup.md)) |
| workflow-api đọc bảng trong CSDL bằng vai trò chỉ đọc, lúc khởi tạo | Một vai trò CSDL mới chỉ có SELECT trên hai bảng; biến lõi đặt, client không ghi đè được |

## Quyết định

Chọn cách cuối. Cách này đảo điều ADR 0019 và [ADR 0025](0025-decision-variables.md) ghi: "workflow-api không đọc
CSDL". Hai ADR đó tránh đọc CSDL vì đọc được bước người làm từ BPMN đã deploy là đủ; ở đây giá trị khác nhau theo
tenant và do người sửa lúc chạy, nên không nằm trong BPMN được.

- **Bảng `core.step_authorities`** (migration của lõi, có nhật ký): `tenant_id`, `app`, `process`, `step`, `rule`,
  `variable`, `above`, `role`, `scope`, `updated_at`.
  - Khóa là `(tenant_id, process, step, rule)`. `app` chỉ là gói sở hữu, để gỡ gói xóa đúng dòng. workflow-api tra theo
    khóa quy trình mà không cần biết gói, vì khóa quy trình đã duy nhất trên lõi và mọi gói (`make check-fast` kiểm,
    `scripts/contracts.sh`). Tên deployment trong Flowable là tên tệp kèm băm, không mang tên gói.
  - Mỗi bước có đúng một dòng gốc (không có `above`, không có `variable`, `scope` là `tenant`), là dòng áp khi hồ sơ
    không vượt ngưỡng nào. Chỉ mục duy nhất có điều kiện giữ "nhiều nhất một". Trigger ràng buộc hoãn tới lúc commit
    giữ "còn dòng nào của bước thì còn dòng gốc". Không chặn hẳn việc xóa dòng gốc, vì gỡ gói và xóa tenant xóa mọi
    dòng của bước cùng lúc. Ràng buộc `(above IS NULL) = (variable IS NULL)` làm việc sửa `above` không biến được
    dòng gốc thành dòng ngưỡng.
  - `role` theo mẫu `^[a-z][a-z0-9_]*(-[a-z0-9_]+)*$`: không có dấu phẩy (Flowable tách nhiều nhóm) hay dấu `/`.
- **BPMN của bước** ghi `flowable:candidateGroups="${authority_<id của userTask>}"`. `make check-fast` chỉ nhận
  candidate là danh sách vai trò viết sẵn hoặc đúng dạng đó, id của bước phải là định danh, và bước nào đọc bảng thì
  gói phải khai dòng gốc.
- **Lúc khởi tạo**, workflow-api tìm các tên `authority_*` trong `candidateGroups` và `candidateUsers` của BPMN đã
  deploy. BPMN đọc một lần cho mỗi định nghĩa, chung với biến quyết định. Với mỗi bước:
  - Chọn trong các dòng của tenant: dòng có `above` cao nhất mà biến `variable` của hồ sơ lớn hơn hẳn. Biến thiếu,
    không phải số (kể cả `true`/`false`, NaN), hay âm thì coi như vượt mọi ngưỡng: hồ sơ tới người có thẩm quyền cao
    nhất, như BPMN của gói coi phần vượt thiếu hay âm là nhánh nặng. Cùng ngưỡng thì chọn theo mã dòng. Không vượt
    dòng nào thì dùng dòng gốc.
  - Dòng `scope: parent` bị bỏ qua khi tenant không có cha. Khi có cha, nhóm ứng viên là `<tenant cha>/<vai trò>`.
    Người của tenant cha chưa thấy được task của tenant con; đó là #110.
  - Đặt biến `authority_<bước>` bằng vai trò đã chọn. Bước không có dòng nào thì trả 409, kèm lệnh nạp lại dòng mặc
    định. 409 ở route hoàn thành task đã có nghĩa "task vừa bị nhận", nên thông điệp nói rõ là bảng phân cấp.
  - Kết nối CSDL chỉ mở khi quy trình có bước đọc bảng. Quy trình khác vẫn chạy khi CSDL lỗi.
- **Tiền tố `authority_` dành riêng cho lõi:** workflow-api từ chối biến mang tiền tố này lúc khởi tạo và lúc hoàn
  thành bước. `contracts/workflow.schema.json` và `contracts/catalog.schema.json` từ chối nút đặt biến như vậy.
- **OTP theo bước, không theo vai trò:** hoàn thành một task mà hồ sơ có biến `authority_<id của bước>` cần `otp`
  trong `amr`, với mọi vai trò. Chỉ lõi đặt được biến đó, nên có biến là bước đọc bảng.
- **Ai phải nhập OTP lúc đăng nhập:** người có vai trò `otp_required` của client `mortise-web`; `manager` gộp vai trò
  này (ADR 0011, bổ sung 2026-11-22). Giao một bước cho vai trò khác, ví dụ `tenant_admin`, thì người vận hành gán
  thêm `otp_required` cho từng tài khoản sẽ nhận bước đó; tài khoản cùng vai trò mà không có nó thấy task nhưng bị
  từ chối khi hoàn thành. Đây là vai trò của client chứ không của realm, nên nằm ở `resource_access` của token: Hasura
  (đọc vai trò từ `realm_access`) không cho chọn nó, workflow-api không coi nó là nhóm ứng viên. Bản demo có
  `admin2.a`: `tenant_admin` của xã A có `otp_required`; `admin.a` vẫn đăng nhập bằng mật khẩu.
- **Vai trò CSDL `workflow_api`** (`core/postgres/roles.sh`, mật khẩu `WORKFLOW_DB_PASSWORD`): chỉ SELECT trên
  `core.step_authorities` và `core.tenants` (để biết tenant cha).
- **Ai sửa:** chỉ `tenant_admin` của tenant cha, qua Hasura, trên dòng của tenant con. Lọc qua quan hệ
  `tenant.parent_id`. Chỉ được sửa `role` và `above`. Thêm, xóa dòng và đổi biến so sánh chưa mở: dòng mới đến từ gói.
  Tenant không có cha thì chỉ người vận hành sửa trong CSDL.
- **Dòng mặc định do gói khai:** mục `authorities` của `app.yaml`, mỗi tệp một bước theo
  `contracts/authority.schema.json`. Bộ cài chỉ thêm dòng chưa có theo mã dòng (`ON CONFLICT DO NOTHING`), nên cài lại
  giữ dòng tenant cha đã sửa; gỡ gói xóa theo `app`. Bảng nạp trước BPMN, để quy trình mới không có lúc thiếu dòng.
  Quy trình mẫu `core-authority` của lõi có dòng mặc định ở `contracts/examples/authority.example.yaml`, do `make seed`
  nạp.

## Hệ quả

- **Đổi một dòng thì hồ sơ lập sau đi theo dòng mới; hồ sơ đã lập giữ người nhận cũ**, vì vai trò ghi vào biến của hồ
  sơ lúc khởi tạo. `make smoke` kiểm cả hai.
- **Đổi mặc định trong tệp của gói không tới dòng đã nạp.** Dòng gói bỏ khỏi tệp vẫn còn tới khi gỡ gói. Muốn áp mặc
  định mới cho dòng đã có thì người vận hành sửa trong CSDL.
- **Tenant tạo sau khi cài gói chưa có dòng** cho tới khi chạy lại `make app-install`; hồ sơ của quy trình đọc bảng ở
  tenant đó nhận 409 kèm lệnh đó.
- **Chuyển một bước sang vai trò không phải `manager` là thêm việc cho người vận hành:** gán `otp_required` cho người
  nhận. Quên gán thì bước đó không ai hoàn thành được: workflow-api từ chối thay vì cho qua. Bảng phân cấp không biết
  tài khoản nào có `otp_required`, nên tenant cha đổi dòng không được báo trước điều này.
- **workflow-api phụ thuộc CSDL khi khởi tạo quy trình có bước đọc bảng.** CSDL lỗi thì quy trình đó trả 503; quy
  trình khác không bị ảnh hưởng.
- Gói `facilities-commune` chưa dùng bảng: bước "Trình người có thẩm quyền" vẫn viết `manager`. Chuyển bước đó sang
  bảng là việc của gói.
