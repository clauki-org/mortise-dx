<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0043. Bộ quy ước giao diện đạt tương phản AA và thương hiệu theo bản cài trong `/branding.json`

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Giao diện Tầng 2 ([ADR 0006](0006-frontend-stack.md)) dùng theme gần như mặc định của Mantine: màu chính `teal`, mỗi
thành phần tự đặt viền, bo góc, khoảng đệm cho thẻ và bảng. Tên "Mortise DX" viết cứng ở màn hình chờ đăng nhập, thanh
trên và tiêu đề tab, nên đơn vị cài đặt không hiện được tên, logo, màu của mình.

Tương phản tính theo công thức độ chói tương đối của WCAG 2 trên bảng màu mặc định của Mantine 9.8.0 (cùng công thức
với `platform/web/src/theme.test.tsx`, tính ngày 2026-11-27):

| Cặp màu | Tỷ lệ | AA (4,5:1) |
|---|---|---|
| Chữ trắng trên `teal.6` (nút chính hiện tại) | 2,55:1 | Không |
| Chữ `gray.6` (`c="dimmed"` hiện tại) trên nền trắng | 3,32:1 | Không |
| Chữ `gray.7` trên nền trắng | 8,18:1 | Đạt |
| Chữ trắng trên `blue.8` | 5,02:1 | Đạt |
| Chữ trắng trên `teal.8` | 3,95:1 | Không |

Mantine 9 dùng một sắc độ (`primaryShade`) cho mọi màu: nền nút filled là sắc đó, khi di chuột là sắc kế tiếp, liên
kết và chữ màu trên nền trắng là sắc đó; nút light, subtle và mục menu đang chọn là chữ sắc 9 trên nền sắc 1, di chuột
thì nền sắc 2.

Các cách giữ màu chính đạt AA đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Bật `autoContrast` của Mantine, cho chọn mọi bảng màu | Chỉ đổi màu chữ trên nút filled (thành đen trên nền sáng); liên kết, nút subtle, mục menu vẫn là chữ màu trên nền trắng và vẫn dưới AA với `teal`, `green`, `yellow`. Màu chữ nút đổi theo bản cài |
| Cho nhập mã màu tự do | Không kiểm trước được; một mã sai làm cả giao diện dưới AA |
| Sắc 8 và chỉ cho các bảng màu đạt AA ở mọi chỗ trên | Kiểm được bằng kiểm thử đơn vị; ít màu để chọn hơn |

## Quyết định

**Bộ quy ước giao diện** (`platform/web/src/theme.ts`):

- Một thang cỡ chữ (`xs`–`xl`, tiêu đề `h1`–`h4`), một thang khoảng cách theo bội 4px, một thang bo góc, một thang
  bóng; thành phần chỉ chọn bậc trong thang, không đặt số riêng.
- Phông của hệ điều hành (`system-ui` và các phông hệ thống theo nền tảng), không tải phông web. Được sửa theo
  [ADR 0048](0048-bento-tokens-status-tones-font.md): Be Vietnam Pro đóng gói cùng giao diện, phông hệ điều hành là dự phòng.
- Kiểu mặc định chung: `Card` có viền, bo góc `md`, đệm `lg`, bóng `xs`; `Paper` có viền, bo góc `md`; `Table`
  khoảng cách dòng `sm`, cột `md`. Khung trong hộp thoại của Mantine cũng có viền. Được sửa theo [ADR 0048](0048-bento-tokens-status-tones-font.md): `Card` không
  bóng, bậc `md` là 12px, bậc `sm` 6px là bo góc mặc định; nền trang `gray.0`, viền ô nhập `gray.6`, liên kết luôn gạch
  chân.
- `primaryShade` là 8 cho mọi màu. Chữ phụ (`--mantine-color-dimmed`) và chữ gợi ý trong ô nhập (`--mantine-color-placeholder`) là `gray.7`.
- Chữ của biến thể light (Alert, Badge light, nút light, subtle, mục menu đang chọn) là sắc 9 làm đậm thêm 30% cho
  mọi bảng màu: sắc 9 trên nền sắc 1 chỉ khoảng 2,7:1 với `yellow`, 3,6:1 với `orange`, 3,8:1 với `green`, và trên
  nền di chuột (sắc 2) dưới AA với cả `blue`, `indigo`, `violet`.
- `autoContrast` bật với ngưỡng độ chói 0,183: nền filled sáng hơn ngưỡng (`green`, `yellow`, `orange`, `teal`,
  `cyan`, `lime` ở sắc 8) mang chữ đen, còn lại chữ trắng. Chữ trắng đạt 4,5:1 khi độ chói không quá 0,1833, chữ đen
  khi từ 0,175, nên ngưỡng này cho nền nào cũng có một màu chữ đạt AA. Nền filled chữ đen sáng lên một sắc khi di
  chuột thay vì tối đi, vì sắc 9 làm chữ đen tụt dưới AA với `teal`, `cyan`.
