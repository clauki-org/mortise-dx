<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0050. Nghĩa màu cho giá trị của danh mục, dạng thẻ, chi tiết dạng lưới ô và dòng gợi ý của biểu mẫu

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

[ADR 0047](0047-page-header-status-badge-formatting.md) để cột trạng thái của danh mục là chữ thường vì Tầng 2 không
biết nghĩa của giá trị nghiệp vụ: "Đang sử dụng" và "Dôi dư" trông giống nhau trong bảng. [ADR 0048](0048-bento-tokens-status-tones-font.md)
đã có bộ nghĩa chung `bad | warn | info | ok | neutral` và ghi kế hoạch cho gói chọn nghĩa của giá trị qua khai báo.

Danh sách của danh mục chỉ có dạng bảng. Màn hình chi tiết vẽ mọi trường thành một bảng dọc hai cột, nhãn bên trái
rộng 240px, nên trên màn hình rộng giá trị ngắn nằm cách nhãn xa. Biểu mẫu ([ADR 0030](0030-form-component.md)) chỉ có
nhãn và một đoạn mô tả chung cho cả biểu mẫu: gói không có chỗ nói một trường điền theo đơn vị nào.

Các lựa chọn đã xét:

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Màu của giá trị | Gói khai tên màu của Mantine | Gói chọn được màu không đạt tương phản; cùng một màu mang hai nghĩa ở hai gói |
| | Gói khai một nghĩa trong bộ nghĩa chung cho từng lựa chọn (`tone`) | Màu và tương phản do Tầng 2 giữ, đã kiểm ở `theme.test.tsx`; nhãn luôn có chữ |
| Dạng thẻ | Thay bảng làm mặc định | Đổi đường đi của e2e và số lần bấm; bảng so sánh nhiều dòng tốt hơn |
| | Bảng mặc định, công tắc sang thẻ | Không đổi đường đi hiện có; thẻ dễ đọc trên màn hình hẹp |
| Mở chi tiết từ thẻ | Thêm nút "Mở" trên mỗi thẻ | Thêm một điểm dừng Tab cho mỗi dòng, hai đường cùng đích |
| | Giá trị cột đầu là liên kết như ở bảng | Cùng tên truy cập ở hai dạng, đường đi bằng bàn phím không đổi |
| Gợi ý của trường | `ui:help` của rjsf | Ô của Mantine tự đặt `aria-describedby` và đè danh sách của rjsf, nên dòng gợi ý không được gắn vào ô |
| | `ui:description`, rjsf-mantine đưa vào `description` của Mantine | Mantine vẽ dưới nhãn và tự gắn `aria-describedby`; kiểm ở `FormPanel.test.tsx` cho mọi kiểu trường |

## Quyết định

**Hợp đồng danh mục** (`contracts/catalog.schema.json`): mỗi mục của `choices` nhận thêm `tone` tùy chọn, một giá trị
trong `bad | warn | info | ok | neutral` của `tones.ts`. Giá trị có `tone` hiện thành `StatusBadge` với chữ của
lựa chọn ở bảng, thẻ và màn hình chi tiết; không khai thì hiện chữ thường như trước. `catalog.ts` kiểm lại `tone` lúc
chạy vì cấu hình đọc từ CSDL. Gói cơ sở vật chất xã khai `ok` cho "Đang sử dụng", `warn` cho "Dôi dư". Gói kho vật tư
không có trường trạng thái; trường "Loại" của vật tư khai `neutral` cho cả hai lựa chọn, vì loại không có mức tốt hay
xấu.

**Danh sách** (`CatalogTable.tsx`, `CatalogRows.tsx`): danh sách ngoài cùng có công tắc Bảng/Thẻ, một nhóm nút chọn
một tên "Kiểu hiển thị". Mặc định là bảng và đường dẫn không đổi; dạng thẻ ghi `view=cards` trên đường dẫn cùng tìm,
lọc, thứ tự, trang. Thẻ là mục của một danh sách: giá trị cột đầu là liên kết tới chi tiết, các cột sau là cặp nhãn,
giá trị; không nút "Mở", không ảnh, biểu tượng hay mô tả riêng. Ở dạng thẻ có ô "Sắp theo" (mỗi cột tăng, giảm dần),
đổi cùng thứ tự mà tiêu đề cột của bảng đổi, nên máy chủ vẫn xếp. Bảng đối tượng con giữ dạng bảng.

**Chi tiết** (`CatalogRecord.tsx`): mọi trường thành lưới ô (một, hai, ba cột theo bề rộng), mỗi ô nhãn trên, giá trị
dưới, viết bằng `dl`, `dt`, `dd` để trình đọc màn hình đọc cặp nhãn, giá trị. Bảng đối tượng con, nút và tài liệu
đính kèm không đổi.

**Hợp đồng biểu mẫu** (`contracts/form.schema.json`): mỗi trường nhận thêm `help` tùy chọn, một dòng chữ. `formConfig.ts`
đưa nó vào `ui:description`; ô danh sách đọc từ bảng (`SourceChoice.tsx`) tự đưa vào `description` của Mantine. Biểu
mẫu một cột, rộng tối đa 640px. Gói kho vật tư khai `help` cho trường "Số lượng" của đề nghị cấp vật tư.

Sửa [ADR 0047](0047-page-header-status-badge-formatting.md) (cột trạng thái của danh mục có màu theo `tone` của gói),
[ADR 0048](0048-bento-tokens-status-tones-font.md) (kế hoạch dùng bộ nghĩa cho giá trị của danh mục đã làm) và
[ADR 0030](0030-form-component.md) (trường có thêm `help`).

## Hệ quả

- Giá trị trạng thái của danh mục đọc được bằng màu và chữ; gói đổi nghĩa màu bằng một dòng khai báo.
- Đường dẫn, tên truy cập của liên kết, ô tìm, ô lọc và nút phân trang giống nhau ở hai dạng; e2e hiện có chạy ở dạng
  bảng mặc định, `package-menu.spec.ts` thêm bước chuyển sang thẻ và về bảng.
- Màn hình chi tiết thôi là bảng dọc; kiểm thử muốn tìm một trường thì tìm theo nhãn của ô, không theo dòng bảng.
- Thẻ chỉ hiện cột của `list.columns`; trường chỉ có ở chi tiết không lên thẻ.
- `help` chỉ là chữ; không liên kết, không định dạng.
