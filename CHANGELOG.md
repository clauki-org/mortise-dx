<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added

- Truy vết phân tán, mặc định tắt: `MORTISE_TRACING=on` cùng `make obs-up` cho xem trong Grafana từng chặng của một
  yêu cầu qua cổng tới dịch vụ tự viết, Flowable, Scorpio, CSDL (Jaeger, không lưu chuỗi truy vấn hay header;
  [ADR 0038](docs/adr/0038-distributed-tracing.md)).
- `make deps-check`: kiểm image và thư viện được ghim đúng phiên bản, giấy phép nằm trong danh sách cho phép, báo bản
  mới mà không tự nâng cấp; `make check-fast` chặn ghim hay giấy phép sai; workflow hằng tuần đăng báo cáo vào issue
  theo dõi (đã cấu hình, chưa chạy) ([ADR 0039](docs/adr/0039-dependency-check-script.md)). Image Python của các
  dịch vụ tự viết ghim `3.13.18`, công cụ kiểm chạy qua `uvx` ghim phiên bản.
- Chính sách đăng nhập theo tenant: `make tenant-login TENANT=<tenant> POLICY=otp|default` bắt mọi tài khoản của một
  tenant nhập OTP hoặc bỏ yêu cầu đó; tenant demo `tinh-khac` bắt buộc OTP, có thêm `user.k` (ADR 0040).
- Giấy tờ đính kèm trên màn hình chi tiết của danh mục: xem, tải về, đính kèm tệp qua API tệp của lõi; tệp nhiễm mã độc
  bị từ chối bằng lời báo tiếng Việt. Gói cơ sở vật chất xã đính kèm giấy tờ vào cơ sở
  ([ADR 0041](docs/adr/0041-documents-on-catalog-records.md)).
- Đăng nhập bằng Passkey cho tenant được bật (`make tenant-login TENANT=<tenant> POLICY=passkey`): nút "Thêm Passkey"
  trên giao diện, trang đăng nhập có lựa chọn Passkey thay mật khẩu, ai phải nhập OTP vẫn nhập; tenant demo `xa-c`
  (ADR 0042).
- Giao diện dùng chung một bộ cỡ chữ, khoảng cách, màu đạt tương phản WCAG AA (màu chính mặc định đổi sang xanh
  dương); tên, logo, màu theo bản cài trong `branding.json`, ghi đè bằng `MORTISE_BRANDING_DIR` không cần dựng lại
  image ([ADR 0043](docs/adr/0043-design-tokens-and-install-branding.md)).
- Menu bên chia nhóm theo gói, mỗi mục có biểu tượng, nhóm mẫu thử của lõi thu gọn ở cuối; thanh trên ghi đơn vị và
  người dùng; dùng được trên điện thoại. Bản cài cũ chạy `make seed` và cài lại các gói để menu có tên nhóm và biểu
  tượng ([ADR 0044](docs/adr/0044-menu-groups-and-icons.md)).
- Danh mục có nhãn trạng thái màu theo `tone` của gói, công tắc Bảng/Thẻ và trang chi tiết dạng lưới ô; trường biểu
  mẫu có dòng gợi ý `help` ([ADR 0050](docs/adr/0050-catalog-tones-cards-form-help.md)).
- Danh sách của thành phần danh mục xuất được ra CSV, Excel và PDF: mọi dòng khớp tìm, lọc đang xem, bằng quyền của
  người xuất, đầu tệp ghi nguồn, đơn vị, thời điểm và người xuất ([ADR 0052](docs/adr/0052-catalog-export.md)).
- Hồ sơ của quy trình khai niêm phong được băm khi kết thúc; `/instances/{id}`, `/cases/{id}` trả mã băm và thời điểm,
  `make seal-verify` báo hồ sơ bị sửa lén; lõi ghi hạn của bước chờ hẹn giờ ([ADR
  0053](docs/adr/0053-case-seals-and-timer-deadlines.md)).
- Trường tùy chỉnh (phần CSDL và API): quản trị org định nghĩa trường chữ, số, ngày, lựa chọn cho bảng của gói; CSDL
  từ chối khóa lạ, sai kiểu, thiếu trường bắt buộc ([ADR 0059](docs/adr/0059-custom-fields.md)).
