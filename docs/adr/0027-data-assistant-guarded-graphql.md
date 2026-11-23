<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0027. Trợ lý hỏi dữ liệu: câu GraphQL chỉ đọc qua guard, chạy bằng token người hỏi

- Trạng thái: Chấp nhận
- Ngày: 2026-11-22

## Bối cảnh

Cán bộ hỏi về dữ liệu của đơn vị mình, ví dụ "xã mình vượt bao nhiêu m²?". Câu trả lời phải lấy từ dữ liệu thật, không
được để người hỏi thấy dòng ngoài quyền của họ, và người hỏi phải thấy được câu truy vấn đã chạy. Trợ lý hỏi văn bản
([ADR 0021](0021-document-assistant.md)) chỉ đọc đoạn văn bản; nó không trả lời được câu về số liệu.

Quyền theo dòng đã nằm ở một chỗ: khai báo Hasura của lõi và của từng gói, lọc theo tenant trong token. Hasura cũng
cho vai trò `user` ghi vào một số bảng của gói, ví dụ biên chế hay tòa, phòng của cơ sở mình phụ trách. Câu do trợ lý
chạy bằng token người hỏi vì vậy có thể ghi, nếu không có gì chặn.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| SQL trên một tài khoản CSDL chỉ đọc | Phải chép luật quyền theo dòng sang SQL hay RLS; hai nơi giữ quyền thì lệch nhau mà không ai biết |
| Tập câu truy vấn cố định, mỗi câu một nút | An toàn nhưng không hỏi được câu nào gói chưa viết sẵn; không mở đường cho mô hình viết câu |
| GraphQL qua Hasura bằng token người hỏi, trước đó qua guard trên cây cú pháp | Quyền theo dòng vẫn do Hasura quyết định; guard chỉ phải chặn những gì không phải đọc trên bảng, cột gói khai |

## Quyết định

- **GraphQL qua Hasura, token người hỏi, vai trò `user`.** Dịch vụ trợ lý chạy câu qua cổng với token của người hỏi và
  header `X-Hasura-Role: user`, kể cả khi token có vai trò cao hơn. Guard không lặp lại luật quyền: dòng nào hiện do
  Hasura quyết định.
- **Mục menu chọn văn bản hay dữ liệu.** Cấu hình trợ lý (`contracts/assistant.schema.json`) có `documents` (hỏi văn
  bản) hoặc `data` (hỏi dữ liệu), không có cả hai. `data` khai nguồn (trường gốc GraphQL của gói, nhãn, mô tả), cột
  được hỏi, quan hệ một-một tới nguồn khác đã khai, `aggregate`, `max_rows` (trần 100) và câu mẫu kèm câu GraphQL viết
  sẵn. Tenant không bao giờ là cột hay tham số.
- **Danh sách cho phép chỉ đến từ mục menu.** `POST /v1/assistant/data-queries` nhận `question`, `app`, `item`, `query`.
  Dịch vụ đọc cấu hình của mục qua GraphQL bằng token người hỏi (`platform_menu_items` lọc theo tenant), không nhận
  bảng hay cột từ thân yêu cầu. Mục khai `roles` mà người hỏi không có vai trò nào trong đó trả cùng 404 như mục không
  có, để không lộ là mục tồn tại. Câu do người dùng tự viết cũng chỉ là một tập con của quyền GraphQL họ vốn có.
- **Kiểm lúc cài.** `scripts/check-assistant-data.py` (trong `make check-fast` và trong bộ cài gói, trước khi ghi gì)
  kiểm nguồn là bảng chủ sở hữu khai trong tệp quyền Hasura, khớp đúng tên bảng; cột nằm trong quyền đọc của `user`;
  `aggregate` cần `allow_aggregations`; quan hệ là object relationship tới đúng bảng của nguồn đích; mọi câu mẫu qua
  guard. Script dùng chính `platform/services/assistant/app/guard.py` và đúng bản graphql-core ghim trong
  `pyproject.toml` của dịch vụ.
