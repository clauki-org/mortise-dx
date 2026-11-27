<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0048. Kiểu "Bento dịu", bộ nghĩa màu chung cho nhãn trạng thái và phông Be Vietnam Pro đóng gói cùng giao diện

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Bộ quy ước của [ADR 0043](0043-design-tokens-and-install-branding.md) đạt AA cho chữ, nhưng trang vẫn là nền trắng với
thẻ trắng có bóng, các khối khó tách nhau. Viền ô nhập là mặc định `gray.4` của Mantine, viết cứng trong CSS của
Mantine, không qua theme. Liên kết chỉ gạch chân khi di chuột, nên trong bảng chỉ còn màu để nhận ra liên kết. Phông
là phông của hệ điều hành, nên chữ Việt có dấu trông khác nhau theo máy.

Nhãn trạng thái của [ADR 0047](0047-page-header-status-badge-formatting.md) có bốn nghĩa riêng của bảng việc và hồ sơ
(`overdue`, `active`, `done`, `neutral`). Thẻ số của bảng điều hành và giá trị của danh mục sẽ cần mức cảnh báo, mức xấu
theo khai báo của gói; nếu mỗi nơi tự đặt tên nghĩa thì cùng một màu đỏ mang hai tên.

Tương phản tính theo công thức độ chói tương đối của WCAG 2 (cùng công thức với `platform/web/src/theme.test.tsx`), trên
bảng màu mặc định của Mantine 9.8.0, ngày 2026-11-27:

| Cặp màu | Tỷ lệ | Mức cần |
|---|---|---|
| Viền ô nhập `gray.4` (mặc định) trên nền trắng | 1,49:1 | 3:1 (WCAG 2.2, 1.4.11) |
| Viền ô nhập `gray.6` trên nền trắng | 3,32:1 | 3:1 |
| Viền ô nhập `gray.6` trên nền trang `gray.0` | 3,15:1 | 3:1 |

Phông đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Giữ phông hệ điều hành | Không thêm tệp, nhưng chữ có dấu khác nhau theo máy |
| Tải từ dịch vụ phông bên ngoài | CSP chỉ cho nguồn cùng origin; thêm một bên thứ ba thấy địa chỉ của người dùng |
| Be Vietnam Pro đóng gói qua `@fontsource` | Thiết kế cho chữ Việt, OFL-1.1 (OSI); tệp nằm trong `assets/` cùng origin |

## Quyết định

**Kiểu "Bento dịu"** (`platform/web/src/theme.ts`, `theme.css`):

- Nền trang `gray.0`, đặt bằng quy tắc `body` trong `theme.css`. Không đổi `--mantine-color-body`, vì thẻ, khung, hộp
  thoại và thanh trên tô bằng biến đó và sẽ xám theo.
- `Card` có viền 1px, không bóng, bo 12px. Thang bo góc: `sm` 6px (mặc định của nút, ô nhập, `Badge`), `md` 12px (thẻ,
  khung); các trang vẫn đặt `radius="md"` cho khung nên đổi giá trị của bậc, không đổi trang.
- Viền ô nhập `gray.6` qua biến `--mortise-input-border` mà `theme.css` đọc, cùng dạng bộ chọn với quy tắc của Mantine
  và nạp sau. Quy tắc viền đỏ khi lỗi của Mantine cụ thể hơn nên vẫn thắng; viền khi có tiêu điểm đặt trên chính ô nhập
  nên cũng giữ.
- `Anchor` luôn gạch chân. Thẻ `<a>` không qua `Anchor` giữ gạch chân mặc định của trình duyệt, vì CSS của Mantine không
  bỏ nó.
- Chữ ba độ đậm: 400 chữ thường, 600 chữ nhấn (`Badge`), 800 tiêu đề. Thang cỡ chữ giữ như ADR 0043.
- Kiểm thử đơn vị đo viền ô nhập ≥ 3:1 trên nền trắng và `gray.0`, liên kết và chữ nút subtle của mọi màu thương hiệu
  ≥ 4,5:1 trên `gray.0`, và kiểm ô nhập thật của Mantine mang lớp `mantine-Input-wrapper` với `data-variant="default"`
  mà `theme.css` chọn.

**Phông**: Be Vietnam Pro từ `@fontsource/be-vietnam-pro` 5.3.0, ghim chính xác. `main.tsx` nạp ba độ đậm 400, 600, 800,
mỗi độ đậm gồm tập chữ Việt, Latin và Latin mở rộng; trình duyệt chỉ tải tập có ký tự trên trang. `vite.config.ts`
không bao giờ nhúng `.woff`, `.woff2` thành `data:`, vì CSP (`default-src 'self'`) chặn phông `data:`. Danh sách phông
của hệ điều hành đứng sau, dùng khi phông chưa tải xong hay không tải được. OFL-1.1 đòi bản phân phối kèm văn bản
giấy phép, nên bản build chép tệp `LICENSE` của gói ra `licenses/be-vietnam-pro-OFL-1.1.txt`. OFL-1.1 thêm vào
`WEB_LICENSES_SHIPPED` của Makefile và bảng "Thành phần đang chạy" của README. `scripts/deps-policy.toml` không đổi: nó chỉ có danh sách cho
thư viện Python và image, thư viện web kiểm bằng `make web-check`.

**Bộ nghĩa màu chung** (`platform/web/src/tones.ts`): `bad` đỏ, `warn` cam, `info` xanh dương, `ok` xanh lá, `neutral`
xám, ở biến thể light của Mantine. Kiểu `Tone`, danh sách `TONES` và bảng `TONE_COLOR` tách khỏi component để thành
phần khác dùng lại. `StatusBadge` nhận một nghĩa trong bộ này và luôn có chữ. Kiểm thử đơn vị lặp theo `TONE_COLOR`:
chữ của nhãn đạt 4,5:1 trên nền nhạt của nhãn, nền trắng và `gray.0` (tỷ lệ thấp nhất là `warn` trên nền nhạt,
6,32:1, ngày 2026-11-27), và không hai nghĩa chung một màu.

## Hệ quả

- Mọi trang có nền xám nhạt, thẻ và khung trắng viền mảnh bo 12px; nút, ô nhập, nhãn bo 6px; ô nhập thấy rõ viền;
  liên kết luôn gạch chân.
- Bản build thêm các tệp phông trong `assets/`; lần mở đầu tải thêm các tập phông mà trang dùng.
- Nghĩa của `StatusBadge` đổi tên: quá hạn là `bad`, đang diễn ra là `info`, đã xong là `ok`, `neutral` giữ nguyên.
- Độ đậm khác 400, 600, 800 trình duyệt lấy tệp gần nhất; vài trang bảng điều hành, danh mục còn đặt `fw` 500, 700 và
  sẽ đổi cùng thay đổi riêng của các trang đó.
- Viền của ô đánh dấu, nút chọn một và công tắc chưa đổi, vẫn là mặc định của Mantine.
- Kế hoạch: thẻ số của bảng điều hành và giá trị của danh mục dùng bộ nghĩa này qua khai báo của gói, quyết định ở ADR
  riêng. Giá trị của danh mục đã dùng, qua `tone` của từng lựa chọn
  ([ADR 0050](0050-catalog-tones-cards-form-help.md)).