- Quản trị org đổi nhãn, ẩn hiện, thứ tự cột, trường, khối và ngưỡng thẻ số cho cả org; cài lại gói vẫn giữ, xóa phần
  chỉnh là về mặc định ([ADR 0060](docs/adr/0060-config-overrides.md)).
- Trang "Ứng dụng" cho quản trị org: bật, tắt từng gói cho cả org bằng một nút; tắt thì menu, trang chủ và khối của
  gói ẩn ở mọi đơn vị, dữ liệu giữ nguyên; gói đang được gói khác cần thì không tắt được ([ADR
  0065](docs/adr/0065-package-on-off.md)).
- Trang gồm khối: gói khai khối và trang trong `app.yaml`, mỗi thành phần có kiểu trình bày; trang Tổng quan của gói
  cơ sở vật chất xã ([ADR 0061](docs/adr/0061-block-composition.md)).
- Danh mục có thêm kiểu Kanban (cột theo trường trạng thái, chuyển thẻ bằng kéo thả hay nút "Chuyển sang", có so phiên
  bản) và Lịch (tháng, tuần theo trường ngày); gói cơ sở vật chất xã dùng cả hai ([ADR
  0066](docs/adr/0066-catalog-kanban-and-calendar.md)).
- Bộ biến giao diện theo bản cài trong `branding.json`: màu phụ, bo góc, phông, nền trang; màu tự khai bằng mười sắc
  độ, tệp dưới AA bị bỏ ([ADR 0063](docs/adr/0063-install-theme-tokens.md)).
- Gói vận hành hiện trường `field-ops`: khách hàng, điểm lắp đặt trên bản đồ, thiết bị, phiếu công việc có ảnh và biên
  bản, nghiệm thu bốn mắt, sản lượng thấp mở hồ sơ sửa chữa, bảng điều hành; hàm `platform.row_version_attach` ([ADR
  0067](docs/adr/0067-field-operations-package.md)).
- Bảng con của danh mục có nút "Nạp từ tệp": tải tệp mẫu .xlsx, chọn tệp Excel hay CSV, xem trước lỗi theo dòng và cột
  rồi thêm mọi dòng trong một lần; gói xã nạp phòng vào một tòa ([ADR
  0064](docs/adr/0064-import-child-rows-from-file.md)).
- `make assistant-eval` đo trợ lý hỏi văn bản trên bộ câu hỏi có đáp án của gói: trích đúng, từ chối đúng, độ trễ;
  lượt đầu 2026-11-28 ghi ở [docs/assistant-eval.md](docs/assistant-eval.md).

### Changed

- Bảng điều hành: số chính nổi bật ở khối chính, cách tính và nguồn thu gọn trong "Xem cách tính", biểu đồ ghi số trên
  từng thanh, số 0 vẫn hiện; mô tả khối bằng lời người xem, `make check-fast` chặn tên bảng, cột trong chữ người xem
  thấy ([ADR 0045](docs/adr/0045-readable-dashboard.md)).
- Mọi trang báo đang tải, rỗng, lỗi cùng một kiểu bằng lời tiếng Việt kèm cách sửa và nút Thử lại; lý do do máy chủ
  viết (ví dụ quy tắc bốn mắt, tệp chứa mã độc) giữ nguyên, chi tiết kỹ thuật thu gọn ([ADR
  0046](docs/adr/0046-shared-ui-states.md)).
- Các trang dùng chung đầu trang, nhãn trạng thái, định dạng ngày giờ; bảng cuộn ngang được trên điện thoại, nút việc
  chính nổi bật; câu truy vấn của trợ lý dữ liệu nằm sau nút "Xem câu truy vấn" ([ADR
  0047](docs/adr/0047-page-header-status-badge-formatting.md)).
- Giao diện kiểu Bento dịu: nền xám nhạt, thẻ viền mảnh bo 12px, ô nhập viền rõ, liên kết gạch chân, phông Be Vietnam
  Pro đóng gói cùng giao diện; nhãn trạng thái dùng một bộ nghĩa màu chung ([ADR
  0048](docs/adr/0048-bento-tokens-status-tones-font.md)).
