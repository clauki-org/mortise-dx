<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Changelog

Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số
phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added

- Khung giao diện Tầng 2 tại `/` của cổng (`platform/web/`, React, Mantine): đăng nhập Authorization Code + PKCE
  qua Keycloak, đăng xuất, tự làm mới token, đọc đơn vị của người dùng qua GraphQL. nginx phục vụ tệp tĩnh kèm
  Content-Security-Policy; đường sai dưới `/v1` trả 404. `make web-check` (Biome, kiểu, build, giấy phép phụ thuộc)
  chạy trong CI; `make seed` cho máy chủ phát triển giao diện (`localhost:5173`) đăng nhập được.
- Giấy phép Apache-2.0 và header SPDX cho mọi tệp, kiểm bằng `make check-fast`; hook pre-push qua `make hooks`;
  CI chạy đúng lệnh này với mọi pull request.
- Quy tắc làm việc (`AGENTS.md`), hướng dẫn đóng góp, quy tắc ứng xử, chính sách bảo mật, mẫu issue và pull
  request.
- ADR 0001 về quy ước dự án, ADR 0002 về chọn thành phần lõi và giấy phép, ADR 0003 về bố cục ba tầng.
- Lõi Tầng 1 chạy bằng Docker Compose: PostgreSQL + pgvector, Keycloak, APISIX (standalone), Hasura CE, SeaweedFS.
- Cổng APISIX chặn yêu cầu không token hoặc token giả, chặn console quản trị Keycloak, giới hạn tần suất API theo
  token (không theo IP, để người dùng sau cùng một NAT hay tunnel không chặn lẫn nhau).
- Hai tenant demo cách ly dữ liệu bằng claim `tenant` và quyền Hasura theo dòng.
- `make up`, `make seed`, `make smoke` (kiểm tra đầu-cuối); CI dựng lõi trên máy trắng và chạy smoke.
  `make env` tự thêm biến mới từ `.env.example` vào `.env` đã có.
- Tài liệu API của lõi (`docs/api.md`) kèm ví dụ và ý nghĩa mã lỗi.
- Workflow BPMN tại `/v1/workflow/*`: Flowable đứng sau `workflow-api`, cách ly tenant, chỉ vai trò ứng viên được
  hoàn thành task, quy tắc bốn mắt; quy trình mẫu `core-approval` deploy theo tenant bằng `make seed`. `make test`
  chạy kiểm thử đơn vị; ADR 0004 về lớp kiểm soát quyền trước Flowable.
- Tài liệu công cụ sử dụng (`docs/tools.md`): vai trò, cấu hình và cách xem của từng thành phần lõi và công cụ
  phát triển.
- `make backup` và `make restore`: sao lưu PostgreSQL (mọi CSDL và vai trò), SeaweedFS và `.env` kèm checksum;
  khôi phục ghi đè có xác nhận. CI kiểm cả vòng sao lưu, xóa sạch, khôi phục.
- `make up` chờ tới khi cổng APISIX đã nạp xong tuyến đường (healthcheck), không chỉ tới khi container chạy.
- CI bỏ qua bước dựng lõi khi pull request chỉ đổi tài liệu, chỉ chạy vòng sao lưu và khôi phục khi đổi phần nó
  phụ thuộc; push lên `main` luôn chạy đủ. Tên job và bước bằng tiếng Anh.
- Lược đồ CSDL của lõi quản lý bằng migration dbmate: `make up` áp migration chưa chạy, bản cài đã có dữ liệu nâng
  cấp không cần `make reset`; `make migrate-new`, `make migrate-status`. Tenant demo chuyển sang `make seed`.
- Hợp đồng API giữa các tầng trong `contracts/`: JSON Schema cho claim token và `app.yaml`, OpenAPI của
  workflow-api có schema phản hồi và lỗi; `make check-fast` báo lỗi khi lệch, `make smoke` kiểm token thật.
  Ví dụ sai trong `contracts/examples/invalid/` phải bị từ chối, mỗi tệp phạm đúng một luật.
- Task của API quy trình có thêm `process`, `step` và `due` để giao diện biết việc đang ở bước nào và hạn khi
  nào; khởi tạo quy trình nhận header `Idempotency-Key`, gửi lặp không tạo quy trình thứ hai.
