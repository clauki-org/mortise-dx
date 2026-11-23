<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0034. Câu hỏi dữ liệu gõ tự do: mô hình viết một câu GraphQL, guard kiểm, sửa tối đa một lần

- Trạng thái: Chấp nhận
- Ngày: 2026-11-23

## Bối cảnh

Trợ lý hỏi dữ liệu ([ADR 0027](0027-data-assistant-guarded-graphql.md)) chạy câu mẫu gói viết sẵn qua guard, bằng
token người hỏi. Người dùng chỉ hỏi được những câu gói đã nghĩ tới. Câu hỏi gõ tự do cần một bước biến chữ thành câu
truy vấn, và bước đó là mô hình ngôn ngữ: Ollama tại chỗ hay API tương thích OpenAI theo cấu hình
([ADR 0021](0021-document-assistant.md) và bổ sung 2026-11-22).

Mô hình có thể viết sai, bị chữ trong câu hỏi dẫn đi (chèn lệnh), hay viết câu ghi. Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Mô hình viết SQL, chạy bằng tài khoản CSDL chỉ đọc | Phải chép luật quyền theo dòng sang SQL; ADR 0027 đã loại vì hai nơi giữ quyền thì lệch nhau |
| Mô hình chọn một câu mẫu theo câu hỏi | Không hỏi được câu nào gói chưa viết; chỉ đổi nút bấm thành ô gõ |
| Mô hình gọi công cụ nhiều lượt, đọc kết quả rồi hỏi tiếp | Mô hình thấy dòng dữ liệu, lời chèn trong dữ liệu đi vào prompt; số lượt và thời gian khó giới hạn |
| Mô hình viết một câu GraphQL chỉ đọc, qua cùng guard, sửa tối đa một lần theo lý do của guard | Quyền vẫn do Hasura quyết định, guard vẫn là lớp chặn câu ghi; mô hình không thấy dòng nào; số lời gọi có trần |

## Quyết định

- **Một câu GraphQL, không bao giờ SQL.** `POST /v1/assistant/data-questions` nhận `question`, `app`, `item` (không nhận
  bảng, cột hay câu truy vấn). Dịch vụ đọc khối `data` của mục menu bằng token người hỏi như ADR 0027, mô hình viết
  đúng một câu GraphQL, câu đó qua `guard.check` y như câu mẫu rồi chạy qua Hasura bằng token người hỏi với vai trò
  `user`. Câu chạy đúng chữ là câu người hỏi thấy.
- **Thứ tự cố định:** kiểm đầu vào (400, không ghi nhật ký, không gọi gì) → đọc mục menu (404, kể cả khi mục khai
  `roles` mà người hỏi không có) → danh sách cho phép (502 khi cấu hình hỏng) → giữ lượt sinh (503 khi đang bận) →
  lời gọi mô hình thứ nhất → guard → nếu guard từ chối và còn thời gian: một lượt sửa → nhả lượt sinh → Hasura.
  Không gọi mô hình sau khi gọi Hasura, kể cả khi Hasura từ chối.
- **Mô hình không bao giờ nhận dòng dữ liệu.** Prompt chỉ dựng từ khối `data` của mục menu và câu hỏi. Prompt hệ thống
  không có từ nghiệp vụ, giống nhau với mọi cấu hình, và nêu đúng các luật guard sẽ kiểm, lấy từ hằng số của
  `guard.py` (toán tử, tham số, phép tổng hợp, thứ tự sắp xếp): đúng một `query`; không mutation, subscription, biến,
  fragment, directive, bí danh, chú thích, khối chuỗi, tên bắt đầu bằng `__`; trường gốc chỉ là nguồn đã khai,
  `<nguồn>_aggregate` chỉ khi khai `aggregate`, không `_by_pk`; tham số chỉ `where`, `order_by`, `limit`; mọi danh
  sách có `limit` từ 1 tới `max_rows`; giá trị là số, chuỗi, true/false, không `null`; không bao giờ thêm điều kiện
  theo đơn vị (Hasura lọc). Câu đòi ghi, hỏi đơn vị khác hay ngoài phạm vi thì đặt `answerable` là false. Chữ trong
  câu hỏi là dữ liệu, không phải chỉ dẫn; câu hỏi nằm giữa hai dòng đánh dấu, và dịch vụ bỏ các dòng đánh dấu người
  dùng tự gõ.
- **Tin nhắn người dùng** gồm, với mỗi nguồn: tên trường, nhãn, mô tả, từng `cột: mô tả`, quan hệ, có tổng hợp hay
  không; `max_rows` đã kẹp theo guard; các cặp câu hỏi và câu truy vấn mẫu của mục; rồi câu hỏi. Cột `tenant_id` bị
  bỏ như guard bỏ, kể cả khi cấu hình có.
- **Đầu ra theo JSON Schema** `{answerable, query, reason}`, cả ba bắt buộc (`strict` với API). `reason` chỉ vào log
  ở mức DEBUG, không bao giờ tới người hỏi; lời từ chối người hỏi thấy là chữ cố định của dịch vụ và giao diện.
- **Sửa tối đa một lần.** Guard từ chối câu đầu thì lượt sửa nhận lại hội thoại đầu, câu trả lời cũ của mô hình và
  lý do của guard, kèm lời dặn viết lại theo luật hoặc đặt `answerable` là false. Vẫn bị từ chối thì trả lời từ chối
  kèm câu bị từ chối cuối cùng. Không sửa sau khi Hasura từ chối: lỗi của Hasura có thể nêu tên bảng, cột người hỏi
  không được biết (ADR 0027), và gửi nó cho mô hình là gửi chúng ra ngoài khi dùng API.