- Bảng điều hành xếp lưới bốn cột theo thứ tự khai; khối chính có vòng đo phần trăm do gói tính, thẻ số có màu và chữ
  mức độ theo ngưỡng của gói, biểu đồ có trần ([ADR 0049](docs/adr/0049-bento-dashboard.md)).
- Trang chủ sau khi đăng nhập: một ô lối tắt cho mỗi gói và việc đang chờ dạng liên kết; menu có "Trang chủ" đầu nhóm
  "Chung" ([ADR 0051](docs/adr/0051-home-page.md)).
- Gói cơ sở vật chất xã có mục "Hỏi văn bản": trả lời về rà soát trụ sở bằng câu trích nguyên văn Điều 3 NĐ 155/2025
  và Điều 3a, 3b do NĐ 369/2026 bổ sung; khoản đã sửa hay bãi bỏ không được trích ([ADR
  0021](docs/adr/0021-document-assistant.md)).
- Sửa cơ sở, tòa, phòng và thêm tòa, phòng ngay trên màn hình danh mục; hai người sửa cùng lúc thì người lưu sau được
  báo, không ghi đè ([ADR 0054](docs/adr/0054-edit-and-add-child-from-catalog.md)).
- Bản đồ có nền OpenStreetMap tự lưu trữ (`make basemap`), mặc định không chữ, luôn ghi nguồn ODbL; chưa có tệp nền
  thì nền trơn ([ADR 0056](docs/adr/0056-self-hosted-osm-basemap.md)).
- Bản đồ trụ sở demo: ranh giới, tên ba xã tự vẽ trên nền bản đồ, trụ sở nằm trong ranh giới, ghi rõ là hư cấu ([ADR
  0020](docs/adr/0020-facility-locations.md)).
- `make app-install` kiểm gói bằng đúng bộ kiểm của `make check-fast` (`scripts/contracts.sh package`) và dừng trước
  khi đụng CSDL nếu cấu hình sai; `make app-check APP=<gói>` chỉ kiểm.
- Gói kho vật tư xã thành gói Kho dùng chung: phiếu nhập, phiếu xuất, tồn kho tính trong CSDL, CSDL chặn xuất quá tồn;
  có dữ liệu demo cho doanh nghiệp ([ADR 0062](docs/adr/0062-shared-warehouse-package.md)).

### Removed

- `component: documents` không còn là giá trị của mục menu trong `app.yaml`: tài liệu đính kèm là một phần của màn
  hình chi tiết danh mục, không có trang menu riêng (ADR 0041). Nâng cấp: gói đã khai mục menu `component: documents`
  chuyển cấu hình đó vào `detail.documents` của cấu hình danh mục.

### Fixed

- Cổng trả lỗi 429 (vượt giới hạn tần suất) của mọi API dưới `/v1` dạng JSON `{"error": "..."}` như lỗi 401,
  thay vì trang HTML; header `X-RateLimit-*` vẫn giữ.
- Chữ gợi ý trong ô nhập đạt tương phản AA; hộp thoại không còn tạo vùng banner thứ hai; menu gập trên điện thoại
  không còn nhận Tab. `make e2e` chặn lỗi trợ năng mức nghiêm trọng trên các trang của kịch bản demo và có bài đi kịch
  bản bằng bàn phím.
- Nút bỏ tệp đã chọn ở ô chọn tệp (đính kèm giấy tờ, nạp từ tệp) có tên cho trình đọc màn hình.

## [0.1.0] - 2026-11-25

Bản phát hành đầu tiên: lõi Tầng 1, các thành phần dùng chung Tầng 2 và hai gói minh họa, chạy bằng Docker Compose.

- **Lõi:** đăng nhập một lần (Keycloak) với OTP cho người duyệt; một cổng API (APISIX); API dữ liệu GraphQL
  (Hasura) cách ly theo tenant; quy trình BPMN (Flowable sau workflow-api) có bốn mắt, bảng phân cấp thẩm quyền và
  tenant cha duyệt bước được phân cấp; tệp có quét mã độc; dữ liệu thiết bị qua MQTT và NGSI-LD, số đo vượt ngưỡng
  tự mở hồ sơ; nhật ký thay đổi có chuỗi băm và kho lạnh.
