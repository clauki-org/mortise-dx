<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0063. Bộ biến giao diện theo bản cài trong `/branding.json`: màu chính, màu phụ, bo góc, phông, nền trang

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27
- Sửa đổi: [ADR 0043](0043-design-tokens-and-install-branding.md)

## Bối cảnh

`branding.json` của [ADR 0043](0043-design-tokens-and-install-branding.md) chỉ đổi được tên, logo và một màu chính
trong sáu bảng màu Mantine. Hai bản cài trên cùng mã nguồn (một chính quyền, một doanh nghiệp) vì vậy chỉ khác nhau ở
tên và màu nút; doanh nghiệp muốn màu cam, góc vuông hơn thì không có cách nào ngoài sửa mã.

Bảng `orange` của Mantine không dùng được làm màu chính: chữ cam sắc 8 trên nền trắng dưới 4,5:1 (ADR 0043), và
`autoContrast` chỉ sửa chữ trên nút filled. Màu chính tự chọn vì vậy phải là bảng sắc độ do bản cài khai, đo tương
phản được.

Tương phản tính bằng công thức của `platform/web/src/contrast.ts` (cùng công thức với ADR 0043, 0048), Mantine 9.8.0,
ngày 2026-11-27:

| Cặp màu | Tỷ lệ | Mức cần |
|---|---|---|
| Viền ô nhập `gray.6` trên `blue.0` | 2,99:1 | 3:1 |
| Viền ô nhập `gray.6` trên `indigo.0`, `violet.0` | 2,96:1 | 3:1 |
| Viền ô nhập `gray.6` trên `grape.0` | 2,98:1 | 3:1 |
| Liên kết sắc 8 của bảng cam mẫu (`presets/dien-mat-troi`) trên nền sắc 0 của chính nó | 5,21:1 | 4,5:1 |
| Chữ trắng trên nút filled sắc 8 của bảng cam mẫu | 5,70:1 | 4,5:1 |

Các cách đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Tệp CSS riêng của bản cài đè biến của Mantine | Đổi được mọi thứ, nhưng không đo trước được; một giá trị sai làm cả giao diện dưới AA mà không ai biết |
| Mỗi biến một danh sách giá trị cố định | Kiểm thử đơn vị đo được mọi tổ hợp; không có màu cam |
| Danh sách cố định, riêng màu cho phép thêm mười sắc độ tự khai, đo lúc đọc tệp | Có màu riêng; tổ hợp có sắc độ tự khai chỉ đo được khi đọc tệp |

## Quyết định

**Biến mới trong `branding.json`** (`contracts/branding.schema.json`), đều không bắt buộc; không ghi thì giao diện như
trước:

- `color` (màu chính, vẫn bắt buộc) và `secondary_color` (màu phụ): tên một bảng màu trong danh sách của ADR 0043, hay
  mười mã `#rrggbb` từ sáng tới tối như một bảng màu Mantine. Sắc độ tự khai vào theme với tên `brand` (màu chính),
  `accent` (màu phụ).
- Màu phụ là màu của nút phụ (`variant` light, subtle không ghi `color`, ADR 0047) và của mục menu đang chọn; nút
  filled, liên kết, chữ màu giữ màu chính. Không khai màu phụ thì theme không đặt gì thêm cho `Button`, `NavLink`.
- `radius`: 6 (mặc định, thang của ADR 0048), 4 hay 8; là bo góc của nút, ô nhập, nhãn, thẻ và khung gấp đôi.
- `font`: `be-vietnam-pro` (mặc định, ADR 0048) hay `system` (phông của hệ điều hành). Chỉ phông đã đóng gói: CSP không
  cho tải phông từ nơi khác. Thêm phông là thêm thư viện, giấy phép và một giá trị vào danh sách.
- `background`: `gray` (mặc định, `gray.0`), `white`, hay `tint` (sắc 0 của màu chính). Nền này đặt qua biến
  `--mortise-page-background` cho `body`, khung trang đã đăng nhập (`Shell.tsx`) và màn hình trước đăng nhập
  (`App.tsx`). Trên nền `tint`, viền ô nhập đậm lên `gray.7`, vì `gray.6` dưới 3:1 trên sắc 0 của bốn bảng màu (bảng
  trên).

**Kiểm tương phản**:

- `platform/web/src/themeContrast.ts` dựng theme thật từ bộ biến, lấy biến CSS mà Mantine sinh, và đo mọi cặp chữ,
  nền: nút filled và khi di chuột, chữ màu và liên kết trên nền trắng và nền trang, chữ nút light, subtle của màu chính
  và màu phụ trên nền trắng, nền trang, nền nhạt, nền khi di chuột, mục menu đang chọn, chữ phụ, chữ gợi ý, nhãn trạng
  thái trên nền trang ở mức 4,5:1, viền ô nhập ở mức 3:1.
- `themeTokens.test.ts` chạy phép đo đó cho mọi tổ hợp màu chính × màu phụ (kể cả không khai) × nền mà schema cho phép
  (6 × 7 × 3 = 126 tổ hợp), và kiểm bo góc, phông không đổi biến màu nào. Bộ biến mặc định giữ đúng theme trước quyết
  định này; `theme.test.tsx` vẫn đo riêng như ADR 0043, 0048.
- Sắc độ tự khai chỉ đo được lúc đọc: `parseBranding` gọi cùng phép đo, một cặp dưới mức là bỏ cả tệp như trường sai,
  dùng thương hiệu mặc định và ghi cảnh báo trên console nêu từng cặp và tỷ lệ. Schema chỉ kiểm dạng (mười mã màu).
  Kiểm thử đơn vị đọc mọi tệp thương hiệu trong repo (`platform/web/brand/`, `contracts/examples/`,
  `presets/*/brand/`) và đòi chúng qua được.
- Danh sách giá trị của từng biến nằm ở schema và ở `branding.ts`; `make check-fast` báo lỗi khi hai nơi khác nhau.

**Thương hiệu mẫu của doanh nghiệp**: `presets/dien-mat-troi/brand/branding.json` ("Công ty Điện mặt trời Mẫu", hư
cấu): bảng cam tự khai, màu phụ `indigo`, bo 4px, nền `tint`. Thư mục này là giá trị của `MORTISE_BRANDING_DIR` cho
bản cài đó.

`/branding.json` vẫn đọc trước lần vẽ đầu và trước đăng nhập như ADR 0043.

## Hệ quả

- Bản cài đổi được màu chính, màu phụ, bo góc, phông, nền trang bằng dữ liệu, không dựng lại image; mọi tổ hợp có
  trong danh sách đã được đo.
- Tệp không ghi biến mới cho ra theme và màn hình đăng nhập giống hệt trước (so ảnh chụp màn hình đăng nhập ở
  1280 và 390px, ngày 2026-11-27).
- Sắc độ tự khai dưới AA chỉ lộ ra lúc chạy, bằng cảnh báo trên console và thương hiệu mặc định; người vận hành chưa có
  lệnh kiểm tệp trước khi gắn.
- Màu phụ không đổi màu nút filled hay nhãn trạng thái; nhãn trạng thái vẫn theo bộ nghĩa chung (ADR 0048).
- Ngoài phạm vi: sửa biến giao diện trên web, chế độ tối, trang đăng nhập của Keycloak.