- **Luật của guard**, theo thứ tự, dừng ở luật đầu tiên không qua và trả lý do tiếng Việt nêu phần tử vi phạm:
  - Tối đa 4000 ký tự; không ký tự điều khiển hay vô hình; tối đa 1000 token; không chú thích, không khối chuỗi `"""`.
    Guard kiểm cây của graphql-core còn Hasura phân tích lại câu bằng trình của nó; bỏ những chỗ hai trình có thể hiểu
    khác nhau thì câu đã kiểm và câu đã chạy là một.
  - Đúng một thao tác, loại `query`; không fragment (có tên hay inline), directive, biến, bí danh; không tên bắt đầu
    bằng `__` (introspection); không tham số hay khóa trùng tên trong một đối tượng, vì mỗi trình phân tích xử lý tên
    trùng khác nhau.
  - Trường gốc chỉ là nguồn đã khai; `<nguồn>_aggregate` chỉ khi khai `aggregate`; không `_by_pk`.
  - Trường gốc chỉ nhận `where`, `order_by`, `limit`; mọi trường khác không nhận tham số. Không `distinct_on`, `offset`.
  - Cột chọn, lọc, sắp xếp chỉ là cột đã khai; quan hệ đã khai đi theo danh sách của nguồn đích.
  - `where` chỉ có cột, quan hệ đã khai và `_and`, `_or`, `_not`; toán tử `_eq`, `_neq`, `_gt`, `_gte`, `_lt`, `_lte`,
    `_in`, `_nin`, `_is_null`, `_like`, `_ilike`, giá trị là số, chuỗi hay true/false, không `null`. Không biểu
    thức chính quy (có thể chạy rất lâu), toán tử jsonb, so sánh giữa hai cột hay `_exists`.
  - Mỗi danh sách có `limit` là số nguyên từ 1 tới `max_rows`; `_aggregate` chỉ bắt buộc `limit` khi có `nodes`, vì
    `limit` của nó áp cả cho số tổng hợp.
  - Tối đa 5 cấp lồng, 60 trường, 8 cấp điều kiện. Các trần này là điểm xuất phát, chưa đo.
- **Không sửa câu.** Câu chạy đúng chữ là câu người hỏi gửi và thấy trong khối "Câu truy vấn đã chạy".
- **Hasura từ chối sau guard thì từ chối, không thử lại.** Lý do trả cho người hỏi là lý do chung, vì lỗi của Hasura có
  thể nêu tên bảng, cột hay quyền người hỏi không được biết; chi tiết chỉ vào log của dịch vụ.
- **Kết quả là bảng do giao diện vẽ.** Mỗi nguồn trong câu thành một bảng với tiêu đề và nhãn cột của gói; ô hiện như chữ
  thường. Dữ liệu người dùng nhập, kể cả chữ trông như lệnh, chỉ là chữ trong ô.
- **Nhật ký.** Mỗi câu hỏi dữ liệu một dòng ở `platform.assistant_questions`, như câu hỏi văn bản: `documents` rỗng,
  `outcome` là `answered`, `refused` hay `failed`, kèm `item`, `query`, `row_count` và `attempts`. Không lưu dòng kết quả: quản
  trị đọc nhật ký không được thấy qua đường này những dòng mà quyền của họ ở bảng nguồn không cho thấy. Câu mẫu chạy
  không qua mô hình nên `model` và `attempts` trống ở các dòng đó.
- **Mô hình không bao giờ thấy dòng dữ liệu.** Câu hỏi gõ tự do, mô hình viết câu kèm một lượt sửa theo lý do của guard:
  [ADR 0034](0034-model-written-guarded-graphql.md); mô hình chỉ nhận mô tả nguồn và cột, câu nó viết đi qua cùng
  guard, và kết quả vẫn là bảng do giao diện vẽ. Bộ câu hỏi đánh giá là bước sau của issue #116.
- **Trong phiên bản này chỉ quan hệ một-một.** Quan hệ một-nhiều cần `limit` lồng và làm bảng kết quả khó đọc; để sau
  khi có nhu cầu thật.

## Hệ quả

- Gói thêm câu hỏi dữ liệu bằng khai báo: một mục menu và một tệp cấu hình, không viết mã.
- Câu mẫu bấm là chạy ngay, không cần bật Ollama; `make smoke` và `make e2e` kiểm trên mục mẫu của lõi
  (`/apps/core/ask-data-example`), smoke của gói kiểm cách ly xã, lời chèn lệnh trong tên cơ sở và câu xóa trên bảng
  `user` ghi được.
- Guard là lớp duy nhất chặn câu ghi qua đường này, nên mọi nới lỏng (toán tử, tham số, quan hệ một-nhiều) phải có ca
  kiểm trong `platform/services/assistant/tests/test_guard.py`.
- Đổi trần của guard thì câu mẫu đã cài có thể không còn qua; `make check-fast` và bộ cài báo ngay.
