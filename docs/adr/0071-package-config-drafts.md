<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0071. Bản nháp cấu hình gói: mô hình soạn từ tài liệu nền tảng và contracts/, dịch vụ kiểm, không tự cài

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Một gói chỉ gồm tệp khai báo ([ADR 0022](0022-declarative-packages.md)): `app.yaml` khai menu và khối ([ADR
0061](0061-block-composition.md)), mỗi mục trỏ tới một thành phần Tầng 2 và một tệp cấu hình viết theo
`contracts/<thành phần>.schema.json`. Người dựng hệ thống phải biết có những thành phần nào, mỗi thành phần làm được
gì và nhận cấu hình ra sao; bản mô tả (`*.component.yaml`, [ADR 0013](0013-component-config-contracts.md)) và ví dụ
trong `contracts/` có sẵn điều đó. Issue #117 (epic #47) cần trợ lý soạn bản nháp cấu hình từ nhu cầu gõ tự do, giải
thích chọn thành phần nào, kiểm theo schema trước khi trả, không tự cài; nguồn tri thức là tài liệu nền tảng và
`contracts/`; demo là soạn cấu hình cho gói thứ hai. Epic #47 cần mỗi câu hỏi có nhật ký và kết quả đo ghi trong tài
liệu kèm cách đo, ngày đo.

Đo ngày 2026-11-26 trên máy phát triển (16 nhân CPU, không GPU) với mô hình ghim `qwen3.5:4b` qua Ollama, với prompt
bản đầu (chỉ `contracts/`, khoảng 28.000 ký tự, 7.712 token): đọc prompt 158,5 giây, sinh app.yaml và năm tệp cấu hình
(1.361 token) 155,7 giây, tổng 317 giây, quá hạn 150 giây của dịch vụ và 200 giây của cổng; 2 trong 6 tệp qua schema.
Không đặt `num_ctx` thì Ollama cắt prompt đó còn 2.050 token mà không báo lỗi. Đo bằng dòng log mỗi lời gọi mô hình
của dịch vụ (`assistant.model`) và trường thời gian của phản hồi Ollama.

## Quyết định

- **Đường mới `POST /v1/assistant/package-drafts`**, nhận `need` (tối đa `ASSISTANT_MAX_QUESTION_CHARS` ký tự), trả
  `outcome` (`drafted`, `invalid`, `refused`), các tệp (đường dẫn, thành phần, nội dung YAML đúng chữ mô hình viết),
  lỗi còn lại, tệp còn phải viết và lập luận chọn thành phần. Dịch vụ không ghi vào `apps/`: quản trị viên tự xem, tự
  đặt vào `apps/<gói>/`, tự `make app-install`.
- **Chỉ quản trị đơn vị** (vai trò `tenant_admin` trong token) gọi được; người khác nhận 403 trước khi mô hình chạy.
  Sửa cấu hình hệ thống là việc cần quản trị viên chấp nhận, và mỗi lần gọi tốn lượt của mô hình.
- **Nguồn tri thức là tài liệu nền tảng và `contracts/` của bản đang chạy**, gắn chỉ đọc vào container
  (`ASSISTANT_CONTRACTS_DIR`, `ASSISTANT_PACKAGE_GUIDE`), không chép vào image. Tài liệu nền tảng là
  [docs/packages.md](../packages.md): tệp của một gói nối với nhau thế nào, chữ nào cho máy, chữ nào cho người, kiểm
  và cài ra sao; người viết gói đọc cùng tệp đó. Thành phần được đề xuất là thành phần vừa có `*.component.yaml` vừa
  có trong danh sách `menu[].component` của `app.schema.json`, dò lúc đọc; thành phần mới có bản mô tả thì tự có mặt.
  Prompt gồm tài liệu nền tảng, tóm tắt, từng câu `capabilities` và `limits` có mã (`catalog.c2`, `map.l1`), ví dụ cấu
  hình của từng thành phần và `app.example.yaml`. Không đưa gói trong `apps/` vào prompt, để mô hình soạn theo nhu cầu
  thay vì chép gói có sẵn. Nhu cầu nằm giữa hai dòng đánh dấu, là dữ liệu chứ không phải chỉ dẫn, như [ADR
  0034](0034-model-written-guarded-graphql.md).
- **Chữ cho máy không dấu, chữ cho người có dấu.** Prompt nêu lý do của từng loại theo mục "Chữ cho máy và chữ cho
  người" của tài liệu nền tảng: id, đường dẫn, bảng, cột, khóa quy trình nằm trong đường dẫn, câu truy vấn và CSDL nên
  là ASCII; `name`, `description`, `label`, `title`, `message` hiện trên màn hình nên là tiếng Việt chuẩn có dấu. Bản
  đầu của prompt chỉ đưa ví dụ không dấu, và mô hình viết cả tên gói không dấu.
- **Mỗi tệp là chuỗi YAML trong JSON** `{answerable, files[{path, content}], choices[{item, arguments}], reason}`: chế
  độ strict của API tương thích OpenAI không nhận đối tượng có khóa tự do.
- **Kiểm theo luật của bộ kiểm gói (`scripts/contracts.sh package`) áp được cho một gói chỉ gồm app.yaml và cấu hình
  thành phần:** `app.yaml` theo `app.schema.json`; mỗi tệp theo schema của thành phần mà mục menu hay khối trỏ tới nó
  khai, không theo tên thư mục; khóa trùng là lỗi như check-jsonschema; `id` của menu và khối không trùng như
  `scripts/app-deploy.py`; khối trên trang trỏ tới mục có thật, đúng kiểu như `scripts/check-page-config.py`; mỗi mục
  có đúng tệp của nó, không tệp thừa, đường dẫn nằm trong gói. Dịch vụ ghim `jsonschema` 4.26.0, cùng bản
  `check-jsonschema` 0.29.4 dùng, và PyYAML 6.0.3 như các script. Kiểm thử đối chiếu với ví dụ đúng và sai của
  `contracts/` (đúng từng chữ của `expected-errors.txt`), với gói sai của bộ kiểm gói và với chính
  `check-page-config.py`. Kiểm chéo với BPMN, bảng, quyền Hasura không làm vì bản nháp chưa có những phần đó.