- **Vận hành:** sao lưu, khôi phục và diễn tập trên máy trắng; dịch vụ tự dựng lại khi tiến trình thoát; giám sát
  (Prometheus, Loki, Grafana) trong profile riêng; phát hành theo tag, máy chủ tự kéo bản mới.
- **Thành phần dùng chung:** giao diện web với menu theo gói, danh mục, biểu mẫu, bảng việc, theo dõi hồ sơ, bản đồ,
  bảng điều hành; trợ lý hỏi văn bản và hỏi dữ liệu (câu GraphQL chỉ đọc qua guard, mô hình tại chỗ hay qua API).
- **Gói minh họa:** `facilities-commune` (cơ sở vật chất xã: diện tích theo định mức, rà soát, tổng hợp cho tỉnh) và
  `supplies-commune` (kho vật tư xã, chỉ gồm tệp khai báo).

Chạy từ mã nguồn: `make up && make seed && make smoke` (README). Máy chủ chạy image của bản này: `deploy/README.md`.

### Added

- Giám sát trong profile `observability` (ADR 0037): `make obs-up` chạy Prometheus, Loki, Alloy, blackbox và Grafana
  chỉ ở `127.0.0.1:3000` (tài khoản `admin`, mật khẩu `GRAFANA_ADMIN_PASSWORD`) với dashboard "Mortise: tổng quan";
  `make obs-check` kiểm, `make obs-down` dừng mà giữ số liệu và log. APISIX và Keycloak xuất số liệu ở cổng nội bộ.
- Phát hành theo tag (ADR 0036): tag `vX.Y.Z` trên main chạy lại CI, đẩy image tám dịch vụ tự viết lên
  `ghcr.io/clauki-org/mortise-dx/<dịch vụ>:<tag>`, kéo lại không đăng nhập để smoke, rồi tạo GitHub Release kèm gói
  `mortise-dx-<tag>.tar.gz` và `SHA256SUMS`. `MORTISE_NO_BUILD=1` cấm dựng image tại chỗ.
- Máy chủ demo tự kéo Release mới (`deploy/pull-deploy.sh`, systemd timer): sao lưu, dựng, smoke, lỗi thì quay về tag
  trước; CSDL không tự khôi phục (`deploy/README.md`).
- `make heal-check SERVICE=<dịch vụ>` kiểm dịch vụ có tiến trình chính thoát được Docker dựng lại; `make restore-drill
  CONFIRM=yes` diễn tập khôi phục trên máy trắng và đo thời gian từng giai đoạn (`docs/restore-drill.md`).
- Bảng điều hành đọc số hồ sơ và số đo thiết bị (ADR 0035): `GET /v1/workflow/processes/{key}/counts` đếm hồ sơ của
  một quy trình trong tenant, chỉ cho người có vai trò của một bước; nguồn `workflow` và `context` của thành phần bảng
  điều hành. Gói `facilities-commune` có khối hồ sơ rà soát, việc đang chờ và độ ẩm thiết bị.
- Trợ lý hỏi dữ liệu nhận câu hỏi gõ tự do (ADR 0034, `POST /v1/assistant/data-questions`): mô hình viết câu GraphQL
  chỉ đọc từ mô tả bảng, cột, không thấy dòng dữ liệu; câu qua cùng guard với câu mẫu, bị từ chối thì viết lại một
  lần, rồi chạy bằng token người hỏi.
- Thành phần theo dõi hồ sơ `cases` (ADR 0032, `GET /v1/workflow/cases`, `GET /v1/workflow/cases/{id}`): người lập
  thấy hồ sơ mình đã lập, bước đang chờ, các bước đã qua và kết quả, không thấy ý kiến hay danh tính người xử lý.
