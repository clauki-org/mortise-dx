<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0053. Niêm phong hồ sơ đã kết thúc bằng băm nối vào nhật ký, và ghi hạn của bước chờ hẹn giờ

- Trạng thái: Đề xuất
- Ngày: 2026-11-27

## Bối cảnh

Hồ sơ của quy trình (ý kiến, quyết định, ai làm bước nào, kết quả) chỉ nằm trong CSDL riêng của Flowable. Nhật ký
thay đổi ([ADR 0009](0009-tamper-evident-audit-log.md)) không thấy CSDL đó, nên người có quyền trên CSDL của Flowable
sửa được một quyết định đã ra mà không để lại dấu. Với hồ sơ rà soát của gói xã, quyết định của người có thẩm quyền
cần một dấu chứng tỏ nó còn nguyên như lúc ra.

Gói cũng cần biết hạn của bước chờ hẹn giờ đang chạy, ví dụ bước công khai của hồ sơ rà soát, để chỉ nhận việc trong
thời hạn đó (#221). Hết hạn, Flowable tự đi tiếp mà không gọi workflow-api, và gói không đọc được Flowable.

Ràng buộc:

- Lõi không biết nghiệp vụ: quy trình nào cần niêm phong do BPMN của gói khai, workflow-api đọc từ BPMN đã deploy như
  trường của bước ([ADR 0031](0031-step-fields.md)).
- Bảng niêm phong không chứa dữ liệu nghiệp vụ, chỉ băm.
- Bước đã hoàn thành ở Flowable thì không trả lỗi cho người dùng: bấm lại sẽ nhận 404.

Hành vi của Flowable 7.2 đã thử ngày 2026-11-27 trên image `flowable/flowable-rest:7.2.0`, chạy riêng với CSDL trong
bộ nhớ, không chung với lõi:

- Thuộc tính lạ trong không gian tên khác trên `<process>` (`mortise:seal="true"`) deploy được và trả nguyên trong
  `resourcedata`.
- Hoàn thành bước dẫn vào một bước chờ hẹn giờ thì `GET /management/timer-jobs?processInstanceId=` có ngay một việc
  hẹn giờ với `elementId` (id của bước chờ), `dueDate`, `tenantId`; lọc theo hồ sơ có tác dụng (hồ sơ khác cùng chờ
  không lọt vào).
- Hoàn thành bước cuối thì lời gọi trả về khi hồ sơ đã kết thúc: lịch sử có `endTime`, `endActivityId`, biến kèm kiểu
  (`string`, `boolean`, `double`), bước người làm có `assignee` là người đã nhận.
- Hẹn giờ một giây đến hạn sau khoảng mười giây: Flowable quét hẹn giờ theo chu kỳ.

## Quyết định

- **Cờ trong BPMN:** `<process ... mortise:seal="true">` với `xmlns:mortise="https://mortise-dx/bpmn"`. Không dùng
  tiền tố `flowable:`: người đọc sẽ tưởng là tính năng của Flowable. Giá trị chỉ là `true` hay `false`; `make
  check-fast` kiểm bằng chính mã của workflow-api (`core/workflow-api/app/seal.py`). Không đặt cờ trong khai báo bước
  của Tầng 2: lõi không đọc bảng của Tầng 2. Quy trình rà soát của gói xã và quy trình mẫu `core-sealed` khai cờ này.
- **Bản JSON chuẩn, phiên bản 1:** mã hồ sơ, tenant, khóa quy trình, mã định nghĩa, thời điểm lập và kết thúc, kết quả
  (`endActivityId`), giá trị các biến là trường của một bước trong BPMN của hồ sơ, và mỗi bước người làm (id, lúc bắt
  đầu, lúc xong, người nhận, có bị hủy không) cùng mỗi bước chờ (id, lúc bắt đầu, lúc xong). Thời điểm băm dạng số
  mili giây từ epoch, không băm chuỗi, vì cách Flowable viết chuỗi thời điểm đổi theo múi giờ. JSON có khóa sắp xếp,
  không khoảng trắng, UTF-8; băm SHA-256. Không băm tệp: tệp gắn với dòng danh mục, không gắn hồ sơ
  ([ADR 0041](0041-documents-on-catalog-records.md)). Không băm biến người lập gửi và biến lõi đặt: người làm bước sau
  vẫn ghi đè được biến không là trường của bước nào (ADR 0031). Đổi cách dựng thì tăng phiên bản.
- **Lúc niêm phong:** ngay sau `claim_and_complete` của bước làm hồ sơ kết thúc; tenant lấy từ hồ sơ, không từ người
  gọi (bước cuối có thể do tenant cha làm, [ADR 0029](0029-parent-completes-delegated-step.md)); người làm ghi vào
  nhật ký là `sub` của người hoàn thành. Chỉ hồ sơ tới một sự kiện kết thúc; hồ sơ bị xóa giữa chừng không có kết quả
  nên không niêm phong.
- **Bù:** hồ sơ đã kết thúc mà chưa có dòng niêm phong (kết thúc do hẹn giờ hay sự kiện biên, hay workflow-api lỗi
  giữa lúc hoàn thành và lúc ghi) được niêm phong khi có người mở `GET /v1/workflow/instances/{id}` hay
  `GET /v1/workflow/cases/{id}`. Chọn bù khi đọc thay vì một vòng quét định kỳ: không thêm luồng chạy nền, không phải
  nhớ đã quét tới đâu, và nơi người xem thấy trạng thái niêm phong cũng là nơi bảo đảm có nó.
- **Lỗi khi ghi:** niêm phong hay ghi hạn lỗi sau khi bước đã hoàn thành thì ghi log, vẫn trả `204`.
- **Bảng `core.case_seals`:** mã hồ sơ (khóa), tenant, khóa quy trình, phiên bản, băm, lúc niêm phong. Chỉ thêm
  (trigger chặn sửa, xóa), gắn `core.audit_attach` nên mỗi dòng nằm trong chuỗi băm của nhật ký, không thêm chuỗi
  thứ hai. Hai đường niêm phong chạy cùng lúc thì `ON CONFLICT DO NOTHING` giữ dòng đầu. Không khóa ngoại tới
  `core.tenants`, như `core.audit_log`.
- **Hạn của bước chờ, bảng `core.case_deadlines`:** mã hồ sơ, tenant, quy trình, id bước chờ, `due_at`, lúc ghi. Sau
  khi khởi tạo hay hoàn thành một bước của quy trình có bước chờ, workflow-api đọc việc hẹn giờ của hồ sơ và ghi các
  việc ở nút `intermediateCatchEvent`; hẹn giờ của sự kiện biên gắn vào bước người làm thì bỏ. Chỉ thêm, gắn nhật ký:
  sửa `due_at` là kéo dài thời hạn. Quyền đọc cho gói (view hay trigger) thuộc #221.
- **Quyền:** `workflow_api` có `SELECT, INSERT` trên hai bảng, cấp trong migration. `core/postgres/roles.sh` chỉ tạo
  vai trò: nó chạy trước migration, khi bảng chưa có.
- **API:** `seal` (`hash`, `sealed_at`, `version`, hay `null`) trên `GET /v1/workflow/instances/{id}` (mọi người
  trong tenant của hồ sơ, gồm người duyệt) và `GET /v1/workflow/cases/{id}` (người lập). Không trên danh sách hồ sơ:
  mỗi hồ sơ sẽ tốn một lần đọc CSDL. Quy trình không khai cờ và không có bước chờ thì không đọc CSDL, không gọi thêm
  Flowable.
- **`make seal-verify`:** chạy trong container workflow-api, dựng lại bản JSON của mọi hồ sơ trong `core.case_seals`
  bằng đúng hàm lúc niêm phong và so băm; rồi so mỗi dòng niêm phong với dòng nhật ký ghi lúc niêm phong
  (`core.case_seals_unlogged()`, chạy bằng tài khoản postgres vì `workflow_api` không đọc được nhật ký). Mỗi hồ sơ
  lệch in một dòng bắt đầu bằng mã hồ sơ, thoát `1`. Hồ sơ không còn lịch sử trong Flowable cũng bị báo.
- **Smoke:** quy trình mẫu `core-sealed` (bước, hẹn giờ một giây, bước): có dòng hạn khi vào bước chờ, có băm sau bước
  cuối, `seal-verify` không báo hồ sơ đó; sửa thẳng `act_hi_varinst` của Flowable (commit, vì `seal-verify` đọc qua
  REST) thì báo đúng hồ sơ đó; đặt lại (cả khi bài dừng giữa chừng) thì thôi báo. Sửa băm trong `core.case_seals`
  khi tắt trigger thì khác dòng nhật ký (trong giao dịch rồi rollback). Smoke của gói xã kiểm dòng hạn của bước công
  khai và băm của hồ sơ có quyết định.

## Hệ quả

- **Phát hiện:** sửa biến là trường của bước, kết quả, người nhận hay thời điểm của một bước trong lịch sử Flowable
  sau khi niêm phong; xóa lịch sử của hồ sơ đã niêm phong; sửa băm trong `core.case_seals` khi dòng nhật ký lúc
  niêm phong còn trong CSDL.
- **Không phát hiện:** sửa trước khi niêm phong, tức với hồ sơ kết thúc không qua workflow-api, khoảng từ lúc kết
  thúc tới lần mở đầu tiên; sửa cả lịch sử Flowable lẫn `core.case_seals` lẫn nhật ký rồi tính lại chuỗi băm, với
  dòng ghi sau băm neo của lần sao lưu gần nhất (giới hạn của ADR 0009); sửa biến không là trường của bước nào.
- Hồ sơ kết thúc do hẹn giờ mà không ai mở thì không có dòng niêm phong; `seal-verify` chỉ kiểm hồ sơ đã có dòng.
- Gỡ gói xóa lịch sử của quy trình trong Flowable (cascade), nên mọi hồ sơ đã niêm phong của gói bị `seal-verify`
  báo là không còn lịch sử. Bảng chỉ thêm nên các dòng đó còn mãi; đó là cố ý: lịch sử bị xóa là bằng chứng mất.
- Dòng hạn chỉ được ghi khi bước dẫn vào bước chờ đi qua workflow-api. Bước chờ nối ngay sau một bước chờ khác, hay
  workflow-api lỗi lúc ghi, thì không có dòng; chưa có đường bù.
- `seal-verify` gọi Flowable ba lần cho mỗi hồ sơ đã niêm phong; chưa đo thời gian khi bảng lớn.
- Thêm cách dựng bản JSON mới thì phải giữ cách cũ để kiểm băm cũ; `seal-verify` báo phiên bản workflow-api không còn.
