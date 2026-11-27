<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0049. Bảng điều hành dạng lưới Bento: mức độ của thẻ theo hằng số, vòng đo từ cột phần trăm, biểu đồ có trần

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27
- Sửa đổi: [ADR 0033](0033-dashboard-component.md), [ADR 0045](0045-readable-dashboard.md)

## Bối cảnh

Sau [ADR 0045](0045-readable-dashboard.md), bảng điều hành có khối chính số lớn và lưới hai cột, nhưng mọi thẻ vẫn cùng
một kiểu: thẻ phần vượt diện tích của xã trông giống thẻ diện tích được phép dù một số là xấu, một số không. Người xem
phải tự so "Đang dùng" với "Được phép" để biết xã dùng bao nhiêu phần. Biểu đồ đặt đầu thang ở số lớn nhất, nên độ ẩm
81% của thiết bị duy nhất hiện thành thanh đầy như 100%. Lưới hai cột với hai cỡ khối làm khối nhỏ (vài thẻ số) chiếm
nửa hàng dù chỉ cần một phần tư.

Ràng buộc giữ nguyên: Tầng 2 không chứa chữ hay ngưỡng của lĩnh vực nào; không con số nào người xem đọc được tính trên
trình duyệt ([ADR 0033](0033-dashboard-component.md)); màu không là tín hiệu duy nhất; thứ tự Tab bằng thứ tự nhìn; bộ
nghĩa màu chung của [ADR 0048](0048-bento-tokens-status-tones-font.md).

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Ai quyết định mức độ | View trả thêm cột mức độ | Mỗi ngưỡng một cột; đổi ngưỡng phải viết migration |
| | Thẻ khai `tone`, so số của thẻ với hằng số của gói | Ngưỡng nằm trong cấu hình của gói, đọc cùng chỗ với nhãn; so sánh không tạo ra số mới |
| Chữ đi cùng màu | Từ chung của Tầng 2 ("Cảnh báo", "Xấu") | Không nói số xấu vì sao; Tầng 2 không có từ đó sẵn |
| | `label` bắt buộc trong mỗi mức, do gói viết | Chữ đúng nghĩa của lĩnh vực, schema chặn mức không có chữ |
| Phần trăm của vòng đo | Trình duyệt chia value cho limit | Trái ADR 0033 |
| | Cột phần trăm của view, khai cùng value, limit | Gói quyết định làm tròn và trường hợp limit bằng 0 |
| Lưới khi khối bị ẩn theo vai trò | CSS grid `dense` | Lấp chỗ trống bằng khối sau, thứ tự nhìn khác thứ tự Tab |
| | Tính bề rộng trên các khối người xem thấy, nới khối cuối hàng | Không ô trống, không đảo thứ tự |

## Quyết định

- **Lưới bốn cột theo thứ tự khai** (`dashboardBento.ts`, `DashboardPanel.tsx`): `size` thêm `quarter` (một cột);
  `half` hai cột, `full` cả hàng, bỏ trống là `full`. Màn hình từ `lg` của theme có bốn cột, từ `md` hai cột
  (`quarter` một cột, còn lại cả hàng), hẹp hơn một cột. Bề rộng tính trên các khối mà token của người xem cho hiện:
  khối không vừa phần còn lại của hàng thì xuống hàng và khối trước nó nới ra hết hàng; khối cuối trang cũng vậy. Thẻ
  số trong khối chia cột theo bề rộng của khối, không theo màn hình.
- **Khối chính** chỉ là khối đầu tiên của `panels` (schema dùng `prefixItems`, khối sau phải có `primary` khác
  `true`), là thẻ số, `size` là `half` hay `full`. Thành phần không còn đưa khối chính lên đầu: thứ tự khai là thứ tự
  hiện.
- **Mức độ của thẻ**: `tone: { warn_when, bad_when }`, mỗi mức đúng một phép `gt`, `gte`, `lt`, `lte` với một hằng số
  và một `label`. Số của ô là số (hay chuỗi thập phân) và khớp mức thì viền và số mang màu chữ của nghĩa `warn` hay
  `bad` (`TONE_COLOR`, biến thể light, đạt AA trên nền trắng theo kiểm thử của ADR 0048), kèm `StatusBadge` ghi
  `label`. `bad` thắng `warn`; ô trống, không phải số hay không khớp thì thẻ không màu, không nhãn.
- **Vòng đo**: `gauge: { value, limit, percent, label }` trên khối thẻ số nguồn `graphql`, không ở khối `quarter`.
  `value`, `limit` phải là cột của một thẻ trong khối, nên số gốc luôn hiện bằng chữ; `percent` là cột của view. Một
  vòng đầy là 100%, phần trên 100% là vòng thứ hai bên trong, tối đa thêm một vòng; giữa vòng ghi phần trăm. Vòng dùng
  màu chính của theme, không đổi màu theo ngưỡng vì Tầng 2 không biết vượt 100% là xấu hay tốt. Tên đọc được của vòng
  gồm `label`, phần trăm và hai số gốc kèm nhãn, đơn vị của thẻ. Không có phần trăm thì ghi "Chưa có số liệu", không
  vẽ cung.
- **Biểu đồ có trần**: `chart.max` (lớn hơn 0) là đầu mút của thang; thanh của giá trị lớn hơn dài hết khung, số cạnh
  thanh và bảng số liệu vẫn ghi đúng giá trị. Bỏ trống thì thang tới số lớn nhất như ADR 0045.
- **Kiểm**: schema, `scripts/check-dashboard-config.py` (cột của vòng đo trong quyền đọc của vai trò; `value`, `limit`
  là cột của thẻ; `label` của mức độ và của vòng đo qua luật chữ của người xem) và `dashboardProblems` lúc chạy kiểm
  cùng các luật trên.

## Hệ quả

- Gói cơ sở vật chất xã: migration `20261127120000_area_summary_percent` thêm `in_use_percent` vào `area_summary`
  (đang dùng chia được phép, nhân 100, làm tròn tới hàng đơn vị; trống khi chưa có diện tích được phép); khối diện tích
  nửa hàng có vòng đo; phần vượt lớn hơn 0 có mức `bad` "Vượt định mức"; cơ sở chưa phân công, bước và việc quá hạn
  có mức; biểu đồ độ ẩm có trần 100. Khối được xếp lại để khối diện tích đứng đầu, khối của tỉnh cuối trang.
- `migrate:down` của migration đó phải xóa và tạo lại ba view đọc `area_summary`, vì Postgres không bỏ được cột của
  view.
- Chưa có mức độ cho thanh biểu đồ, chưa có mức `ok`, và chưa so một cột với cột khác: hai số so nhau thì gói tính
  hiệu hay phần trăm trong view rồi so cột đó với hằng số.
- e2e bảng điều hành so cả chữ mức độ trên thẻ và tên của vòng đo.