- Thành phần bảng điều hành (ADR 0033, `contracts/dashboard.schema.json`): thẻ số và biểu đồ cột ngang đọc cột do gói
  tính sẵn qua GraphQL bằng token người xem, mỗi số kèm cách tính và câu truy vấn đã gửi, biểu đồ kèm bảng số liệu.
  Gói `facilities-commune` có "Bảng điều hành" cho xã và tỉnh.
- Thành phần biểu mẫu (ADR 0030, `contracts/form.schema.json`): gói khai trường và danh sách chọn, rồi khởi tạo quy
  trình (Idempotency-Key) hay thêm một dòng vào bảng của gói; `make check-fast` kiểm biểu mẫu với BPMN và quyền Hasura
  của gói.
- Tenant cha hoàn thành bước thuộc thẩm quyền của mình trong hồ sơ tenant con (ADR 0029): với dòng `scope: parent` của
  bảng phân cấp, workflow-api gán bước cho `<tenant cha>/<vai trò>`, luôn cần OTP; các bước khác vẫn 404 với tenant
  cha. Tenant demo `tinh-khac` với `manager.k`.
- Quy trình rà soát của `facilities-commune` có bước "Quyết định của người có thẩm quyền" (`decide`): vai trò lấy từ
  bảng phân cấp của xã, cần OTP; phần vượt trên 1000 m² (ngưỡng minh họa) thì bước thuộc tỉnh.
- Bảng phân cấp thẩm quyền theo tenant (ADR 0028, `core.step_authorities`): bước có `candidateGroups` là
  `${authority_<bước>}` nhận vai trò do workflow-api chọn lúc khởi tạo theo ngưỡng của hồ sơ; quản trị tenant cha
  (`admin.tinh`) sửa bảng của tenant con; gói khai dòng mặc định ở `authorities` của app.yaml.
- Keycloak hỏi OTP người có vai trò `otp_required` của client `mortise-web`; `manager` gộp vai trò này (ADR 0011, bổ
  sung). Tài khoản demo `admin2.a`.
- Trợ lý chọn nhà cung cấp mô hình qua cấu hình (ADR 0021, bổ sung): mặc định Ollama tại chỗ,
  `ASSISTANT_LLM_PROVIDER=openai-compatible` gọi một API tương thích OpenAI; câu trả lời và nhật ký ghi mô hình và nơi
  chạy.
- Trợ lý hỏi dữ liệu (ADR 0027, `POST /v1/assistant/data-queries`): câu mẫu của gói chạy câu GraphQL chỉ đọc bằng
  token người hỏi sau guard trên cây cú pháp (một query, chỉ bảng, cột đã khai, có limit, không introspection); kết
  quả là bảng kèm câu đã chạy, nhật ký ghi câu và số dòng.
- Gói thứ hai `supplies-commune` (kho vật tư xã), chỉ gồm tệp khai báo: kho và vật tư theo xã, đề nghị cấp vật tư cho
  người duyệt của xã, dữ liệu demo hư cấu nạp bằng `make seed-demo`.
- Lập hồ sơ từ một dòng danh mục (ADR 0026): nút `detail.actions` khởi tạo quy trình của gói với biến lấy từ dòng đang
  xem, kèm xác nhận và Idempotency-Key. Gói `facilities-commune` có nút "Lập hồ sơ rà soát".
- Thành phần bản đồ (ADR 0024, `contracts/map.schema.json`): lớp điểm đọc qua GraphQL theo cấu hình của gói, nền trơn
  không tải tile, tô màu theo bậc, chú giải và danh sách điểm. Gói `facilities-commune` có bản đồ trụ sở tô theo phần
  vượt của xã.
- Trợ lý hỏi văn bản (ADR 0021, `POST /v1/assistant/questions`): tìm đoạn bằng token người hỏi, hỏi Qwen3.5 4B qua
  Ollama, chỉ trả lời khi mọi câu trích và con số có trong đoạn đã tìm, không thì từ chối có lý do. Giao diện hiện
  từng câu trích kèm tên văn bản và vị trí.
- Nhật ký câu hỏi của trợ lý (ADR 0021, `platform.assistant_questions`): dịch vụ chỉ được thêm dòng, không ghi được
  thì không trả lời; `tenant_admin` đọc nhật ký của tenant mình.
