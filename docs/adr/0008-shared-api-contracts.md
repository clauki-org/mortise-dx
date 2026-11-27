<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0008. Hợp đồng API giữa các tầng nằm trong contracts/, CI kiểm cả ví dụ đúng và ví dụ sai

- Trạng thái: Chấp nhận
- Ngày: 2026-11-15

## Bối cảnh

Ba tầng được làm song song và chỉ nói chuyện với nhau qua giao thức chuẩn ([ADR 0003](0003-three-tier-layout.md)).
Có ba thứ mà nhiều bên cùng dựa vào:

- claim trong access token: cổng, Hasura, workflow-api, giao diện và trợ lý AI đọc để xác định người gọi;
- định dạng `apps/<gói>/app.yaml`: người viết gói viết ra, bộ cài gói (kế hoạch) và khung giao diện đọc vào;
- API của workflow-api: giao diện Tầng 2 và gói gọi tới.

Trước quyết định này, hình dạng của cả ba chỉ nằm trong mã và trong văn xuôi ở `docs/api.md`. Máy không kiểm được
văn xuôi, nên một bên đổi mà bên kia không biết thì chỉ lộ ra khi ghép lại.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Chỉ mô tả bằng văn xuôi trong `docs/` | Không kiểm tự động được; tài liệu lệch với mã mà không ai biết |
| Viết tay OpenAPI của workflow-api | Hai nguồn sự thật: mã và tệp viết tay; lệch nhau khi đổi route mà quên sửa tệp |
| Schema kèm ví dụ hợp lệ, không có ví dụ sai | Schema bị nới lỏng vẫn qua mọi ví dụ hợp lệ; không có gì cho thấy nó còn chặn được gì |
| Schema và OpenAPI sinh từ mã trong `contracts/`, CI kiểm ví dụ đúng và ví dụ sai | Một nguồn cho mỗi hợp đồng, lệch thì CI báo lỗi |

## Quyết định

- Hợp đồng giữa các tầng nằm trong `contracts/` ở gốc repo, không thuộc tầng nào:
  - `token-claims.schema.json`, `app.schema.json` và `workflow.schema.json` (khai báo bước của quy trình): JSON
    Schema, bản 2020-12;
  - `workflow-api.openapi.json`: sinh từ mã của workflow-api bằng `make contracts`, không sửa tay.
- Đổi claim token, định dạng `app.yaml` hay API của dịch vụ thì sửa hợp đồng trong cùng pull request. Đổi route hay
  model của workflow-api thì chạy `make contracts` và commit tệp OpenAPI.
- Mỗi schema có ví dụ hợp lệ trong `contracts/examples/` và ví dụ sai trong `contracts/examples/invalid/`:
  - tệp ví dụ sai đặt tên `token-claims.<lỗi>.json`, `app.<lỗi>.yaml` hoặc `workflow.<lỗi>.yaml`; tên quyết định
    schema nào kiểm nó;
  - mỗi tệp phạm đúng một luật. Chỉ đòi "bị từ chối" thì tệp hỏng cú pháp hay tệp sai nhiều chỗ vẫn qua, và bỏ một
    luật khỏi schema có thể không làm ví dụ nào thay đổi kết quả;
  - luật bị phạm phải là luật tệp được viết ra để thử: `contracts/examples/expected-errors.txt` ghi vị trí lỗi và một
    đoạn thông điệp cho từng tệp. Chỉ đếm số lỗi thì tệp bị từ chối vì lý do khác, sau khi schema đổi, vẫn qua;
  - giá trị sai cố ý không giống thứ có thật (`no-such-component`, `no_such_key`), để ví dụ không thành hợp lệ khi
    hợp đồng thêm thành phần hay khóa mới.
- `make check-fast` gọi `scripts/contracts.sh check`, kiểm: schema đúng với metaschema; ví dụ hợp lệ và mọi
  `apps/*/app.yaml` qua schema; từng ví dụ sai phạm đúng một luật; tệp trong `invalid/` sai mẫu tên bị báo lỗi;
  OpenAPI đã commit khớp với OpenAPI sinh từ mã; khai báo bước khớp với BPMN (`scripts/check-workflow-steps.py`).
- `make smoke` lấy một token thật từ Keycloak và kiểm nó theo `token-claims.schema.json`.
- Công cụ kiểm là check-jsonschema, chạy qua `uvx`, ghim phiên bản 0.29.4.
- Luật kiểm được trên một tệp thì viết vào schema. Luật cần so nhiều trường hoặc nhiều tệp với nhau (mục menu trùng
  `id`, `id` gói khớp tên lược đồ, vai trò và tệp có tồn tại) thuộc về bộ cài gói. Riêng khai báo bước được kiểm
  ngay trong `make check-fast`, vì bước quên khai báo chỉ lộ ra khi đã có task trên bảng việc: mỗi userTask có
  khai báo, không khai bước BPMN không có, nút trong một bước không trùng `id`, trường bắt buộc có trong biểu mẫu.
- Hạn xử lý và quy tắc bốn mắt khai trong BPMN (`flowable:dueDate`, `flowable:category`), nơi Flowable và
  workflow-api thực thi; khai báo bước không có trường cho hai thứ này, để không có hai nơi lệch nhau.

Đã kiểm ngày 2026-11-15 bằng `scripts/contracts.sh check` với check-jsonschema 0.29.4:

- thay lần lượt từng tệp trong 14 ví dụ sai bằng ví dụ hợp lệ: lệnh báo lỗi ở cả 14 lần;
- đổi một route của workflow-api mà không chạy `make contracts`: lệnh báo OpenAPI lệch với mã;
- đặt một tệp sai mẫu tên vào `invalid/`: lệnh báo lỗi.

## Hệ quả

- Lõi, giao diện và gói làm song song trên hợp đồng đã viết ra; thay đổi hợp đồng hiện trong diff của pull request.
- Thêm một luật vào schema thì thêm một ví dụ sai cho luật đó. Nới một luật thì ví dụ sai của nó thành hợp lệ, CI
  báo lỗi, và ví dụ phải được sửa hoặc xóa có chủ ý.
- Thêm một thành phần Tầng 2 thì thêm tên của nó vào danh sách `component` trong `app.schema.json`. Schema cấu hình
  của từng thành phần không nằm trong quyết định này; nó được viết cùng thành phần.
- CI chỉ thấy gói nằm trong repo này. Gói viết ngoài repo chỉ được kiểm khi cài, nên bộ cài gói phải kiểm `app.yaml`
  bằng `app.schema.json` trước khi chạy migration, rồi kiểm thêm các luật schema không diễn đạt được.
  `scripts/contracts.sh package <gói>` gom mọi bước kiểm của một gói (schema, luật nhiều tệp của `app.yaml`, cấu hình
  thành phần với BPMN và quyền Hasura của gói); `make check-fast` gọi nó cho từng gói, `make app-install` gọi trước
  khi chạy migration và dừng nếu lỗi.
- Schema claim chỉ mô tả hình dạng của token. Chữ ký, hạn dùng và nơi cấp vẫn do cổng và workflow-api kiểm khi chạy
  ([ADR 0004](0004-workflow-access-control.md)).
- `make check-fast` và `make smoke` cần `uv` trên máy phát triển và trên CI.
