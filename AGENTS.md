<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Quy tắc dự án: cho trợ lý AI và người đóng góp

Mortise DX: nền tảng chuyển đổi số nguồn mở (DX-OS Open-Core). Lõi Tầng 1 chạy ngầm, không giao diện; thành phần
dùng chung Tầng 2 cấu hình được; gói nghiệp vụ Tầng 3 cắm vào qua giao thức chuẩn. Giấy phép Apache-2.0.

Kiến trúc và cách chạy ở `README.md`, lý do đằng sau ở `docs/adr/`, cách đóng góp ở `CONTRIBUTING.md`. File này là
nguồn duy nhất của quy tắc làm việc; tài liệu khác trỏ về đây thay vì lặp lại.

## 1. Ngôn ngữ

- Tiêu đề commit và pull request: tiếng Anh, theo Conventional Commits.
- Thân commit, thân pull request, issue, tài liệu, chú thích trong code: tiếng Việt.
- Tên biến, hàm, bảng, cột, file, nhánh: tiếng Anh, `snake_case` hoặc `kebab-case` theo thói quen của từng ngôn ngữ.

## 2. Bố cục

Lý do của bố cục: [ADR 0003](docs/adr/0003-three-tier-layout.md). Thư mục ghi "kế hoạch" chỉ được
tạo khi có mã nguồn thật đầu tiên.

```
compose.yaml          dịch vụ lõi; dịch vụ tùy chọn tách theo profile
Makefile              lối vào duy nhất cho mọi lệnh
contracts/            hợp đồng API dùng chung giữa các tầng: JSON Schema, OpenAPI; CI kiểm
core/                 TẦNG 1: lõi không giao diện, không chứa nghiệp vụ
  apisix/ keycloak/ postgres/   cấu hình của từng thành phần bên thứ ba
  hasura/                       bảng Hasura đăng ký và quyền theo vai trò của lõi (khai báo, bản gốc)
  postgres/migrations/          migration lược đồ của lõi (ADR 0005)
  workflow-api/       dịch vụ tự viết: kiểm quyền trước Flowable (Python, uv)
  files-api/          dịch vụ tự viết: tải lên, tải xuống tệp theo tenant trước SeaweedFS (Python, uv)
  context-api/        dịch vụ tự viết: đọc dữ liệu thiết bị (NGSI-LD) theo tenant trước Scorpio (Python, uv)
  iot-bridge/         dịch vụ tự viết: nhận số đo qua MQTT, ghi vào Scorpio theo tenant của chủ đề, xét luật
                      ngưỡng (Python, uv)
  mosquitto/          cấu hình Mosquitto (MQTT) trong mạng thiết bị riêng
  cold-archive/       công cụ tự viết: xuất nhật ký cũ sang kho lạnh (Parquet), truy vấn bằng DuckDB (Python, uv)
  workflow/fixtures/  quy trình mẫu chỉ dùng để kiểm thử lõi
  ollama/             mô hình Ollama (profile `ai`) ghim theo digest trọng số
  observability/      cấu hình giám sát (profile `observability`): Prometheus, Loki, Alloy, blackbox, nguồn dữ
                      liệu và dashboard của Grafana
platform/             TẦNG 2: thành phần dùng chung, không chứa từ nghiệp vụ
  web/                khung giao diện: đăng nhập, menu, thương hiệu theo bản cài, nạp thành phần và gói
  components/<tên>/   kế hoạch: mã của một thành phần khi tách khỏi web/; schema cấu hình ở contracts/ (ADR 0013)
  services/<tên>/     dịch vụ dùng chung tự viết: assistant (trợ lý hỏi văn bản); OCR, lưu trữ lạnh là kế hoạch
  schema/             lược đồ CSDL của Tầng 2 (migration dbmate riêng) và quyền Hasura (`schema/hasura/`)
apps/<gói>/           TẦNG 3: gói nghiệp vụ; `app.yaml` khai báo gói, phần còn lại ưu tiên là khai
                      báo (schema/, hasura/, bpmn/, forms/, rules/, map-layers/, dashboards/, knowledge/, seed/, tests/)
presets/<mẫu>/        mẫu cài của một org: `preset.yaml` (gói, thương hiệu, tenant demo), brand/, seed/ (ADR 0058)
devices/              thiết bị: bộ giả lập và danh sách thiết bị demo (simulator/); firmware là kế hoạch
deploy/               triển khai lên máy chủ demo: script kéo tag phát hành mới, unit systemd (ADR 0036)
scripts/              lệnh hỗ trợ, gọi từ Makefile
docs/                 adr/ quyết định kiến trúc, api.md API của lõi, tools.md công cụ sử dụng, restore-drill.md
                      diễn tập khôi phục, assistant-eval.md đo trợ lý hỏi văn bản
  guides/             kế hoạch: hướng dẫn
```