- **Tệp app.yaml khai mà bản nháp không viết** (`workflows`, `rules`, `knowledge`, `authorities`) không phải lỗi:
  chúng vào `to_write`, danh sách tệp còn phải viết trước khi cài. Coi là lỗi thì cách sửa ngắn nhất là bỏ quy trình
  khỏi app.yaml, và biểu mẫu khởi tạo quy trình mất chỗ dựa.
- **Sửa tối đa một lần, một hạn chung** (`ASSISTANT_TIMEOUT_SECONDS`), như ADR 0034: lượt sửa nhận lại bản nháp và
  đúng các lỗi khi kiểm. Vẫn lỗi, hết giờ trong lượt sửa, hay lượt sửa nói không soạn được thì trả bản nháp còn lỗi
  (`invalid`, mã 200). Trần token sinh riêng `ASSISTANT_DRAFT_NUM_PREDICT` (4.000); hết trần thì lời báo chỉ đúng biến
  này. Với Ollama, `ASSISTANT_DRAFT_NUM_CTX` đặt cửa sổ ngữ cảnh đủ cho prompt của lượt sửa cộng trần token sinh, để
  prompt không bị cắt lặng lẽ.
- **Lập luận chọn thành phần nối nhu cầu với công dụng.** Mỗi mục có một tới ba lập luận: `need` là đoạn mô hình chép
  từ nhu cầu, dịch vụ kiểm có trong nhu cầu (sau khi bỏ khác biệt về dạng Unicode, hoa thường, khoảng trắng, dấu câu ở
  hai đầu); `capability` là câu chép nguyên văn từ bản mô tả của thành phần mà `app.yaml` khai cho mục đó, theo mã mô
  hình chỉ ra; `why` là câu mô hình viết, nói công dụng đó đáp ứng đoạn nhu cầu thế nào. Lập luận có đoạn nhu cầu
  không có thật hay mã không có thì bị bỏ. `why` không kiểm được và có thể sai (demo có câu nói "thêm mặt hàng" khi
  cấu hình chỉ có nút sửa); phản hồi và tài liệu API ghi rõ điều đó. Bản đầu chỉ trả câu chép từ hợp đồng: đúng nhưng
  không nói vì sao câu đó hợp với nhu cầu.
- **Nhật ký mỗi lần soạn** ở `platform.assistant_package_drafts` (migration riêng của Tầng 2): người gọi, nhu cầu,
  `outcome` (thêm `failed` khi lỗi từ 500 trở lên chặn trả lời), lý do, đường dẫn tệp, số lỗi, mô hình theo cấu hình,
  số lượt, thời gian; không lưu nội dung tệp. Yêu cầu bị chặn trước khi mô hình chạy (403, 400) không ghi. Không ghi
  được dòng thì trả 503, không trả bản nháp, như hỏi văn bản và hỏi dữ liệu. Bảng `platform.assistant_questions` không
  dùng lại được: nó bắt buộc cột `app` và chỉ nhận `answered`, `refused`, `failed`. Chỉ `tenant_admin` đọc qua Hasura,
  lọc theo tenant; bảng gắn `core.audit_attach` ([ADR 0009](0009-tamper-evident-audit-log.md)).
- **Dùng mô hình qua API, theo quyết định của người phụ trách dự án**, khác chữ "tại chỗ" của epic #47: với mô hình
  tại chỗ đã ghim, một bản nháp vượt hạn hơn hai lần (số đo ở trên), và không nới hạn chung vì mỗi lượt sinh giữ chỗ
  của mọi người hỏi khác. Đường này vẫn chạy với Ollama khi người vận hành chọn.

## Hệ quả

- Quản trị đơn vị có điểm khởi đầu đúng hợp đồng cho gói mới thay vì viết tay từ đầu. Demo trên gói thứ hai
  (`apps/supplies-commune`) ngày 2026-11-28: bản nháp qua bước kiểm sau một lượt sửa, đáp ứng đủ hai, một phần hai
  trong sáu việc của nhu cầu: bước kiểm bắt sai hợp đồng, không bắt được việc thiếu; số đo, cách đo và so sánh với gói
  thật ở [docs/assistant-eval/](../assistant-eval/2026-11-28-package-draft-gemini-3.5-flash-lite.md).
- Bản nháp chưa cài được ngay: thiếu migration, quyền Hasura, BPMN, văn bản. `make check-fast` sau khi bổ sung các
  phần đó vẫn là bước kiểm cuối.
- Nhu cầu, tài liệu nền tảng và bản mô tả thành phần được gửi tới API mô hình khi cấu hình API; không gửi dữ liệu nào
  của đơn vị.
- Prompt dài hơn bản đầu (tài liệu nền tảng, lập luận): 13.767 token vào ở lượt đầu, 16.449 ở lượt sửa với
  `gemini-3.5-flash-lite`; 13.039 token với `qwen3.5:4b`, đọc mất 283,7 giây trên máy phát triển (đo 2026-11-28), nên
  mô hình tại chỗ càng không kịp hạn. `ASSISTANT_DRAFT_NUM_CTX` là 24.576 cho đủ lượt sửa.
- Chưa có giao diện cho đường này, và trợ lý chưa soạn migration, quyền Hasura hay BPMN; cả hai ngoài phạm vi #117.
