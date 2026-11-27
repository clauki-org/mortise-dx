<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0061. Nguyên tắc ghép: trang gồm khối, kiểu trình bày của thành phần, bài kiểm tổ hợp

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Mỗi mục menu của gói mở đúng một thành phần Tầng 2 trên cả trang ([ADR 0013](0013-component-config-contracts.md),
[ADR 0044](0044-menu-groups-and-icons.md)). Một tổ chức muốn thấy nhiều thứ trên một trang, ví dụ số liệu chính, bản đồ
và danh sách cùng lúc, thì phải mở ba mục. Thành phần cũng chỉ có một cách trình bày, trừ công tắc bảng, thẻ của danh mục
([ADR 0050](0050-catalog-tones-cards-form-help.md)), và công tắc đó không chọn được bằng cấu hình.

Nền tảng hướng tới việc mỗi tổ chức tự lắp và tự chỉnh giao diện bằng cấu hình (thương hiệu là dữ liệu,
[ADR 0043](0043-design-tokens-and-install-branding.md)). Lắp như vậy chỉ an toàn khi một cấu hình đã qua bước kiểm thì
luôn vẽ được: không vỡ trang, không lỗi khó hiểu. Đúng nghiệp vụ hay không là việc của tổ chức, nền tảng không đoán.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Khối là gì | Cấu hình thành phần viết thẳng trong tệp trang | Cần bước kiểm riêng cho từng thành phần lồng trong trang; trợ lý dữ liệu đọc cấu hình của mục từ CSDL theo (gói, mục) thì không thấy khối |
| | Một dòng `platform.menu_items` như mục menu, khai ở `blocks` của app.yaml | Chọn: cùng dạng, cùng bộ nạp, cùng bước kiểm, cùng quyền đọc, cùng địa chỉ riêng cho chi tiết dòng; chỉ thêm cột `on_menu` |
| Chọn kiểu | Tên kiểu tự do, thành phần tự hiểu | Gõ sai chỉ thành kiểu mặc định mà không ai biết |
| | `variant` là enum trong schema của từng thành phần | Chọn: `make check-fast` chặn kiểu lạ; giao diện vẫn đưa giá trị lạ về kiểu mặc định |
| Lỗi của một khối | Để lỗi lên màn hình lỗi của router | Cả trang mất vì một khối |
| | Ranh giới lỗi riêng mỗi khối | Chọn: khối hỏng chỉ hiện lời báo chung ([ADR 0046](0046-shared-ui-states.md)) trong khối đó |

## Quyết định

**Nguyên tắc ghép.** Ghép bất kỳ thành phần nào, theo bất kỳ cấu hình nào qua được bước kiểm, đều phải vẽ được. Thành
phần không phụ thuộc nhau; thiếu dữ liệu, thiếu quyền hay đang tải thì hiện trạng thái chung (rỗng, lỗi, đang tải),
không ném lỗi. Bước kiểm chỉ xét dạng và tham chiếu (bảng, cột, quyền, mục, kiểu); nó không xét cấu hình có hợp nghiệp
vụ hay không.

**Khối.** Gói khai khối ở `blocks` của app.yaml, cùng dạng với mục `menu` nhưng không có `icon`. Bộ cài
(`scripts/app-deploy.py`) ghi cả hai vào `platform.menu_items`, khối có `on_menu = false`; thanh bên và trang chủ bỏ qua
dòng đó, còn trang và địa chỉ `/apps/<gói>/<khối>` vẫn tìm được nó. id của menu và blocks không trùng nhau. Mọi bước kiểm
cấu hình thành phần đọc cả hai danh sách qua `scripts/app_entries.py`.

**Trang.** Thành phần `page` (contracts/page.schema.json) có tiêu đề, giới thiệu và `blocks: [{item, variant}]`; mỗi
`item` là một mục menu hay khối của chính gói. `scripts/check-page-config.py` chặn item không có, item là một trang (trang
lồng trang có thể tự chứa mình) và kiểu không có trong `variant` của thành phần. Tiêu đề của trang là h1 duy nhất; thành
phần trong khối vẽ tiêu đề của nó thành h2 (PageHeader đọc ngữ cảnh khối). Danh mục và theo dõi hồ sơ trong khối chỉ có
danh sách, giữ trạng thái trong bộ nhớ, vì địa chỉ là của trang; bấm một dòng mở chi tiết dưới địa chỉ của mục. Khối của
mục dành cho vai trò khác không hiện.

**Kiểu.** `variant` là enum trong schema: danh mục `table | cards`, bảng điều hành `full | compact` (gọn: bỏ lời mô tả,
giữ số và "Xem cách tính"), bản đồ `map | list` (danh sách: không nạp MapLibre). Kiểu đầu là mặc định; kiểu chọn ở trang
đè kiểu trong cấu hình của mục; giá trị giao diện không biết về kiểu mặc định. `page.test.ts` so danh sách kiểu của giao
diện với schema.

**Bài kiểm tổ hợp.** `platform/web/src/blocks.test.tsx` (Vitest, `renderToStaticMarkup`, client urql giả) dựng mọi mục
của `contracts/examples` và của mọi gói trong `apps/` (cấu hình đọc từ tệp thật) ở hai vị trí (đứng riêng, là khối trên
một trang) × mọi kiểu cộng một kiểu lạ × bốn trạng thái dữ liệu GraphQL (có dòng, rỗng, lỗi quyền, đang tải), thêm một
trang chứa mọi mục của từng gói. Mỗi tổ hợp đi qua PackagePage như trên trình duyệt; bài đòi không tổ hợp nào ném lỗi
hay báo cấu hình sai, có đúng một h1, và với danh mục, bản đồ thì trạng thái dữ liệu hiện ra trên trang. Bài in số tổ
hợp khi chạy. Bản đồ thật và cỡ điện thoại kiểm bằng Playwright (trang `overview` trong `e2e/visual.spec.ts`, mục trang
trong `e2e/package-menu.spec.ts`).

## Hệ quả

- Gói dựng trang tổng quan bằng cấu hình; gói `facilities-commune` có trang "Tổng quan" (số diện tích gọn, bản đồ trụ
  sở, danh mục cơ sở dạng thẻ).
- Giới hạn của bài kiểm: `renderToStaticMarkup` không chạy effect và không gọi ranh giới lỗi, nên lỗi lúc vẽ làm bài hỏng
  thay vì bị khối nuốt; ranh giới lỗi được kiểm riêng (trạng thái lỗi và lời báo). Nguồn REST (TanStack Query: số hồ sơ,
  số đo, trợ lý, theo dõi hồ sơ) không gửi yêu cầu khi dựng tĩnh, nên phần đó chỉ được kiểm ở trạng thái đang tải. Dữ liệu
  giả dựng từ câu truy vấn, mỗi cột là số 1; thẻ số của bảng điều hành đòi đúng một dòng, nên trạng thái "có dòng" trả một
  dòng: nguồn nhiều dòng là lỗi dữ liệu của gói, có lời báo riêng.
- Khối xếp một cột; chưa chia cột, chưa kéo thả. Danh mục trong khối không có nút xuất tệp. Khối trong chi tiết một dòng
  và kiểu Kanban, Lịch của danh mục là việc sau, dùng lại `variant` và ngữ cảnh khối ở `platform/web/src/blockContext.ts`.
- Thêm thư viện kiểm thử `yaml` (ISC), chỉ dùng trong bài kiểm, không vào bản build.