Ranh giới bắt buộc:

- `core/` và `platform/` không biết nghiệp vụ nào: không có bảng, quy trình hay từ ngữ của một lĩnh vực. Nghiệp vụ
  nằm trong gói ở `apps/`.
- Gói chỉ nói chuyện với lõi qua cổng APISIX bằng giao thức chuẩn (OIDC, GraphQL, REST, MQTT, NGSI-LD, BPMN) và dùng
  thành phần Tầng 2 qua cấu hình. Không import code của `core/` hay `platform/`, không truy cập thẳng CSDL.
- Gói ưu tiên khai báo; chỉ viết giao diện riêng khi thành phần dùng chung không đáp ứng được, và ghi lý do. Gói
  liệt kê trong `DECLARATIVE_APPS` của Makefile chỉ được chứa tệp khai báo, trừ `tests/`; dữ liệu demo của gói đó
  là `seed/demo.yaml` (`contracts/seed.schema.json`). `make check-fast` kiểm
  ([ADR 0022](docs/adr/0022-declarative-packages.md)).
- Gỡ một gói thì lõi và các gói khác vẫn chạy, `make smoke` vẫn qua.
- Không commit tệp mô hình AI, dữ liệu lớn hay bản sao lưu; chúng được tải hoặc sinh ra khi chạy.
- Bảng chứa dữ liệu người dùng thay đổi được thì gắn nhật ký trong migration của nó: `SELECT core.audit_attach(...)`
  (ADR 0009).
- Quyền dữ liệu của Hasura chỉ sửa trong tệp khai báo (`core/hasura/`, `platform/schema/hasura/`), không sửa trên
  trang quản trị; mọi quyền phải lọc theo tenant trong token, `make check-fast` kiểm.
- Hợp đồng giữa các tầng nằm trong `contracts/`. Đổi claim token, định dạng `app.yaml` hay API của dịch vụ thì sửa
  hợp đồng trong cùng pull request; đổi route hay model của workflow-api hay files-api thì chạy `make contracts`.
  Lý do: [ADR 0008](docs/adr/0008-shared-api-contracts.md). Thành phần Tầng 2 có schema cấu hình và bản mô tả
  (`contracts/<tên>.schema.json`, `contracts/<tên>.component.yaml`); đổi hành vi của thành phần thì sửa bản mô tả
  trong cùng pull request. Lý do: [ADR 0013](docs/adr/0013-component-config-contracts.md).

## 3. Code

**Chú thích**

<!-- REUSE-IgnoreStart -->
- Mỗi tệp bắt đầu bằng header SPDX (`SPDX-FileCopyrightText` và `SPDX-License-Identifier: Apache-2.0`), tiếp theo là
  vài dòng nêu vai trò của tệp và nó nối với phần còn lại thế nào. Tệp không chứa được chú thích khai báo trong
  `REUSE.toml`.
<!-- REUSE-IgnoreEnd -->
- Chú thích giải thích vì sao, không kể lại code làm gì. Đặt ngay trên dòng cần giải thích và nêu hậu quả nếu làm khác.

**Phong cách**

- Hàm ngắn, mỗi hàm một việc. Ưu tiên cách đơn giản, giải thích được hơn cách khéo.
- Mọi lời gọi ra ngoài tiến trình (HTTP, CSDL, MQTT, tệp) đều xử lý lỗi và báo cho người dùng cách khắc phục.
- Không hard-code địa chỉ, bí mật, ngưỡng hay tên tenant trong logic; chúng đến từ cấu hình hoặc biến môi trường.
- Phiên bản image và thư viện được ghim cụ thể, không dùng `latest`.
- Thành phần bên thứ ba chạy bằng image hoặc gói chính thức, không sửa mã, không chép mã nguồn của họ vào repo.
- Tách tệp khi dài quá khoảng 200 dòng hoặc chứa một phần logic riêng.

**Chống nội dung rác**

- Không emoji, không icon trang trí trong code, chú thích, commit, pull request, issue hay tài liệu. Trong giao diện,
  chỉ dùng icon khi đọc nhanh hơn chữ, và icon đứng một mình phải có nhãn cho trình đọc màn hình.
