<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0021. Trợ lý hỏi văn bản: mô hình tại chỗ, tìm bằng token người hỏi, câu trích do hệ thống chép

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

Cán bộ hỏi về văn bản mà gói nạp vào; trợ lý trả lời kèm câu gốc và vị trí của nó trong văn bản, không đủ căn cứ thì
từ chối (#115). Trợ lý không được thấy dữ liệu ngoài quyền người hỏi, và mọi câu hỏi được ghi nhật ký (#47). Mô
hình phải chạy trên máy chủ của tổ chức, bằng CPU.

Lượt đo thử ngày 2026-11-19 (#114): Ollama trên máy 14 GiB RAM, tìm 4 đoạn bằng vector (bge-m3), mô hình trả JSON
gồm câu trả lời, câu trích, nguồn, nhiệt độ 0; bộ 22 câu về NĐ 155/2025 và NĐ 369/2026, 18 câu có đáp án và 4 câu phải
từ chối. Câu trả lời chỉ tính đúng khi câu trích nằm nguyên văn trong đoạn đã tìm.

| Mô hình | Đúng | Từ chối đúng | Trích đúng | Trung vị / tối đa | RAM đỉnh của container |
|---|---|---|---|---|---|
| Qwen3.5 4B | 11/18 (9/18 khi kiểm thêm số) | 3/4 | 12/18 | 29 s / 50 s | 9,0 GiB (gồm bge-m3) |
| Qwen3.5 9B, kiểm thêm số | 8/18 | 4/4 | 11/18 | 52 s / 85 s | 11,2 GiB (gồm bge-m3) |

Lượt đo cho thấy bốn điều: mô hình bịa số và kèm một câu trích có thật nhưng không liên quan; mô hình viết lại câu
trích thay vì chép nguyên văn; khoản đã bị văn bản sau thay thế vẫn làm mô hình trả lời sai; tìm bằng vector bỏ sót
các dòng phụ lục.

Cách tìm đoạn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Dịch vụ đọc CSDL bằng tài khoản riêng | Đi vòng qua quyền Hasura; dịch vụ phải tự lọc tenant, quên một chỗ là lộ dữ liệu |
| Hàm SQL tìm và xếp hạng, Hasura theo dõi hàm | Xếp hạng trong CSDL, mở rộng được sang vector; `scripts/hasura-metadata.py` chưa quản lý hàm |
| Dịch vụ đọc mọi đoạn được phép qua GraphQL bằng token người hỏi, xếp hạng trong tiến trình | Không thêm gì vào Hasura; quyền vẫn do Hasura lọc; chi phí tăng theo số đoạn |

Cách lấy câu trích đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Mô hình chép câu trích | Lượt đo: nhiều câu đúng ý bị loại vì mô hình viết lại câu |
| Mô hình chọn mã câu, hệ thống chép câu | Câu trích luôn nguyên văn; phần diễn đạt của mô hình vẫn phải kiểm riêng |

## Quyết định

**Chạy mô hình.** Ollama 0.40.16 (MIT, image chính thức) chạy trong profile `ai` của compose, chỉ khi người vận hành
bật bằng `make ai-up`; lõi chạy đủ khi không có nó. Ollama không mở cổng ra máy chủ hay qua APISIX. Mô hình mặc
định là Qwen3.5 4B (`qwen3.5:4b`): trong lượt đo, nó trả lời đúng nhiều hơn, nhanh hơn và cần ít RAM hơn bản 9B; bản
9B từ chối đúng cả 4 câu nhưng chậm gần gấp đôi. Giấy phép trọng số đọc ngày 2026-11-21: lớp giấy phép trong manifest của
`qwen3.5:4b` trên registry của Ollama là toàn văn Apache License 2.0; model card `Qwen/Qwen3.5-4B` trên Hugging Face
ghi `apache-2.0`.

**Ghim mô hình.** `core/ollama/models.txt` ghi tên mô hình và digest lớp trọng số. `make ai-up` tải mô hình rồi đối
chiếu digest với dòng `FROM` của `ollama show --modelfile`; khác thì dừng, vì tên trên registry trỏ được sang bản
khác khi nhà phát hành đẩy lại. Chỉ trọng số được ghim: mẫu prompt và tham số mặc định đi kèm trên registry có thể đổi
mà lệnh vẫn qua, nên dịch vụ tự đặt prompt và tham số sinh thay vì dựa vào bản đi kèm. Digest ghim ngày 2026-11-21
đọc từ manifest của `qwen3.5:4b` trên registry, trùng tệp trọng số của lượt đo #114. Trọng số không commit vào repo.

**Văn bản là khai báo của gói.** Gói liệt kê tệp văn bản ở mục `knowledge` của `app.yaml`. Mỗi tệp một văn bản theo
`contracts/knowledge.schema.json`: nguồn (địa chỉ, SHA-256 của bản gốc, ngày tải) và các đoạn, mỗi đoạn có mã, nhãn
vị trí và nguyên văn. Nhãn vị trí (ví dụ số điều, khoản) do gói viết, Tầng 2 chỉ hiển thị, nên mã và prompt của
Tầng 2 không biết cấu trúc của loại văn bản nào. Đoạn đã bị thay thế ghi `superseded_by` trỏ tới đoạn thay nó và
không được tìm. Bộ cài gói nạp văn bản vào bảng của Tầng 2 theo tenant (kế hoạch) và kiểm các luật nhiều tệp mà
schema không diễn đạt được: mã đoạn không trùng, `superseded_by` trỏ tới đoạn có thật, văn bản trong cấu hình trợ lý
có thật.

**Cấu hình thành phần.** Mục menu `component: assistant` trỏ tới tệp theo `contracts/assistant.schema.json`: lời giới
thiệu, câu hỏi mẫu, danh sách văn bản được hỏi. Schema có trước mã của thành phần để gói viết cấu hình song song;
`contracts/assistant.component.yaml` thêm cùng giao diện, vì bản mô tả chỉ ghi điều đã chạy
([ADR 0013](0013-component-config-contracts.md)).

**Đường ống cố định.** Dịch vụ `platform/services/assistant` (Tầng 2, kế hoạch) đứng sau cổng tại `/v1/assistant`;
OpenAPI của nó sinh từ mã bằng `make contracts` cùng pull request với mã ([ADR 0008](0008-shared-api-contracts.md)).
Mỗi câu hỏi đi qua đúng các bước sau, mô hình không gọi công cụ nào:

1. Kiểm đầu vào: độ dài câu hỏi; cổng giới hạn tần suất theo token; dịch vụ chỉ chạy một lượt sinh mỗi lúc và có
   thời gian chờ. Giới hạn đến từ cấu hình.
2. Tìm: đọc các đoạn của văn bản trong cấu hình qua `/v1/graphql` bằng token người hỏi, nên Hasura lọc theo tenant;
   bỏ đoạn có `superseded_by`; xếp hạng theo từ khóa trong tiến trình. Tìm bằng vector để sau.
3. Phân loại bằng luật và điểm tìm: không đoạn nào đạt ngưỡng thì từ chối vì không có căn cứ, không gọi mô hình. Phân
   loại bằng mô hình để cho #116, nơi cần chọn giữa hỏi văn bản và hỏi dữ liệu.
4. Sinh: prompt chung, không có từ nghiệp vụ; mỗi câu của đoạn đã tìm có mã; Ollama nhận JSON Schema ở `format` để
   câu trả lời có đúng ba trường: trả lời được hay không, câu trả lời, mã các câu làm căn cứ. Nhiệt độ 0.
5. Kiểm, trượt điều nào thì từ chối và ghi lý do:
   - mã câu phải thuộc đoạn đã tìm; câu trích là câu lưu trong dữ liệu, không phải chữ của mô hình;
   - chữ trong ngoặc kép của câu trả lời phải nằm nguyên văn trong câu được trích;
   - mọi số viết bằng chữ số trong câu trả lời phải có trong câu được trích hoặc trong nhãn vị trí của đoạn chứa nó,
     so theo giá trị, đọc theo cách viết số tiếng Việt (chấm ngăn hàng nghìn, phẩy thập phân).
6. Trả câu trả lời kèm trích dẫn: tên văn bản, nhãn vị trí lấy từ dữ liệu, câu nguyên văn. Ghi nhật ký câu hỏi vào
   bảng của Tầng 2 có `core.audit_attach` ([ADR 0009](0009-tamper-evident-audit-log.md)); dịch vụ ghi bằng vai trò
   CSDL riêng chỉ được thêm dòng và đặt `mortise.actor` bằng `sub` của token, để người dùng không tự tạo được dòng
   nhật ký qua GraphQL.

**Khi nào chuyển sang hàm SQL.** Khi thêm tìm bằng vector (pgvector), hoặc khi đo thấy thời gian đọc và xếp hạng các
đoạn được phép không còn nhỏ so với thời gian sinh.

**Kiểm thử (kế hoạch, cùng dịch vụ).** CI chạy đường ống với mô hình giả trả JSON soạn sẵn: trả lời đúng, bịa số, mã câu lạ, viết lại câu
trích, mô hình từ chối, quá giờ. Lệnh riêng `make assistant-eval` chạy bộ 22 câu của #114 với mô hình thật; kết quả
ghi vào tài liệu kèm cách đo và ngày đo.

## Hệ quả

- Câu trích luôn là nguyên văn đã nạp; số trong câu trả lời có căn cứ trong câu trích; quyền đọc văn bản do Hasura
  quyết định bằng token người hỏi, không do mô hình.
- Câu trả lời diễn đạt sai mà không có số vẫn lọt qua bước kiểm; số viết bằng chữ không kiểm được. Người đọc phải đối
  chiếu với câu trích hiện ngay dưới câu trả lời.
- Tìm theo từ khóa bỏ sót câu hỏi dùng từ khác văn bản; khi đó trợ lý từ chối thay vì trả lời sai.
- Mỗi câu trả lời mất hàng chục giây trên CPU và cần nhiều RAM (bảng trên); máy chủ không đủ RAM thì không bật profile
  `ai`.
- Chỉ lọc theo tenant; văn bản chỉ cho một số vai trò đọc là việc sau (#47).
- `make ai-up` cần mạng lần đầu để tải trọng số; volume `ollama` không nằm trong bản sao lưu vì tải lại được.
- Văn bản của gói phải là bản sạch chép từ bản gốc đã băm, có người đối chiếu; lỗi chép là lỗi của câu trích.

## Bổ sung ngày 2026-11-22 (#147): mô hình qua API tương thích OpenAI

Bối cảnh: máy chủ không đủ RAM cho Ollama (bảng trên) thì đơn vị không có trợ lý. Quyết định ở trên vẫn là mặc định:
mô hình chạy trên máy chủ của tổ chức. Bổ sung này cho người vận hành chọn, bằng cấu hình, gửi bước sinh tới một API
ngoài.

**Cấu hình.** `ASSISTANT_LLM_PROVIDER` trong `.env`: trống hay `ollama` là Ollama như trên; `openai-compatible` gọi
`POST {ASSISTANT_LLM_BASE_URL}/chat/completions` với khóa `ASSISTANT_LLM_API_KEY` ở header `Authorization: Bearer`,
mô hình `ASSISTANT_LLM_MODEL`, cùng JSON Schema ở `response_format` (`json_schema`, `strict`), nhiệt độ 0, `max_tokens`
bằng `ASSISTANT_NUM_PREDICT`, cùng thời gian chờ. `make env` không sinh khóa. Thiếu một trong ba biến, địa chỉ không
phải `http(s)://` hay tên nhà cung cấp lạ thì dịch vụ ghi lỗi vào log lúc khởi động và trả 503 chỉ biến cần sửa cho
mọi câu hỏi cần mô hình; không bao giờ tự chuyển sang nhà cung cấp khác, để câu hỏi không đi ra ngoài khi người vận
hành chưa chọn, và không lặng lẽ ở lại khi người vận hành tưởng đã chọn API. Các bước 1–3, 5, 6 không đổi: chỉ lời gọi
ở bước 4 khác, câu trả lời của cả hai qua cùng bước kiểm dạng, kiểm câu trích và kiểm số.

**Khi nào bật.** Chỉ khi đơn vị đã quyết định các văn bản được hỏi, và câu hỏi của cán bộ, được phép gửi cho bên cung
cấp API. Văn bản đã công bố công khai là trường hợp dễ quyết định nhất; văn bản nội bộ hay có dữ liệu cá nhân thì giữ
Ollama. Người vận hành bật API chịu trách nhiệm xác định việc gửi này phù hợp với quy định về dữ liệu cá nhân và điều
khoản của bên cung cấp API (lưu bao lâu, có dùng để huấn luyện không) mà đơn vị phải theo; dự án không đánh giá thay.

**Dữ liệu rời máy chủ**, mỗi câu hỏi tới được bước sinh:

- câu hỏi nguyên văn, kể cả điều người hỏi tự gõ vào;
- các câu của tối đa `ASSISTANT_TOP_PASSAGES` đoạn đã tìm, kèm mã câu, tên văn bản và nhãn vị trí (`prompt()` trong
  `model.py`);
- prompt hệ thống, JSON Schema, tên mô hình, khóa API.

Không gửi: token, `sub`, tenant hay tên người hỏi; đoạn ngoài quyền người hỏi; nhật ký câu hỏi. Câu hỏi bị từ chối vì
không có đoạn đủ gần (bước 3) không gửi gì. Trợ lý hỏi dữ liệu gửi mô tả bảng, cột của mục menu, không gửi dòng dữ
liệu; danh sách đầy đủ ở [ADR 0034](0034-model-written-guarded-graphql.md).

**Hiện cho người hỏi và ghi nhật ký.** Câu trả lời có `model` (tên, nhà cung cấp, `location`, `host`), null khi không
gọi mô hình; giao diện ghi "Trả lời bởi <mô hình>, chạy tại chỗ" hay "qua API <tên máy>". `location` theo nhà cung
cấp, không đoán theo địa chỉ: `openai-compatible` luôn là `api` kèm tên máy, kể cả khi máy chủ API nằm trong mạng của
đơn vị, vì dịch vụ không biết được mạng nào là "của đơn vị". Nhật ký câu hỏi thêm `model_provider` và `model_host`
(migration của Tầng 2); dòng ghi trước đó để trống.

Hệ quả của bổ sung:

- Mô hình qua API không ghim theo digest: bên cung cấp đổi mô hình sau cùng tên thì câu trả lời đổi mà không lệnh nào
  báo. Bước kiểm câu trích và số vẫn chạy, nên điều này làm đổi tỉ lệ từ chối chứ không làm lọt câu trích giả.
- Bảng đo ở trên chỉ áp dụng cho Qwen3.5 4B; mô hình qua API chưa được đo bằng bộ câu hỏi của #114.
- Vẫn một lượt sinh mỗi lúc: API không làm trợ lý trả lời được nhiều người cùng lúc hơn.
- Phụ thuộc đường ra mạng ngoài, phí và hạn mức của bên cung cấp; giới hạn tần suất (429) là 503 "thử lại sau".
- Máy chủ chỉ nhận `max_completion_tokens` thay vì `max_tokens` thì trả lỗi 400; dịch vụ trả 502 và ghi lý do vào
  log. Đã kiểm bằng máy chủ giả trong `make test`, chưa có kiểm thử tự động với API thật.