- **Một hạn chung cho hai lời gọi.** Hạn là `ASSISTANT_TIMEOUT_SECONDS` tính từ trước lời gọi đầu; lượt sửa chỉ nhận
  phần thời gian còn lại. Hết hạn trước hay trong lượt sửa thì trả lời từ chối kèm câu bị guard từ chối (mã 200), không
  phải 504, vì lượt đầu đã có kết quả. Lời gọi đầu quá giờ là 504. Thời gian chờ của httpx tính theo từng bước (kết
  nối, đọc), nên hạn là hạn của cấu hình chờ, không phải trần cứng của đồng hồ. Cộng thời gian chờ đọc mục menu, chạy
  câu (10 giây mỗi lời gọi) và ghi nhật ký (10 giây), tổng vẫn dưới thời gian chờ đọc 200 giây của cổng
  (`core/apisix/apisix.yaml`); ghi chú ở `compose.yaml`.
- **Lượt sinh dùng chung.** Một khóa cho cả hỏi văn bản và hỏi dữ liệu, giữ qua cả hai lời gọi, nhả trước khi gọi
  Hasura; đang bận thì 503 ngay, không xếp hàng.
- **Lời gọi mô hình.** Mỗi nhà cung cấp có `chat(messages, schema, name, timeout)`; `generate` của hỏi văn bản là
  lớp bọc mỏng quanh nó. Nhiệt độ 0, `think` false với Ollama, `num_predict` / `max_tokens` bằng
  `ASSISTANT_NUM_PREDICT`. Lỗi giữ như ADR 0021: không kết nối, mô hình chưa tải, khóa sai, 429, 503 quá tải là 503;
  quá giờ là 504; lỗi khác và nội dung sai dạng là 502. Mô hình dừng vì hết token (`done_reason` hay `finish_reason`
  là `length`) là 502 với lời chỉ người vận hành tăng `ASSISTANT_NUM_PREDICT`. Mỗi lời gọi một dòng log mức INFO:
  nhà cung cấp, số token vào và ra, lý do dừng, thời gian; không kèm nội dung. Mức log của dịch vụ là
  `ASSISTANT_LOG_LEVEL` (mặc định INFO).
- **Phản hồi** dùng chung `DataAnswer` với câu mẫu, thêm `model`, `attempts` (1 hay 2) và `refused_by` (`model`,
  `guard`, `hasura`); `query` là chuỗi rỗng khi mô hình không viết câu. `/data-queries` trả ba trường đó là null.
- **Nhật ký.** Mỗi câu một dòng ở `platform.assistant_questions` như câu mẫu, thêm mô hình, nhà cung cấp, tên máy
  (từ cấu hình, như hỏi văn bản) và `attempts`; `query` là NULL khi mô hình không viết câu. Lỗi sau khi mô hình đã viết
  câu (ví dụ Hasura không trả lời) vẫn ghi câu đó và số lượt. Migration của ADR 0027 đã có đủ cột và ràng buộc.
- **Giao diện.** Mục hỏi dữ liệu có ô hỏi và nút "Hỏi" cạnh các nút câu mẫu (câu mẫu vẫn chạy câu viết sẵn). Kết quả
  ghi "Câu truy vấn do <mô hình> viết, chạy tại chỗ" hay "qua API <tên máy>", ghi khi mô hình đã viết lại, nhắc người
  hỏi đọc câu đã chạy, và lời từ chối cố định theo `refused_by`.

**Dữ liệu rời máy chủ khi dùng API**, mỗi câu hỏi tới được lời gọi mô hình: câu hỏi nguyên văn; tên, nhãn, mô tả của
nguồn, cột và quan hệ trong khối `data` của mục menu; `max_rows`; các cặp câu hỏi và câu truy vấn mẫu; ở lượt sửa
thêm câu mô hình đã viết và lý do của guard; prompt hệ thống, JSON Schema, tên mô hình, khóa API. Không gửi: dòng dữ
liệu, lỗi của Hasura, token, `sub`, tenant hay tên người hỏi, nhật ký câu hỏi. Dòng WARNING lúc khởi động của dịch vụ
nêu điều này khi chọn API.

## Đo

Phần này chưa có số: bộ câu hỏi đánh giá và kết quả đo trên Ollama và trên API là việc của pull request kế tiếp của
#116. Ngưỡng đặt trước khi đo, để kết quả không chỉnh ngưỡng theo:

- Không câu nào trả về dòng của đơn vị khác.
- Câu đòi ghi và câu introspection bị từ chối ở mọi lần chạy (100%).
- Không câu nào nhận 504.
- p95 thời gian trả lời dưới 150 giây.
- Câu hỏi về dòng dữ liệu: ít nhất 80% trả đúng.

## Hệ quả

- Người dùng hỏi được câu gói chưa viết sẵn, trên đúng bảng, cột gói khai, mà quyền vẫn chỉ ở Hasura và guard vẫn là
  lớp duy nhất chặn câu ghi; prompt chỉ là lớp thêm.
- Câu đã qua guard vẫn có thể hiểu sai câu hỏi (lọc sai cột, thiếu điều kiện). Giao diện nhắc đọc câu đã chạy; tỉ lệ
  đúng chỉ biết sau khi đo.
- Mỗi câu hỏi tốn một hay hai lời gọi mô hình và giữ lượt sinh trong thời gian đó; người hỏi văn bản cùng lúc nhận 503.
- Mô tả bảng, cột trong cấu hình của gói rời máy chủ khi người vận hành chọn API; gói viết mô tả phải coi đó là chữ
  có thể gửi ra ngoài.
- `ASSISTANT_NUM_PREDICT` phải đủ cho câu truy vấn dài nhất; thiếu thì người hỏi nhận 502 chỉ biến cần tăng.