- Văn bản cho trợ lý (ADR 0021): bộ cài gói nạp mục `knowledge` của app.yaml vào `platform.knowledge_documents` và
  `platform.knowledge_passages`, có nhật ký; mỗi người chỉ đọc bản của tenant mình.
- Profile `ai` (ADR 0021): `make ai-up` chạy Ollama 0.40.16, tải Qwen3.5 4B và dừng nếu trọng số khác digest ghim
  trong `core/ollama/models.txt`.
- Gói chỉ gồm tệp khai báo (ADR 0022): `make check-fast` kiểm gói trong `DECLARATIVE_APPS` không có tệp mã; `make
  seed-demo` nạp `seed/demo.yaml` bằng bộ nạp chung.
- Quy trình rà soát của `facilities-commune`: bốn mắt; phần vượt trên ngưỡng thì công khai một thời hạn rồi trình
  người có thẩm quyền. Ngưỡng và thời hạn là `settings` của gói, ghi đè bằng `make app-install SETTINGS=...` (ADR
  0019).
- Tọa độ cơ sở trong `facilities-commune` (ADR 0020): cột `latitude`, `longitude` (WGS 84) có kiểm miền giá trị; view
  `facility_rollup` cho `leader.tinh` thấy trụ sở đang dùng của các xã kèm phần vượt mà không đọc bảng gốc.
- `make archive` xóa đoạn nhật ký đã lưu trữ khỏi CSDL trong cùng giao dịch ghi nhận đoạn; chuỗi băm nối qua phần đã
  xóa, `make audit-verify` và `make cold-verify` kiểm cả phần đó.
- Menu của giao diện dựng từ các gói đã cài; mục của gói mở thành phần danh mục theo cấu hình tại `/apps/<gói>/<mục>`.
- Gói `facilities-commune` mở việc "Kiểm tra kho lưu trữ" khi độ ẩm kho vượt 75% liên tục 5 phút (ngưỡng minh họa);
  `/v1/context/temporal/entities/{id}` đọc lịch sử số đo.
- Luật ngưỡng (`contracts/threshold-rule.schema.json`): số đo vượt ngưỡng liên tục đủ lâu thì iot-bridge mở quy trình
  cho tenant của thiết bị, không mở thêm khi hồ sơ cũ còn mở; gói khai luật ở mục `rules` của app.yaml.
- Tài khoản dịch vụ cho workflow-api (ADR 0017): client `mortise-iot-bridge` (client credentials) chỉ được khởi tạo
  quy trình thay cho tenant ghi ở `X-Mortise-Tenant` (`contracts/service-token-claims.schema.json`).
- Tenant cha (ADR 0016): `core.tenants.parent_id` và vai trò `rollup_reader`; `leader.tinh` của `tinh-mau` thấy diện
  tích tổng hợp của ba xã (view `area_rollup`) mà không đọc được cơ sở, tòa, phòng.
- Phân công cán bộ theo cơ sở trong `facilities-commune` (ADR 0015): cán bộ chỉ thấy và sửa cơ sở được phân công,
  `manager` đọc toàn xã, `tenant_admin` tạo cơ sở và sửa phân công.
- Gói `facilities-commune` tính diện tích được phép và phần vượt tiêu chuẩn, định mức của từng xã theo NĐ 155/2025 sửa
  bởi NĐ 369/2026 (view `area_summary`), mức m² có trích dẫn.
- `make app-install` nạp cả quy trình BPMN, khai báo bước và menu của gói cho mọi xã; `make app-uninstall` xóa chúng,
  kể cả hồ sơ đang chạy.
- `make seed-demo`: dữ liệu demo hư cấu của ba xã cho `facilities-commune`, nạp qua cổng bằng tài khoản từng xã, chạy
  lại không tạo bản trùng.
- Khung giao diện Tầng 2 tại `/` (`platform/web/`, React, Mantine): đăng nhập Authorization Code + PKCE qua Keycloak,
  tự làm mới token; nginx phục vụ kèm Content-Security-Policy; `make web-check`.