- Không code chết, không code giữ chỗ, không `TODO` nếu không kèm số issue.
- Tài liệu chỉ ghi điều đã chạy thật. Tính năng chưa xong ghi rõ là kế hoạch.
- Không đưa con số chưa đo vào tài liệu hay giao diện. Đã đo thì ghi cách đo và ngày đo.
- Không bịa trích dẫn, văn bản pháp luật, tiêu chuẩn hay số liệu thị trường. Chưa kiểm chứng thì không viết.

## 4. Git, nhánh, pull request

- Không trailer AI trong commit và pull request: không dòng `Co-Authored-By` cho công cụ AI, không "Generated with".
  Khi squash merge, người merge xóa dòng `Co-authored-by` của AI mà GitHub tự chép vào; đồng tác giả là người thì giữ.
- Nhánh: `<type>/<mô-tả-ngắn>` hoặc `<type>/<issue>-<mô-tả>`. `git pull --rebase` trước khi push. Không force push
  `main`.
- Repo chỉ bật squash merge. Tiêu đề pull request thành tiêu đề commit trên `main`, tiếng Anh theo Conventional
  Commits (`type(scope): description`); thân pull request thành thân commit, tiếng Việt, theo mẫu pull request: Tóm
  tắt (1–3 câu: làm gì và được gì, đọc riêng vẫn hiểu, không cần mở issue), Thay đổi (mỗi thay đổi một gạch đầu
  dòng), Lý do, Đã kiểm tra, và `Closes #<issue>`.
- Một pull request, một thay đổi, một issue. Nhắm dưới khoảng 500 dòng thay đổi, không tính tệp sinh tự động, test và
  dữ liệu. Việc lớn tách theo tầng: core, app, dữ liệu, AI.
- Thay đổi người dùng thấy được thì thêm một mục 1–3 dòng vào `Unreleased` trong `CHANGELOG.md` ở cùng pull request:
  làm gì, người dùng thấy gì, ADR nếu có; chi tiết để ở ADR hay tài liệu. Bước nâng cấp chỉ ghi khi thay đổi phá
  tương thích với một bản đã phát hành.
- Không bao giờ commit bí mật. Bí mật chỉ nằm trong `.env`, do `make env` sinh ra.
- Quyết định thay đổi kiến trúc, phạm vi, thành phần hay quy ước đi kèm một bản ghi trong `docs/adr/` ở cùng pull
  request. Thêm thành phần bên thứ ba thì cập nhật bảng giấy phép, chỉ dùng giấy phép OSI.
- Tài liệu viết cho mọi người đọc: trung tính, không ngôi thứ nhất, không nhắc tới cuộc trò chuyện hay cá nhân, không
  nhắc repo khác trừ khi thiếu nó thì không hiểu được.

## 5. Cách trợ lý AI làm việc trong dự án

- Làm từng bước nhỏ, đúng phần được yêu cầu. Không viết một tính năng lớn một lần, không sửa tệp không liên quan.
- Chỉ commit, push hay mở pull request khi người dùng yêu cầu. Không bao giờ merge.
- Không bao giờ bỏ qua hook (`--no-verify`). Hook lỗi thì sửa nguyên nhân rồi push lại.
- Kiểm tra kích thước trước khi đề xuất pull request: `git diff --stat main`. Quá giới hạn hoặc lẫn nhiều tầng thì
  nói ra và đề xuất tách.
- Viết code xong, giải thích ngắn nó làm gì và vì sao, đủ để người dùng tự giải thích lại khi được hỏi.
- Không tự đặt quy tắc ngoài các tài liệu này. Không chắc thì nói không chắc. Không chép code từ repo khác, kể cả repo
  của các dự án khác.
- Kết thúc mỗi phần việc bằng đề xuất tiêu đề và thân pull request.

## 6. Trước khi push

Chạy `make hooks` một lần sau khi clone: hook pre-push chạy `make check-fast` mỗi lần push và chặn nếu lỗi.

- [ ] `make check-fast` qua: giấy phép từng tệp, cú pháp compose, kiểm tra shell.
- [ ] Thay đổi ở lõi: `make up && make seed && make smoke` qua trên dữ liệu trắng (`make reset` trước).
- [ ] Đã tự chạy thử phần vừa đổi.
- [ ] Người commit giải thích được mọi dòng mình thêm.
- [ ] Tiêu đề pull request theo Conventional Commits, thân có thay đổi, lý do, cách kiểm tra, `Closes #`, dòng
      CHANGELOG nếu cần.
