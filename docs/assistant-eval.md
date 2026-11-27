<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Đo trợ lý hỏi văn bản

Lượt đo trả lời ba câu: trợ lý trích đúng đoạn bao nhiêu lần, có từ chối câu hỏi mà văn bản không nói không, và mỗi
câu mất bao lâu. Lệnh: `make assistant-eval`, script `scripts/assistant-eval.py`. Đường ống được đo:
[ADR 0021](adr/0021-document-assistant.md).

## Bộ câu hỏi

Mỗi gói có trợ lý hỏi văn bản tự viết bộ câu ở `apps/<gói>/tests/assistant-questions.yaml`; định dạng ghi ở đầu tệp
của gói `facilities-commune`. Mỗi câu có một loại:

| Loại | Ý nghĩa | Đáp án |
|---|---|---|
| `direct` | Hỏi bằng chữ của văn bản | Mã đoạn `<văn bản>/<đoạn>` |
| `paraphrase` | Hỏi bằng từ thường ngày, khác chữ của văn bản | Mã đoạn |
| `superseded` | Hỏi điều đã bị văn bản sau sửa hay bãi bỏ | Mã đoạn đang có hiệu lực |
| `out-of-scope` | Văn bản được hỏi không nói | Phải từ chối |

Câu có `numbers` là câu hỏi số: câu trả lời phải có các số đó. `make check-fast` kiểm bộ câu không cần lõi: mã câu
không trùng, đoạn trong đáp án có trong `knowledge/` của gói, chưa bị thay (`superseded_by`), thuộc văn bản trong cấu
hình trợ lý.

## Cách chạy

Cần lõi đang chạy, đã `make seed`, đã cài gói, và mô hình sẵn sàng (`make ai-up`, hay API khai trong `.env`).

```bash
make assistant-eval                                   # gói facilities-commune, cả bộ câu
make assistant-eval APP=<gói> ONLY=<mã câu>,<mã câu>  # một phần bộ câu, ghi là lượt không đủ bộ
```

Script lấy token mới của `user.a` (client `mortise-test`) cho mỗi câu rồi gửi câu đó tới
`/v1/assistant/questions` qua cổng, từng câu một, với `documents` của cấu hình trợ lý của gói. `DEMO_USER_PASSWORD` và
`MORTISE_PUBLIC_URL` đọc từ biến môi trường, rồi tới `.env`.

Kết quả ghi vào `docs/assistant-eval/<ngày>-<mô hình>.json` (mọi phản hồi) và `.md` (tóm tắt), `OUT=<thư mục>` để
ghi chỗ khác. Lượt chọn một phần câu, hay có câu không nhận được phản hồi 200, mang đuôi `-partial` và lệnh trả mã
lỗi. Tệp ghi kèm ngày giờ, commit của mã nguồn, mô hình theo phản hồi của trợ lý (với Ollama thêm digest ghim trong
`core/ollama/models.txt`), loại CPU, số luồng, RAM và hệ điều hành của máy chạy lệnh, cùng ngưỡng điểm tìm, số đoạn,
số token sinh và thời gian chờ trong `compose.yaml`. Máy chạy lệnh được ghi chứ không phải máy chạy lõi: hai máy là
một khi đo qua `http://localhost:9080`. Lõi dựng từ commit khác thì cấu hình đang chạy có thể khác cấu hình ghi.

## Cách chấm

Mỗi câu nhận một trong các kết quả:

- `correct`: câu có đáp án được trả lời, trích ít nhất một đoạn trong đáp án, và câu trả lời (chữ của mô hình, không
  phải câu trích) có mọi số ở `numbers`, so theo giá trị như bước kiểm số của trợ lý (`05` là 5, `30` khác `300`);
  câu phải từ chối được từ chối.
- `wrong-citation`: trả lời nhưng không trích đoạn nào trong đáp án.
- `missing-number`: trích đúng đoạn nhưng thiếu số được hỏi.
- `refused`: câu có đáp án bị từ chối. Tóm tắt chia theo bước từ chối: `retrieval` (không đoạn nào đạt ngưỡng điểm,
  không gọi mô hình), `model` (mô hình trả không trả lời được), `verify` (câu trả lời trượt bước kiểm câu trích hay
  kiểm số).
- `answered`: câu phải từ chối lại được trả lời.
- `error`: không có phản hồi 200 (cổng giới hạn tần suất, mô hình chưa bật, quá giờ). Không bao giờ tính là từ chối
  đúng.

Chỉ số: trích đúng trên số câu có đáp án; trong đó câu hỏi số; từ chối đúng trên số câu ngoài phạm vi; độ trễ đo ở
phía lệnh đo, từ lúc gửi tới lúc nhận phản hồi, trung vị và p90 theo hạng gần nhất, tính riêng cho câu có gọi mô hình
và cho mọi câu. Câu bị từ chối ở bước tìm trả về gần như ngay, nên con số của mọi câu thấp hơn và không so được với
số đo của từng lần sinh.

Số của lượt đo 2026-11-19 trong ADR 0021 (11/18 trả lời đúng, trung vị 29 s) đo bộ 22 câu khác và cách tìm bằng
vector, trước khi có đường ống này; không so trực tiếp được với lượt đo ở đây.

## Kết quả

Chỉ ghi lượt đủ bộ câu, sau khi lệnh chạy thật; không ghi ước lượng. Mỗi dòng trỏ tới tệp kết quả đã commit trong
`docs/assistant-eval/`.

Chưa có lượt đo đủ bộ.
