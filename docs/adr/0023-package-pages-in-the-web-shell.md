<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0023. Trang của gói trong khung giao diện: đường dẫn, bảng tra thành phần, menu theo vai trò

- Trạng thái: Chấp nhận
- Ngày: 2026-11-21

## Bối cảnh

Gói khai mục menu trong `app.yaml` (`menu`: mã mục, nhãn, tên thành phần Tầng 2, tệp cấu hình, vai trò thấy mục);
khi cài, `scripts/app-deploy.py` nạp các mục kèm nội dung tệp cấu hình vào bảng `platform.menu_items` cho mọi tenant
đang có, khi gỡ thì xóa. [ADR 0013](0013-component-config-contracts.md) để mở hai điểm: chỗ mở thành phần trên giao
diện và cách cấu hình của gói tới giao diện, quyết định khi ráp gói vào khung giao diện (#106). Bản ghi này chốt hai
điểm đó theo cách `platform/web/src/` đang làm.

## Quyết định

- Đường dẫn: mỗi mục menu của gói mở ở `/apps/<gói>/<mục>` (`itemPath` trong `menu.ts`), route
  `apps/:app/:item/*` trong `App.tsx`. Phần đường dẫn sau mục thuộc về thành phần của mục, ví dụ dòng chi tiết của
  danh mục. Cấu hình của thành phần đến giao diện cùng mục menu, qua truy vấn GraphQL `platform_menu_items`.
- Bảng tra thành phần: `PackagePage.tsx` tra tên thành phần của mục trong một `Map` từ tên tới hàm vẽ. Hiện bảng chỉ
  có `catalog`; bảy tên còn lại mà `contracts/app.schema.json` cho phép thì trang hiện cảnh báo "Chưa mở được mục
  này" thay vì vẽ. Thêm thành phần là thêm một dòng vào bảng, không thêm trang cho từng gói.
- Menu theo vai trò: trình duyệt đọc `realm_access.roles` trong access token (`rolesOf`) và chỉ hiện mục không khai
  vai trò, hoặc có ít nhất một vai trò trùng (`visibleItems`). Đây chỉ là hiện hay ẩn: quyền đọc
  `platform.menu_items` chỉ lọc theo tenant, nên mọi mục của tenant, kể cả `config` và `roles`, đều tới trình duyệt
  của mọi người trong tenant. Mục bị ẩn mà mở thẳng bằng đường dẫn thì trang báo không có trang, như đường dẫn sai.
  Dữ liệu sau mục vẫn do quyền Hasura và workflow-api bảo vệ.
- Vai trò khi truy vấn: giao diện không gửi `X-Hasura-Role` (`graphql.ts`), và trong repo không có gì đặt claim
  `mortise_default_role`, nên Hasura lấy vai trò mặc định `user` (`compose.yaml`) cho mọi truy vấn GraphQL của giao
  diện.

## Hệ quả

- Gói mới chỉ thêm mục menu và tệp cấu hình, không thêm mã giao diện, miễn là thành phần đã có trong bảng tra.
- Gỡ gói thì mục của nó mất khỏi menu và đường dẫn của mục báo không có trang, không phải sửa giao diện.
- Một mục khai `roles: [manager]` hiện cho người có vai trò `manager`, nhưng dữ liệu của mục vẫn được truy vấn với vai
  trò `user`. Các việc cần quyền của `tenant_admin`, `manager` hay `rollup_reader` trên giao diện, như sửa phân công
  hay đọc tổng hợp của tenant con, cần một quyết định riêng về cách chọn vai trò.
- `config` của mục menu đọc được bởi mọi người trong tenant, kể cả người không thấy mục trên menu.
