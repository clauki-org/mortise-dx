<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0047. Đầu trang, nhãn trạng thái và định dạng ngày giờ, số dùng chung cho các trang

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Các trang danh mục, chi tiết, biểu mẫu, bảng việc, theo dõi hồ sơ, trợ lý và bản đồ tự dựng tiêu đề: có trang để bộ
lọc bên phải tiêu đề, có trang để dưới; nút việc chính của màn hình chi tiết nằm dưới tiêu đề, của trang khác nằm cuối.
Nhãn hạn và nhãn kết thúc tự chọn màu ở từng tệp. Ngày giờ có hai kiểu: bảng việc và hồ sơ viết năm hai chữ số
(`dateStyle: "short"`), danh mục viết năm bốn chữ số. Trợ lý hỏi dữ liệu luôn hiện câu GraphQL ngay dưới bảng kết quả,
nên mã kỹ thuật chiếm chỗ ngang bảng.

## Quyết định

- `PageHeader.tsx`: đường về (breadcrumb hay liên kết) ở trên, tiêu đề là h1 duy nhất của trang lấy nguyên chữ của cấu
  hình, dòng nhãn và mô tả ngắn dưới tiêu đề, việc chính (nút, bộ lọc chính) bên phải; màn hình hẹp thì việc chính
  xuống dưới. Mọi trang kể trên dùng nó; nút khởi tạo quy trình của màn hình chi tiết và bộ lọc trạng thái của trang
  hồ sơ chuyển lên chỗ việc chính như bộ lọc hạn của bảng việc. Nút đầu tiên của màn hình chi tiết là nút chính
  (kiểu filled), nút sau là nút phụ, như các nút quyết định của màn hình xử lý việc.
- `StatusBadge.tsx` cho trạng thái mà Tầng 2 tự biết: hạn của việc, bước và kết quả của hồ sơ. Trang chọn nghĩa, không
  chọn màu: đỏ là quá hạn, xanh dương là đang diễn ra (còn hạn, đang chờ, đang xử lý), xanh lá là đã xong, xám là không
  có hạn hay đã dừng. Được sửa theo [ADR 0048](0048-bento-tokens-status-tones-font.md): nghĩa lấy từ bộ nghĩa chung `bad | warn | info | ok | neutral`
  (`tones.ts`); quá hạn là `bad`, đang diễn ra là `info`, đã xong là `ok`, không có hạn hay đã dừng là `neutral`. Cột trạng thái của danh mục vẫn là chữ theo `choices` của gói; hợp đồng danh mục không thêm trường
  màu cho từng giá trị.
- `format.ts` định dạng ngày giờ và số theo vi-VN cho các trang kể trên: năm bốn chữ số, ngày không giờ đọc theo UTC,
  chuỗi không đọc được hiện nguyên. Danh mục, bản đồ, bảng việc, hồ sơ, cỡ tệp đính kèm đọc từ đây; `steps.ts` đưa lại
  `dateTime` cho bảng điều hành. Số của bảng điều hành (`dashboardConfig.ts`, ba chữ số thập phân) chưa chuyển sang.
- `TableScroll.tsx`: bảng rộng hơn màn hình cuộn ngang trong một vùng có nhãn nhận được tiêu điểm bàn phím, thay khung
  cuộn của Mantine vốn giấu thanh cuộn trên điện thoại nên cột bên phải trông như mất. Ô giá trị ngắn không khoảng
  trắng (mã, số hiệu) không xuống dòng; giá trị trống hiện một gạch mờ, trình đọc màn hình đọc "Chưa có".
- Câu truy vấn của trợ lý hỏi dữ liệu nằm trong phần "Xem câu truy vấn" (thẻ `details`), đóng sẵn khi có kết quả, mở
  sẵn khi câu bị từ chối vì lý do từ chối trỏ tới phần tử trong câu. Người hỏi vẫn một lần bấm là đối chiếu được câu
  đã chạy với điều mình hỏi (ADR 0027).

## Hệ quả

- Các trang của kịch bản demo cùng bố cục đầu trang, cùng kiểu nhãn và ngày giờ. Ngày giờ trên bảng việc, hồ sơ và
  dòng "đếm lúc" của bảng điều hành đổi từ năm hai chữ số sang bốn chữ số.
- e2e của trợ lý dữ liệu mở "Xem câu truy vấn" trước khi kiểm câu đã chạy.
- Màu của trạng thái nghiệp vụ trong danh mục (ví dụ "Đang dùng") chưa thống nhất được vì Tầng 2 không biết nghĩa của
  giá trị; muốn có thì cần một trường mới trong hợp đồng danh mục, quyết định riêng. Trường đó sẽ chọn trong bộ nghĩa
  chung của [ADR 0048](0048-bento-tokens-status-tones-font.md).
- Khung trang và bảng điều hành chưa dùng `PageHeader`; chúng chuyển sang ở thay đổi sau.
