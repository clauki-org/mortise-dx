<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0060. Ghi đè cấu hình theo org: bảng riêng, đích theo tên, trộn và kiểm lại trên trình duyệt

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Quản trị org (tenant_admin của tenant không có cha) cần đổi nhãn, ẩn hiện, thứ tự, kiểu, khối và ngưỡng của mục menu
do gói khai, cho cả org, mà không sửa tệp của gói. Cấu hình gốc nằm ở `platform.menu_items.config` (ADR 0044). Bộ cài
gói (`scripts/app-deploy.py`) xóa rồi ghi lại các dòng này mỗi lần cài, và cấu hình gốc đã qua bộ kiểm của gói lúc
cài.

Các cách đã xét:

- **Sửa thẳng `menu_items.config`.** Cài lại gói thì mất phần đã chỉnh. Không còn bản gốc để "Về mặc định".
- **Lưu bản cấu hình đầy đủ của org.** Gói lên bản mới thì bản của org giữ nguyên cấu hình cũ, kể cả trường gói đã bỏ
  hay đổi tên. Muốn kiểm phải chạy lại cả bộ kiểm của gói.
- **Đường dẫn JSON (JSON Patch).** Đường dẫn trỏ theo vị trí (`/fields/2/label`): gói thêm một trường ở đầu thì mọi
  đường dẫn trỏ sai chỗ mà không báo lỗi.
- **Từng phần chỉnh nhỏ, đích là tên trường, cột, khối.** Tên vẫn đúng khi gói đổi bố cục. Đích không còn thì bỏ
  qua được.

## Quyết định

Chọn cách thứ tư.

- **Bảng `platform.config_overrides`:** tenant gốc, gói, mục, `kind`, `target`, `value`, khóa chính gồm năm cột đầu.
  - `kind` là một trong `label`, `hidden`, `order`, `variant`, `block`, `threshold`.
  - `target` là tên trường, cột hay khối trong cấu hình gốc. Chuỗi rỗng là chính mục menu: nhãn, ẩn, thứ tự trên
    menu, và kiểu của mục khi cấu hình gốc có khóa `variant`.
  - Không khóa ngoại tới `menu_items`: cài lại gói không mất phần chỉnh.
  - Có nhật ký (ADR 0009), tenant ghi là tenant gốc. "Về mặc định" là xóa dòng.
- **Đích theo thành phần,** chỉ ở tầng ngoài cùng của cấu hình. Tên trường lặp lại ở bảng con và biểu mẫu lồng, nên
  một tên không chỉ ra được một chỗ ở đó.
  - Danh mục: nhãn của trường; ẩn, hiện, thứ tự của cột trong danh sách. Trường qua quan hệ chỉ đổi được nhãn.
  - Biểu mẫu: nhãn, ẩn, thứ tự của trường. Trường bắt buộc không ẩn được.
  - Bảng điều hành: nhãn, ẩn, thứ tự của khối (`id`); nhãn và ngưỡng của thẻ số (`<khối>.<cột>`).
  - Ngưỡng chỉ đổi số của mức gói đã khai (`warn_when`, `bad_when`), giữ phép so một phép và chữ mức độ của gói.
  - Trang khối (thành phần có `blocks`): kiểu, ẩn, thứ tự của khối; `block` thêm (true) một mục khác của cùng gói làm
    khối hay gỡ (false) một khối.
- **Trigger kiểm mỗi lần ghi,** kể cả đường ghi khác Hasura:
  - tenant gốc không có cha;
  - dạng của `value` theo loại (nhãn 1–200 ký tự, true hay false, số nguyên 0–9999, tên kiểu ngắn, ngưỡng);
  - mục đã cài cho tenant gốc, và đích có trong cấu hình gốc của mục ở tenant đó;
  - chỉ sửa được `value`; đổi đích thì xóa rồi thêm.
- **Đọc qua view `platform.config_overrides_by_tenant`:** nối phần chỉnh với `platform.tenant_roots` (ADR 0059).
  Quyền đọc của `user` và `tenant_admin` lọc theo `tenant_id` của view, nên tenant thuộc org khác không thấy dòng nào.
- **Ghi qua Hasura:** chỉ `tenant_admin` của chính tenant gốc thêm, sửa `value` (để insert kèm `on_conflict` chạy được)
  và xóa. Tenant gốc lấy từ token (`set`).
- **Trình duyệt trộn bằng hàm thuần** (`platform/web/src/configOverrides.ts`).
  - Đích không còn, giá trị sai dạng hay loại không áp cho thành phần thì bỏ qua phần chỉnh đó, báo ở console.
  - Thứ tự: phần tử có phần chỉnh `order` chuyển tới vị trí bằng số đó; cùng số thì phần tử được chỉnh đứng trước.
  - Sau khi trộn, hàm `*Problems` của thành phần kiểm lại (`configEffective.ts`). Có lỗi thì dùng cấu hình gốc.
  - Phần chỉnh đọc bằng truy vấn riêng với menu. Lỗi thì menu vẫn hiện theo cấu hình gốc.
  - Mục ẩn không lên menu và trang chủ, đường dẫn của mục vẫn mở được.
- **Bài kiểm CI** (`make overrides-check`): sinh phần chỉnh hợp lệ cho mọi mục menu của mọi gói, theo từng loại và gộp
  mọi loại, trộn bằng đúng hàm của trình duyệt, đưa kết quả qua bộ kiểm chung của gói
  (`scripts/contracts.sh package <gói> --configs <thư mục>`). Bản `contracts.sh` chưa có lệnh `package` thì chỉ kiểm theo
  schema của thành phần.

## Hệ quả

- Cài lại gói giữ phần chỉnh. Gói lên bản mới bỏ một trường thì phần chỉnh của trường đó không còn tác dụng, không làm
  hỏng trang.
- Hai nơi nói đích nào nhận loại nào: `platform.config_override_target_problem()` khi ghi và `overrideTargets()`,
  `mergeConfig()` khi đọc. `platform/schema/tests/config_overrides.sql` và `configOverrides.test.ts` thử từng loại ở hai
  phía.
- Giới hạn:
  - Không chỉnh được bảng con, biểu mẫu lồng trong danh mục, lớp bản đồ hay thành phần khác ngoài các đích ở trên.
  - Trigger không chạy được hàm `*Problems`: phần chỉnh qua được trigger mà làm cấu hình hỏng (ví dụ đổi thứ tự đưa
    một trường lên trước trường mà nó lọc theo) thì trang dùng cấu hình gốc, báo ở console.
  - Kiểu (`variant`) và trang khối chưa có thành phần nào dùng trên `main`. Phần chỉnh của hai loại này được lưu và
    kiểm dạng, có tác dụng khi thành phần khai chúng.
- Chế độ Chỉnh sửa trên trang ghi và xóa qua API ở trên; giao diện của nó là việc tiếp theo.
- `make smoke` chạy `platform/schema/tests/config_overrides.sql` (trong giao dịch rồi ROLLBACK) và
  `scripts/config-overrides-smoke.sh` (quyền qua cổng).
