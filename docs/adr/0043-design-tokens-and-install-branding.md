<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0043. Bộ quy ước giao diện đạt tương phản AA và thương hiệu theo bản cài trong `/branding.json`

- Trạng thái: Đề xuất
- Ngày: 2026-11-27

## Bối cảnh

Giao diện Tầng 2 ([ADR 0006](0006-frontend-stack.md)) dùng theme gần như mặc định của Mantine: màu chính `teal`, mỗi
thành phần tự đặt viền, bo góc, khoảng đệm cho thẻ và bảng. Tên "Mortise DX" viết cứng ở màn hình chờ đăng nhập, thanh
trên và tiêu đề tab, nên đơn vị cài đặt không hiện được tên, logo, màu của mình.

Tương phản tính theo công thức độ chói tương đối của WCAG 2 trên bảng màu mặc định của Mantine 9.8.0
(`platform/web/src/theme.test.ts`, chạy ngày 2026-11-27):

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
- Phông của hệ điều hành (`system-ui` và các phông hệ thống theo nền tảng), không tải phông web.
- Kiểu mặc định chung: `Card` có viền, bo góc `md`, đệm `lg`, bóng `xs`; `Paper` bo góc `md`; `Table` khoảng cách
  dòng `sm`, cột `md`.
- `primaryShade` là 8 cho mọi màu. Chữ phụ (`--mantine-color-dimmed`) là `gray.7`. Nền nhạt khi di chuột của màu chính
  giữ sắc 1 như lúc không di chuột, vì sắc 2 làm chữ sắc 9 tụt dưới AA với `blue`, `indigo`, `violet`.
- Kiểm thử đơn vị tính tương phản của mọi màu được phép ở sáu chỗ: chữ trắng trên nút filled và khi di chuột, chữ màu
  trên nền trắng và nền `gray.0`, chữ sắc 9 trên nền trắng và trên nền sắc 1; chữ phụ trên nền trắng và `gray.0`. Mục
  tiêu là AA cho chữ thường (4,5:1).

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
  lại image. Đổi biến này thì chạy `make up` để compose gắn thư mục mới. Gắn cả thư mục thay vì một tệp, vì trình
  soạn thảo lưu bằng cách thay tệp và bind mount một tệp sẽ giữ tệp cũ.
- `src/main.tsx` đọc `/branding.json` trước lần vẽ đầu (chờ tối đa 5 giây), đặt `document.title`, màu chính và cung
  cấp tên, logo cho `Brand.tsx` (màn hình chờ đăng nhập, thanh trên). Không đọc được, không phải JSON (máy chủ phát
  triển trả `index.html` với mã 200), hay sai một trường thì dùng cả bản mặc định, không ghép từng trường.
- Ngoài phạm vi: trang đăng nhập của Keycloak vẫn là giao diện mặc định của Keycloak, không đọc `branding.json`.

## Hệ quả

- Màu chính mặc định đổi từ `teal` sang `blue`; nút chính, liên kết và chữ phụ đạt AA trên nền trắng.
- Mọi màu đặt qua `color=` (kể cả `red`, `green` của trạng thái) cũng dùng sắc 8, đậm hơn trước. Màu trạng thái
  không nằm trong danh sách thương hiệu và chưa được kiểm tương phản ở đây.
- Nút light của màu chính không đổi nền khi di chuột; con trỏ vẫn đổi hình.
- Đơn vị chỉ chọn được sáu bảng màu. Muốn thêm màu riêng phải thêm bảng màu vào theme, vào danh sách và qua kiểm thử
  tương phản.
- Trang tải chậm thêm một yêu cầu `/branding.json` trước lần vẽ đầu.
- Thư mục `MORTISE_BRANDING_DIR` được phục vụ công khai ở `/brand/`; không đặt tệp khác vào đó.
- Việc tiếp: thương hiệu cho trang đăng nhập Keycloak (theme Keycloak riêng) là việc riêng, chưa làm.
