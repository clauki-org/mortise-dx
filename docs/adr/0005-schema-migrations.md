<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0005. Thay đổi lược đồ CSDL bằng migration dbmate, mỗi gói một lịch sử riêng

- Trạng thái: Chấp nhận
- Ngày: 2026-11-07

## Bối cảnh

Lược đồ CSDL đang được tạo bằng script init của image PostgreSQL (`core/postgres/init/`). Script này chỉ chạy một
lần, khi volume còn trống. Metadata Hasura (bảng được đăng ký, quyền) được áp bằng lời gọi API trong
`scripts/seed.sh`, không có lịch sử phiên bản. Hệ quả:

- Bản cài đã có dữ liệu không nhận được thay đổi lược đồ mới; cách duy nhất là `make reset`, mất toàn bộ dữ liệu.
- Lõi sắp thêm bảng nhật ký thay đổi và sổ cái chống sửa: đó là thay đổi lược đồ đầu tiên phải áp lên dữ liệu có sẵn.
- Gói nghiệp vụ phải cài vào và gỡ ra độc lập ([ADR 0003](0003-three-tier-layout.md)): lược đồ của một gói không
  được dính vào lịch sử của lõi hay của gói khác.

Dự án không có ứng dụng backend chính (API dữ liệu do Hasura sinh), nên không có framework nào tự chạy migration khi
khởi động; cần một công cụ đứng riêng, gọi được từ Docker Compose và CI, giấy phép OSI.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Giữ script init | Không nâng cấp được bản đã có dữ liệu |
| Migration của Hasura CLI | Quản lý chung lược đồ và metadata, nhưng mỗi dự án Hasura CLI có một lịch sử và một khối metadata chung; tách theo gói phải tự dựng nhiều dự án con |
| Flyway Community | Cần môi trường Java; hoàn tác (undo) chỉ có ở bản trả phí |
| Sqitch | Mô hình phụ thuộc giữa các thay đổi mạnh nhưng khó học, cần Perl |
| golang-migrate | Gần tương đương cho nhu cầu này; up và down là hai tệp riêng, không có sẵn tùy chọn chờ CSDL sẵn sàng |
| dbmate | Tệp SQL thuần có phần up và down; chọn được thư mục và bảng theo dõi cho mỗi lần chạy; có image chính thức |

## Quyết định

- Dùng **dbmate** (MIT), image chính thức `ghcr.io/amacneil/dbmate`, ghim phiên bản 2.37.0.
- Mỗi lịch sử migration là một cặp thư mục và bảng theo dõi riêng:
  - lõi: `core/postgres/migrations/`, bảng `core.schema_migrations`;
  - mỗi gói: `apps/<gói>/schema/migrations/`, bảng theo dõi nằm **ngoài** lược đồ của gói. Gỡ gói thường xóa cả
    lược đồ của gói; nếu bảng theo dõi nằm trong đó, nó bị xóa giữa lúc gỡ.
- Tệp migration đặt tên `YYYYMMDDHHMMSS_mo_ta_ngan.sql`, có cả phần `-- migrate:up` và `-- migrate:down`; mỗi tệp
  chạy trong một giao dịch.
- Chạy với `--strict` (không áp migration sai thứ tự), `--migration-lock` (hai lần chạy cùng lúc phải chờ nhau),
  `--wait` (chờ CSDL sẵn sàng) và `--no-dump-schema` (lược đồ đã nằm đủ trong các tệp migration).
- Script init chỉ còn tạo CSDL, vai trò và phần mở rộng, những việc cần quyền quản trị CSDL. Bảng và lược đồ đều
  do migration tạo, kể cả `core.tenants`.
- `make up` áp các migration của lõi chưa chạy trước khi Hasura khởi động.
- Metadata Hasura của mỗi gói nằm trong `apps/<gói>/hasura/` dưới dạng tệp khai báo (bảng đăng ký, quan hệ, quyền).
  Cài gói: chạy migration rồi áp metadata. Gỡ gói: bỏ đăng ký metadata rồi mới lùi migration, để Hasura không còn
  trỏ tới bảng đã bị xóa.

Đã kiểm ngày 2026-11-07 với dbmate 2.37.0 trên PostgreSQL 17 (CSDL tạm, đã xóa sau khi kiểm):

- hai thư mục với hai bảng theo dõi riêng chạy độc lập, `status` của mỗi bên chỉ thấy migration của mình;
- thêm migration thứ hai vào lõi khi bảng đã có dữ liệu: migration chạy, dữ liệu giữ nguyên;
- lùi migration của gói chỉ xóa lược đồ của gói, bảng của lõi và dữ liệu còn nguyên.

## Hệ quả

- Nâng cấp một bản cài đã có dữ liệu: lấy mã mới rồi `make up`; không cần `make reset`.
- Migration đã áp lên một bản cài thì không sửa nữa: dbmate chỉ lưu số phiên bản, không lưu nội dung, nên sửa tệp đã
  chạy sẽ không có hiệu lực ở nơi đã áp. Muốn đổi thì viết migration mới.
- `dbmate rollback` lùi một migration mỗi lần; bộ gỡ gói phải lặp tới khi gói không còn migration nào được áp.
- Phần `down` của lõi dùng khi phát triển; bản cài có dữ liệu thật quay lại bằng bản sao lưu, không bằng `down`.
- Thêm một thành phần bên thứ ba: README, `docs/tools.md` và bảng giấy phép cập nhật trong pull request chuyển lược
  đồ lõi sang migration.
- Metadata Hasura của lõi đang áp trong `scripts/seed.sh` sẽ chuyển sang tệp khai báo cùng cơ chế với gói.
- CI cần kiểm: áp migration trên CSDL trắng; vòng sao lưu và khôi phục vẫn qua; khi đã có gói, cài gói, chạy smoke,
  gỡ gói, smoke vẫn qua.