- Trang "Việc của tôi": việc đang chờ người đăng nhập, gần hạn đứng đầu, lọc theo hạn, hiện tên hồ sơ, người gửi và
  hạn. Màn hình xử lý một việc hiện thông tin hồ sơ, biểu mẫu và nút quyết định theo khai báo của bước.
- Thành phần danh mục (ADR 0013, `contracts/catalog.schema.json`): danh sách có tìm, lọc, sắp xếp, phân trang và chi
  tiết có đối tượng con nhiều cấp theo cấu hình của gói; gói `facilities-commune` khai danh mục cơ sở → tòa → phòng.
- Khai báo bước của quy trình (`contracts/workflow.schema.json`, bảng `platform.workflow_steps`): biểu mẫu, nút quyết
  định và hồ sơ liên quan của từng bước; `make check-fast` kiểm mọi userTask có khai báo.
- Task của API quy trình có `process`, `step`, `due`; khởi tạo quy trình nhận `Idempotency-Key`, gửi lặp không tạo quy
  trình thứ hai.
- Gói Tầng 3 đầu tiên `apps/facilities-commune`: bảng cơ sở → tòa → phòng theo tenant, có nhật ký; `make app-install`,
  `make app-uninstall CONFIRM=yes`, `make app-status`, `make app-smoke`. Gỡ gói thì lõi vẫn qua smoke.
- Hợp đồng API giữa các tầng trong `contracts/` (ADR 0008): JSON Schema cho claim token và `app.yaml`, OpenAPI của
  workflow-api; `make check-fast` báo lỗi khi lệch, `make smoke` kiểm token thật.
- Lược đồ CSDL của lõi quản lý bằng migration dbmate: `make up` áp migration chưa chạy; `make migrate-new`, `make
  migrate-status`.
- Đăng nhập hai bước cho người duyệt (ADR 0011): vai trò `manager` nhập mã OTP, token có claim `amr`, workflow-api từ
  chối duyệt khi token không có bước OTP; `make otp` cho tài khoản demo.
- Nhật ký thay đổi `core.audit_log` (ADR 0009): ai sửa gì, lúc nào, trước và sau; chuỗi băm phát hiện sửa lén, `make
  audit-verify` chỉ ra chỗ bị sửa, `make restore` đối chiếu băm cuối trong bản sao lưu.
- Kho lạnh cho nhật ký (ADR 0014): `make archive BEFORE=<ngày>` xuất dòng cũ sang Parquet trên SeaweedFS có kiểm băm
  từng dòng; `make cold-query SQL=…` truy vấn gộp bằng DuckDB.
- API tệp `/v1/files` (files-api trước SeaweedFS): tải lên, xem, tải xuống theo tenant; giới hạn cỡ, băm SHA-256,
  thông tin tệp trong `core.files`.
- Quét mã độc tệp tải lên bằng ClamAV trước khi lưu (ADR 0010): tệp nhiễm trả 422 kèm tên mẫu nhận diện và không được
  lưu; chưa quét được thì 503.
- Dữ liệu thiết bị theo NGSI-LD (ADR 0012): Scorpio với CSDL PostGIS riêng, đọc qua `/v1/context` (context-api) chỉ
  thấy thiết bị của đơn vị mình.
- Nhận số đo qua MQTT (ADR 0012): Mosquitto trong mạng riêng `ot`, mỗi thiết bị một tài khoản chỉ gửi vào chủ đề của
  mình (`make device-add`, `make device-remove`); `iot-bridge` ghi vào Scorpio theo tenant của chủ đề.
- Bộ giả lập thiết bị demo (`devices/simulator`, `make simulate`): gửi nhiệt độ, độ ẩm, có người, điện năng qua MQTT;
  `--set` ép một số đo để thử vượt ngưỡng.
- `make e2e`: kịch bản demo trên trình duyệt thật qua cổng (Playwright).
- `make backup` và `make restore`: sao lưu PostgreSQL (gồm CSDL của Scorpio), SeaweedFS và `.env` kèm checksum; khôi
  phục ghi đè có xác nhận.
