<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0069. Tin công khai, đăng ký nhận và danh sách xếp theo thứ tự ưu tiên trong quy trình rà soát

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Hồ sơ rà soát của gói xã có phần vượt trên ngưỡng thì công khai 30 ngày rồi mới trình (NĐ 155/2025/NĐ-CP Điều 3a
khoản 3, bổ sung bởi Điều 3 NĐ 369/2026/NĐ-CP). Điểm a: tin đăng trên Cổng thông tin điện tử của UBND tỉnh, nêu địa
chỉ, công năng, phần diện tích dự kiến bố trí, sơ đồ mặt bằng hay tài liệu hiện trạng, thông tin khác. Điểm b: trong
thời hạn đó, đơn vị có nhu cầu gửi văn bản đề nghị. Điểm c: đơn vị tiếp nhận chọn theo năm thứ tự ưu tiên, đứng đầu là
sự phù hợp công năng, diện tích, rồi theo phạm vi quản lý từ gần tới xa. Trước đây bước công khai chỉ là hẹn giờ, người
trình gõ tay tên đơn vị nhận.

Ràng buộc:

- **Cửa sổ nhận đăng ký do máy chủ quyết định.** Hết hạn, Flowable tự đi tiếp mà không gọi workflow-api; gói không đọc
  Flowable. Hạn của bước chờ có trong `core.case_deadlines` ([ADR 0053](0053-case-seals-and-timer-deadlines.md)).
- **Mọi quyền Hasura so một cột với tenant của token;** `scripts/hasura-metadata.py` không nhận `_or`, nên một quyền
  không diễn đạt được "dòng của tôi hoặc dòng gửi cho tôi".
- **Cây tenant có hai cấp** (tỉnh, xã; [ADR 0016](0016-parent-tenant-rollup.md)). Không có tenant cho đơn vị thuộc xã.
- **Đơn vị đăng ký cạnh tranh nhau,** nên không được thấy đăng ký của nhau.
- **Văn bản không nêu cách đo "phù hợp".**
- **Bước trình chỉ có ô chữ:** biểu mẫu của bước (`contracts/workflow.schema.json`) là JSON Schema cho rjsf, không có
  lựa chọn đọc từ GraphQL như biểu mẫu của menu ([ADR 0030](0030-form-component.md)).

Cách tạo tin đã xét:

- **Trigger của gói trên `core.case_deadlines` tự thêm tin** khi hồ sơ vào bước công khai. Lõi không biết cơ sở của
  hồ sơ (biến `facilityId` chỉ ở Flowable), nên người dùng vẫn phải điền phần lớn nội dung. Mã của gói còn chạy trong
  lệnh ghi của workflow-api: lỗi ở gói làm mất dòng hạn của lõi.
- **workflow-api ghi tin:** lõi sẽ biết nghiệp vụ, trái ranh giới Tầng 1.
- **Người duyệt của xã thêm tin qua Hasura bằng token của mình, trigger kiểm với dòng hạn của lõi.** Người đăng đằng
  nào cũng phải đăng tin trên cổng tỉnh và dán đường dẫn về. Đã chọn.

## Quyết định

- **Bảng `notices`** (khóa `case_id`): cơ sở, công năng, diện tích dự kiến bố trí, sơ đồ hay tài liệu hiện trạng,
  thông tin khác, đường dẫn tin trên cổng tỉnh. Biểu mẫu menu "Đăng tin công khai" thêm dòng bằng vai trò `manager`.
  Ô chọn hồ sơ đọc view `publication_cases`: hồ sơ của xã đang công khai mà chưa có tin. Trigger trước khi thêm:
  - lấy tenant của hồ sơ từ dòng hạn mới nhất của bước `publication` trong `core.case_deadlines`; `tenant_id` do quyền
    đặt từ token, khác nhau thì từ chối;
  - từ chối khi đã quá hạn;
  - chép thời hạn và địa chỉ cơ sở vào tin.

  Địa chỉ được chép, không đọc mỗi lần, vì tin đã đăng không đổi theo khi sửa cơ sở. Khóa ngoại ghép
  `(tenant_id, facility_id)` giữ tin nói về cơ sở của chính xã.
- **Bảng `receive_requests`:**
  - đơn vị đăng ký là tenant trong token; `owner_tenant_id` (xã đăng tin) do trigger đặt từ tin;
  - trigger so `now()` với hạn của lõi, không với bản chép trong tin;
  - chỉ nhận chính xã đăng tin, tenant cha và xã cùng cha. Phép so cha dùng `=`, nên tỉnh khác (cha `NULL`) không lọt;
  - đăng ký từ chính xã đăng tin phải có `unit_name`: đó là cách biểu diễn đơn vị thuộc xã khi cây chỉ có hai cấp;
  - không có quyền sửa hay xóa, vì đơn đã gửi là hồ sơ.
- **Bảng `request_assessments`:** tiêu chí thứ nhất gồm `purpose_fit` và `area_fit` (`fit`, `unfit`) kèm ghi chú, do
  người duyệt của xã đăng tin ghi. Trigger chỉ nhận xã đăng tin của chính đăng ký đó. Bảng tách khỏi đăng ký để đơn vị
  đăng ký không đọc được đánh giá. Hai diện tích (đề nghị, dự kiến bố trí) hiện cạnh nhau ở danh sách đăng ký và trong
  ô chỉ đọc của biểu mẫu ghi tiêu chí.