- Định dạng khai báo bước của quy trình (`contracts/workflow.schema.json`): biểu mẫu, nút quyết định và hồ sơ
  liên quan của từng bước người làm; `make check-fast` kiểm mọi userTask trong BPMN của gói đều có khai báo.
- Bảng `platform.workflow_steps` (Tầng 2, lịch sử migration riêng): khai báo bước của quy trình theo tenant, đọc
  qua GraphQL; `make seed` nạp khai báo của quy trình mẫu.
- Giao diện có menu bên trái và trang "Việc của tôi": các việc đang chờ người đăng nhập, việc gần hạn đứng đầu,
  lọc quá hạn, còn hạn hoặc không đặt hạn.

### Changed

- Cổng chỉ mở các đường đăng nhập OIDC của realm `mortise`; console quản trị, realm `master`, trang tài khoản và
  các endpoint không dùng của Keycloak trả 403. Smoke kiểm các đường bị chặn và một lần đăng nhập PKCE đi trọn qua
  cổng. ADR 0007 ghi trang đăng nhập là bề mặt giao diện duy nhất của lõi.
- Client giao diện `mortise-web` chỉ còn Authorization Code + PKCE, không nhận mật khẩu trực tiếp; redirect URI và
  web origin theo `MORTISE_PUBLIC_URL`. Smoke và ví dụ lấy token bằng lệnh dùng client `mortise-test` do `make seed`
  tạo. Bản cài đã dựng cần `make reset` để nạp lại realm.
- Định danh kỹ thuật đổi từ `dxos` sang `mortise` cho khớp tên sản phẩm: realm Keycloak `mortise`, client
  `mortise-web`, CSDL `mortise`, project compose `mortise`, biến `MORTISE_PUBLIC_URL` và `MORTISE_BIND` (thay
  `DXOS_PUBLIC_URL`, `DXOS_BIND`). **Không tương thích với bản cài cũ**, xem hướng dẫn nâng cấp bên dưới.
- Quy trình mẫu của lõi chuyển từ `core/workflow/processes/` sang `core/workflow/fixtures/` và ghi rõ chỉ dùng để
  kiểm thử lõi; quy trình nghiệp vụ nằm trong gói ở `apps/`.

#### Nâng cấp bản cài đã dựng trước khi đổi tên

Tên CSDL, realm và project compose đều đổi, nên dữ liệu cũ không tự chuyển sang. Bản sao lưu làm trước khi đổi tên
vẫn nạp được, nhưng tạo lại CSDL và realm tên cũ mà bản cài mới không dùng tới, nên hệ thống sẽ không chạy.

```bash
docker compose -p dxos down -v   # xóa container và dữ liệu của project cũ
make up seed smoke               # dựng lại với tên mới
```

Trong `.env` đã có, đổi tên `DXOS_PUBLIC_URL` thành `MORTISE_PUBLIC_URL` và `DXOS_BIND` thành `MORTISE_BIND` nếu
từng đặt giá trị khác mặc định; `make env` tự thêm hai biến mới với giá trị mặc định.

### Fixed

- Cổng trả lỗi `401` của `/v1/graphql` và `/v1/workflow/*` dạng JSON `{"error": "..."}` như hợp đồng ghi, thay vì
  trang HTML. Ví dụ sai trong `contracts/examples/invalid/` phải bị từ chối đúng luật mà tệp được viết ra để thử;
  `scripts/contracts.sh` báo lỗi khi gõ sai tham số.
- API quy trình trả 422 khi thân request có khóa ngoài `variables`, thay vì bỏ qua khóa đó. Trước đây gửi
  `{"approved": true}` thiếu lớp `variables` vẫn hoàn thành task, nhưng quy trình không nhận được biến và rẽ sang
  nhánh mặc định. Lỗi 422 có dạng `{"error": "..."}` như các lỗi khác của API.
- Flowable không còn tự deploy các quy trình minh họa của ảnh `flowable-rest`; smoke kiểm không có quy trình nào
  ngoài các tenant. Bản cài đã dựng vẫn giữ các quy trình đó trong CSDL, smoke báo lỗi cho tới khi `make reset`.