- Workflow BPMN tại `/v1/workflow/*` (ADR 0004): Flowable đứng sau `workflow-api`, cách ly tenant, chỉ vai trò ứng
  viên được hoàn thành task, quy tắc bốn mắt; `make test` chạy kiểm thử đơn vị.
- Lõi Tầng 1 chạy bằng Docker Compose: PostgreSQL + pgvector, Keycloak, APISIX (standalone), Hasura CE, SeaweedFS;
  `make up` chờ tới khi cổng đã nạp xong tuyến đường.
- Cổng APISIX chặn yêu cầu không token hoặc token giả, chặn console quản trị Keycloak, giới hạn tần suất API theo
  token (không theo IP, để người dùng sau cùng một NAT không chặn lẫn nhau).
- Tenant demo cách ly dữ liệu bằng claim `tenant` và quyền Hasura theo dòng.
- `make up`, `make seed`, `make smoke` (kiểm tra đầu-cuối); `make env` tự thêm biến mới từ `.env.example` vào `.env`
  đã có.
- Tài liệu API của lõi (`docs/api.md`) và tài liệu công cụ (`docs/tools.md`).
- Giấy phép Apache-2.0 và header SPDX cho mọi tệp, kiểm bằng `make check-fast`; hook pre-push qua `make hooks`.
- Quy tắc làm việc (`AGENTS.md`), hướng dẫn đóng góp, quy tắc ứng xử, chính sách bảo mật, mẫu issue và pull request;
  ADR 0001–0003 về quy ước, thành phần lõi và bố cục ba tầng.

### Changed

- Tenant demo là ba xã của "Tỉnh Mẫu" (hư cấu): `xa-a`, `xa-b`, `xa-c`, thay cho `xuong-a`, `xuong-b`.
- Quyền dữ liệu của Hasura khai báo trong repo (`core/hasura/`, `platform/schema/hasura/`): `make seed` ghi đè quyền
  bị sửa sai, `make smoke` báo lệch, `make check-fast` báo quyền không lọc theo tenant.
- Cổng chỉ mở các đường đăng nhập OIDC của realm `mortise`; console quản trị, realm `master` và trang tài khoản của
  Keycloak trả 403 (ADR 0007).
- Client giao diện `mortise-web` chỉ còn Authorization Code + PKCE, không nhận mật khẩu trực tiếp; kiểm thử dùng
  client `mortise-test`.
- Định danh kỹ thuật đổi từ `dxos` sang `mortise`: realm, client, CSDL, project compose, biến `MORTISE_PUBLIC_URL` và
  `MORTISE_BIND`.
- Quy trình mẫu của lõi chuyển sang `core/workflow/fixtures/`, chỉ dùng để kiểm thử lõi.

### Fixed

- Nội dung của một bước chỉ do người làm bước đó ghi (ADR 0031): workflow-api trả 400 khi người lập hay người làm bước
  khác gửi trường của một bước; trước đây người lập gửi sẵn được `decision` của bước quyết định.
- Người lập không đặt sẵn được quyết định của người duyệt (ADR 0025): workflow-api trả 400 khi biến khởi tạo trùng
  biến dùng trong điều kiện rẽ nhánh sau một bước người làm, ví dụ `approved`.
- `make backup` dừng các dịch vụ ghi dữ liệu trong lúc sao lưu; trước đây tệp tải lên giữa chừng thành đối tượng không
  có dòng `core.files`. `make restore` kiểm `core.files` khớp kho tệp (`make files-verify`).
- `make restore` dừng cả files-api trong lúc nạp dữ liệu, để không có tệp ghi xen vào dữ liệu đang bị ghi đè.
- Cổng trả lỗi 401 của `/v1/graphql` và `/v1/workflow/*` dạng JSON `{"error": "..."}` như hợp đồng, thay vì trang
  HTML.
- API quy trình trả 422 khi thân request có khóa ngoài `variables`, thay vì bỏ qua khóa đó và rẽ sang nhánh mặc định.
- Flowable không còn tự deploy các quy trình minh họa của image `flowable-rest`.

[Unreleased]: https://github.com/clauki-org/mortise-dx/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/clauki-org/mortise-dx/releases/tag/v0.1.0