- **Bậc là dữ liệu của gói** (`priority_tiers`, kèm trích dẫn):
  - đăng ký từ chính xã đăng tin là bậc 2;
  - đăng ký từ tỉnh hay xã cùng tỉnh là bậc 3, vì cơ quan quản lý cấp trên của xã là tỉnh, nên thứ tự thứ tư trùng thứ
    ba;
  - thứ tự thứ năm (tỉnh khác, cần đề nghị của Chủ tịch UBND tỉnh hay Bộ trưởng) ngoài phạm vi và bị từ chối.
- **Thứ tự trong view `request_board`:** phù hợp cả hai mặt, rồi chưa ghi, rồi có một mặt không phù hợp; sau đó bậc,
  rồi lúc đăng ký. Không đăng ký nào bị loại. Đây là diễn giải "xét tiêu chí thứ nhất trước rồi tới phạm vi quản lý";
  văn bản đặt cả năm trong một thứ tự mà không nói cách kết hợp.
- **Đọc chéo xã bằng view có `reader_tenant_id`:** mỗi dòng nhân thành một dòng cho mỗi tenant được đọc, quyền chỉ so
  cột đó với token, cùng cách với `area_rollup` ([ADR 0020](0020-facility-locations.md)).
  - `notice_board`: xã đăng tin, các xã cùng cha và tenant cha (người quyết định của tỉnh, dòng `scope: parent`,
    [ADR 0029](0029-parent-completes-delegated-step.md)).
  - `request_board`: xã đăng tin và tenant cha thấy mọi đăng ký kèm thứ tự, đánh giá và nhãn chọn. Đơn vị đăng ký khác
    chỉ có dòng của chính mình, các cột đó để trống, để không suy ra được số đơn vị cạnh tranh.
- **Mẫu tin công khai sinh trong SQL** (`notice_text`): đủ năm nội dung của điểm a, thời hạn, nội dung văn bản đề
  nghị theo điểm b, nơi đăng tải theo luật, và câu ghi đây là bản sao. Không có mô hình ngôn ngữ, nên cùng dữ liệu
  luôn cho cùng chữ. Số theo kiểu Việt Nam, giờ theo `Asia/Ho_Chi_Minh`.
- **Tầng 2, ba khả năng chung, không chữ nghiệp vụ:**
  - `sources` của một bước quy trình: trường của biểu mẫu chọn từ một bảng của gói, chỉ các dòng có cột `case` bằng
    mã hồ sơ của việc, đọc bằng vai trò `role`, xếp theo cột `order`, kèm chữ `empty` khi trống. Màn hình xử lý vẽ
    bằng chính ô `SourceChoice` của biểu mẫu. `make check-fast` kiểm trường có trong biểu mẫu, bảng và cột nằm trong
    quyền đọc của vai trò.
  - `writes` của danh mục: biểu mẫu sửa, thêm dòng ghi vào bảng gốc khi danh sách đọc một view dựng trên nó.
  - `detail.text` và `description` của danh mục: khối chữ giữ xuống dòng, tải về thành `.txt` UTF-8; đoạn hướng dẫn
    dưới tiêu đề.

  Lỗi CHECK của Hasura mang lý do của trigger thì giao diện hiện nguyên lý do. Đo trên Hasura v2.51.4-ce ngày
  2026-11-28: lỗi `check_violation` từ trigger thành `permission-error` với thông điệp "Check constraint violation. "
  cộng lời của trigger.
- **Bước trình:** `recipient` chọn từ `request_board`, giá trị là nhãn đầy đủ (thứ tự, đơn vị, mục đích, hai diện tích,
  bậc, tiêu chí thứ nhất, mã đăng ký). Nhờ vậy hồ sơ và bản niêm phong đọc được mà không mở CSDL, và bước `decide` hiện
  nó ở `details`. Trường không bắt buộc, vì hết hạn mà không ai đăng ký thì vẫn phải trình được.

## Hệ quả

- Trang "Tin công khai" chỉ là bản sao. Đăng tin trên cổng tỉnh thật ngoài phạm vi; người đăng dán đường dẫn về
  `portal_url`.
- Thời hạn trong ứng dụng là hẹn giờ của Flowable từ lúc duyệt, không phải từ lúc tin lên cổng tỉnh.
- Tin phải được đăng trong thời hạn; hồ sơ hết hạn mà chưa có tin thì không còn nhận đăng ký.
- Dòng hạn chỉ có khi bước dẫn vào bước chờ đi qua workflow-api (ADR 0053). Không có dòng thì không đăng tin, không
  đăng ký được, tức là đóng thay vì mở.
- Bước `publication` và khóa `facilities-review` được viết trong migration của gói: đổi id trong BPMN là phải sửa
  migration.
- `recipient` là chữ tự do với workflow-api (workflow-api không kiểm biểu mẫu); chỉ giao diện giới hạn ô chọn.
- Smoke của gói xóa tin thử bằng lệnh SQL, vì không có quyền xóa qua Hasura. Bài e2e để lại tin đã hết hạn trên trang.
- Đơn vị cấp dưới trong xã chưa là tenant, nên không tự đăng ký được. Xã đăng ký thay và ghi tên đơn vị.
