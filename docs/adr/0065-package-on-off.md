<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0065. Bật, tắt gói theo org: ẩn qua quyền đọc menu, dữ liệu giữ nguyên

- Trạng thái: Chấp nhận
- Ngày: 2026-11-28

## Bối cảnh

Quản trị org (tenant_admin của tenant không có cha) cần thêm, bớt ứng dụng cho cả org bằng một nút, không gỡ dữ liệu
và không chạy lệnh trên máy chủ. Cài, gỡ gói thật (`make app-install`, `make app-uninstall`) chạy migration và áp
metadata Hasura, cần quyền với Docker; mở việc đó ra web là rủi ro bảo mật, nên để sau.

Trình duyệt chỉ biết gói qua `platform.menu_items` (ADR 0023, 0044): thanh bên, trang chủ (ADR 0051), khối của trang và
trợ lý hỏi dữ liệu (ADR 0027) đều đọc bảng này qua Hasura. Trước quyết định này không có bảng gói: tên
gói lặp trên từng mục menu, `description` của `app.yaml` không được nạp, gói không khai được gói nó cần.

Các cách đã xét:

- **Xóa mục menu của gói khi tắt.** Bật lại phải cài lại gói. Mục menu ghi cho mọi tenant, nên tắt ở org này mất cả
  ở org khác.
- **Giao diện tự lọc gói tắt.** Mỗi nơi đọc menu phải nhớ lọc; trợ lý hỏi dữ liệu đọc menu ở dịch vụ, không qua giao
  diện. Ai gọi thẳng GraphQL vẫn thấy mục.
- **Quyền đọc `menu_items` của Hasura bỏ mục của gói tắt.** Một chỗ, áp cho mọi nơi đọc, theo tenant trong token.

## Quyết định

Chọn cách thứ ba.

- **`app.yaml` thêm `requires`:** mảng mã gói mà gói cần. `description` thành chữ bắt buộc có nội dung khi khai.
- **`platform.apps`** (mã, tên, mô tả, `requires`): bộ cài gói (`scripts/app-deploy.py install`) ghi bằng
  `ON CONFLICT DO UPDATE`, không xóa rồi ghi lại, để cài lại gói giữ lựa chọn tắt. Bộ cài từ chối cài khi gói cần
  chưa cài, từ chối gỡ gói mà gói đã cài khác cần; gỡ gói xóa dòng. Mục mẫu của lõi (`menu --owner core`) không có
  dòng ở đây nên không tắt được.
- **`platform.app_states`** (tenant gốc, gói, `enabled`): không có dòng là đang bật. Có nhật ký (ADR 0009), tenant
  ghi là tenant gốc. Không có quyền xóa: bật lại là ghi `enabled = true`.
- **Trigger `platform.app_states_guard()`** kiểm mỗi lần ghi:
  - tenant gốc không có cha; gói đã cài; chỉ sửa được `enabled`;
  - không tắt gói mà một gói đang bật khác cần;
  - không bật gói khi gói nó cần chưa cài hay đang tắt. Chặn cả chiều bật vì chỉ chặn chiều tắt thì tắt Y, tắt X,
    bật Y vẫn để Y chạy thiếu X.
- **View:** `platform.apps_by_tenant` nối gói với tenant gốc của mỗi tenant (`platform.tenant_roots`, ADR 0059);
  `platform.disabled_apps` là cặp tenant, gói đang tắt.
- **Quyền Hasura:**
  - `menu_items` của `user`: `tenant_id` trùng token và không có dòng `disabled_apps` cùng tenant, cùng gói.
  - `apps_by_tenant`: chỉ `tenant_admin` mà tenant trong token là chính tenant gốc.
  - `app_states`: `tenant_admin` của tenant không có cha thêm và sửa `enabled` (insert kèm `on_conflict`), tenant gốc
    lấy từ token.
- **Trang "Ứng dụng"** (`/packages`, nhóm "Chung" của thanh bên, chỉ hiện cho quản trị org): mỗi gói một thẻ có tên,
  mô tả, gói cần, trạng thái bằng chữ và nút gạt. Lý do khóa nút tính trên trình duyệt bằng cùng hai luật của
  trigger (`platform/web/src/apps.ts`); CSDL từ chối thì hiện lời của trigger. Menu, trang chủ và danh sách gói đọc
  lại ngay sau khi ghi.

## Hệ quả

- Tắt một gói thì thanh bên, trang chủ, khối của trang và câu hỏi dữ liệu trên mục của gói mất ở mọi tenant của org,
  org khác không đổi. Bật lại thì hiện như cũ, kể cả phần chỉnh cấu hình (ADR 0060) vì phần chỉnh nằm ở bảng riêng.
- Giới hạn: tắt gói chỉ ẩn mục menu. Quyền bảng của gói, quy trình đang chạy và mở mới qua workflow-api, luật ngưỡng
  của gói vẫn chạy; ai biết đường dẫn GraphQL hay REST vẫn đọc, ghi dữ liệu theo quyền của gói. Bước của quy trình
  của gói vẫn hiện ở "Việc của tôi".
- `scripts/app.sh install` chạy migration và áp metadata Hasura của gói trước `app-deploy.py install`, nên khi bị
  từ chối vì gói cần chưa cài, lược đồ của gói đã có; cài gói cần rồi chạy lại `make app-install`.
- Cài lại một gói mà bản mới thêm `requires` không kiểm lại với org đang tắt gói được cần: gói có thể đang bật trong
  khi gói nó cần đang tắt, tới khi quản trị org bật gói đó.
- Bản cài đã có gói trước migration này có danh sách gói rỗng cho tới khi chạy lại `make app-install` cho từng gói.
- Chưa gói nào trên `main` khai `requires`: đường từ chối kiểm bằng `platform/schema/tests/app_states.sql` và
  `apps.test.ts`, chưa chạy với gói thật.
- `make smoke` chạy `platform/schema/tests/app_states.sql` (trong giao dịch rồi ROLLBACK) và
  `scripts/app-states-smoke.sh` (quyền và menu qua cổng); `make e2e` chạy `platform/web/e2e/apps-page.spec.ts`.