- Kiểm thử đơn vị lấy màu từ biến CSS mà Mantine sinh cho theme thật (bộ sinh mặc định cộng `cssVariablesResolver`)
  và tính tương phản của mọi màu được phép: chữ trắng trên nút filled và khi di chuột, liên kết và chữ màu trên nền
  trắng và nền `gray.0`, chữ của nút light, subtle trên nền trắng, nền nhạt và nền khi di chuột, mục menu đang chọn;
  chữ phụ trên nền trắng và `gray.0`. Màu trạng thái (`green`, `yellow`, `orange`, `red`, `blue`, `teal`, `cyan`,
  `lime`, `gray`) được kiểm qua bộ chọn màu theo biến thể mà Alert, Badge gọi: filled và khi di chuột, light trên nền
  nhạt và khi di chuột, subtle trên nền trắng. Mục tiêu là AA cho chữ thường (4,5:1).

**Thương hiệu theo bản cài**:

- Hợp đồng `contracts/branding.schema.json`: `name` (tên đầy đủ), `short_name` (thanh trên trên màn hình hẹp), `logo`
  (không bắt buộc), `color`.
- `color` là tên bảng màu Mantine trong danh sách đạt AA ở sắc 8: `blue`, `indigo`, `violet`, `grape`, `pink`,
  `dark`. `red` đạt sát mức (4,51:1) và đã mang nghĩa lỗi nên không có trong danh sách. Danh sách nằm ở schema và ở
  `BRAND_COLORS` của `platform/web/src/branding.ts`; `make check-fast` báo lỗi khi hai nơi khác nhau.
- `logo` là `/brand/<tệp>` (`.svg`, `.png`, `.webp`): CSP của giao diện chỉ cho ảnh cùng origin, và `/brand/` là thư
  mục duy nhất người vận hành gắn vào được.
- Image `web` có `platform/web/brand/branding.json` ở `/brand/`; nginx trả nó tại `/branding.json` và mọi tệp trong
  `/brand/` với `Cache-Control: no-cache`, thiếu tệp thì 404. Bản này cũng là giá trị dự phòng biên dịch vào giao
  diện, nên tên "Mortise DX" chỉ nằm ở một chỗ.
- Ghi đè khi cài: `MORTISE_BRANDING_DIR` trong `.env` (mặc định `./platform/web/brand`) là thư mục compose gắn chỉ đọc
  vào `/brand/` của container `web`. Đặt `branding.json` và logo vào thư mục đó; trang tải sau thấy ngay, không dựng
  lại image. Đổi biến này thì chạy `make up` để compose gắn thư mục mới. Đường dẫn tương đối tính từ thư mục chứa
  `compose.yaml`; thư mục của bản cài nên nằm ngoài repo để đổi tag phát hành không đụng tới nó. Gắn cả thư mục thay vì một tệp, vì trình
  soạn thảo lưu bằng cách thay tệp và bind mount một tệp sẽ giữ tệp cũ.
- `src/main.tsx` đọc `/branding.json` trước lần vẽ đầu (chờ tối đa 5 giây), đặt `document.title`, màu chính và cung
  cấp tên, logo cho `Brand.tsx` (màn hình chờ đăng nhập, thanh trên). Không đọc được, không phải JSON (máy chủ phát
  triển trả `index.html` với mã 200), hay sai một trường thì dùng cả bản mặc định, không ghép từng trường.
- Ngoài phạm vi: trang đăng nhập của Keycloak vẫn là giao diện mặc định của Keycloak, không đọc `branding.json`.

## Hệ quả

- Màu chính mặc định đổi từ `teal` sang `blue`; nút chính, liên kết và chữ phụ đạt AA trên nền trắng.
- Mọi màu đặt qua `color=` (kể cả `red`, `green` của trạng thái) cũng dùng sắc 8, đậm hơn trước; chữ trên Alert và
  Badge light tối hơn màu gốc của Mantine.
- Badge, nút filled màu `green`, `yellow`, `orange` có chữ đen thay vì chữ trắng.
- Đơn vị chỉ chọn được sáu bảng màu. Muốn thêm màu riêng phải thêm bảng màu vào theme, vào danh sách và qua kiểm thử
  tương phản.
- Trang tải chậm thêm một yêu cầu `/branding.json` trước lần vẽ đầu.
- Thư mục `MORTISE_BRANDING_DIR` được phục vụ công khai ở `/brand/`; không đặt tệp khác vào đó.
- Việc tiếp: thương hiệu cho trang đăng nhập Keycloak (theme Keycloak riêng) là việc riêng, chưa làm.
