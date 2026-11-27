<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0064. Nạp dòng con từ tệp Excel hay CSV, xem trước lỗi theo dòng, thêm trong một lệnh

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27

## Bối cảnh

Nút "Thêm phòng" ([ADR 0054](0054-edit-and-add-child-from-catalog.md)) thêm từng dòng một. Một tòa có hàng chục phòng,
và cán bộ xã thường đã có danh sách đó trong Excel.

Ví dụ: ở tòa "NLV", cán bộ tải tệp mẫu, điền 40 phòng rồi chọn chính tệp đó. Xem trước phải báo dòng 12 thiếu diện
tích, dòng 30 trùng mã. Sửa xong thì cả 40 dòng vào trong một lần; lỗi thì không dòng nào vào.

| Câu hỏi | Lựa chọn | Đánh giá |
|---|---|---|
| Đặt ở đâu | Mục menu `import` riêng | Không biết dòng cha nào; người dùng phải gõ mã tòa vào từng dòng |
| | Nút của bảng con, cạnh nút thêm dòng con | Khóa của dòng cha có sẵn như nút thêm; cùng chỗ người dùng đang xem |
| Khai cột và cách kiểm | Khai riêng cột, kiểu, luật cho việc nạp | Hai nơi khai cùng một luật, dễ lệch với biểu mẫu nhập tay |
| | Một biểu mẫu theo `form.schema.json` | Dùng lại bộ kiểm, thông điệp lỗi, lời báo lỗi của Hasura và luật của `check-form-config.py` |
| Định dạng tệp | Chỉ CSV | Excel tiếng Việt lưu CSV bằng dấu chấm phẩy và dấu phẩy thập phân, bảng mã dễ sai; người dùng làm việc bằng .xlsx |
| | .xlsx bằng read-excel-file (MIT), CSV UTF-8 là phương án phụ | Đọc đúng ô số, ô ngày theo kiểu Excel; thư viện đã có trong repo cho e2e của ADR 0052 |
| Ghi | Mỗi dòng một lệnh | Lỗi giữa chừng để lại nửa tệp đã vào |
| | Một lệnh `insert_<bảng>(objects: […])` | Hasura chạy cả danh sách trong một giao dịch |

## Quyết định

- **Hợp đồng danh mục:** đối tượng con có thêm `import`, gồm:
  - `label`: chữ trên nút;
  - `max_rows`: số dòng tối đa mỗi lần nạp, trần 1.000;
  - `unique`: trường không được trùng, tùy chọn;
  - `form`: biểu mẫu theo `contracts/form.schema.json` có `submit.insert` trỏ tới bảng của loại con.

  Mỗi trường là một cột; tiêu đề cột là nhãn của trường. Cột `via` nhận khóa của dòng cha như nút thêm dòng con, không
  là trường. Trường chọn từ bảng (`source`) và kiểu `boolean` không nạp được, nên bị từ chối khi kiểm cấu hình.
- **Tệp mẫu .xlsx** sinh từ biểu mẫu bằng write-excel-file, chỉ khi bấm tải. Trang đầu chỉ có dòng tiêu đề. Trang
  "Hướng dẫn" ghi kiểu, có bắt buộc không, giới hạn, giá trị được nhận và dòng gợi ý (`help`) của từng cột.
- **Đọc tệp ngay trong trình duyệt**, không qua dịch vụ nào:
  - `.xlsx`: read-excel-file, bản `universal`, nạp động khi người dùng chọn tệp .xlsx. Bản `browser` dựng Web Worker
    mà CSP của giao diện không cho. Chỉ đọc trang đầu.
  - CSV: bộ tách tự viết theo RFC 4180, giải mã UTF-8 chặt (`fatal`), bỏ BOM, dấu phân cách là dấu phẩy hay chấm
    phẩy, đoán từ dòng tiêu đề.
  - Tệp lớn hơn 5 MB bị từ chối trước khi đọc.
- **Tệp .xlsx có phần nén giải ra từ 512 KB bị từ chối.** Theo mã nguồn của fflate 0.8.3 (thư viện giải nén của
  read-excel-file), phần như vậy được giải nén trong một Web Worker dựng từ `blob:`, mà CSP `worker-src 'self'` của
  giao diện không cho. Trình duyệt đọc danh mục của tệp zip trước và báo người dùng tách tệp. Điều kiện như của fflate
  nhưng xét mọi phần của tệp, kể cả phần read-excel-file bỏ qua, nên có thể chặn thừa. Không mở CSP cho `blob:`.
  `catalogImportFile.test.ts` kiểm một tệp 1.000 dòng, năm cột, ghi bằng write-excel-file, không chạm ngưỡng này.
- **Khớp và đổi ô:**
  - Tiêu đề khớp theo nhãn hay tên trường, không phân biệt hoa thường.
  - Thiếu cột bắt buộc, cột lạ hay cột trùng là lỗi cả tệp. Vượt `max_rows` hay không có dòng dữ liệu nào cũng vậy.
  - Dòng trống bị bỏ. Số dòng báo theo bảng tính: tiêu đề ở dòng 1, dữ liệu từ dòng 2.
  - Ô số gõ dạng chữ nhận dấu phẩy thập phân, và dấu chấm ngăn nghìn khi có cả hai dấu.
  - Ô ngày của Excel đọc theo UTC; ngày gõ dạng chữ là ngày/tháng/năm hay năm-tháng-ngày.
  - Lựa chọn nhận nhãn hay giá trị. Mã gõ là số trong ô số của Excel đọc lại thành chữ.
- **Kiểm từng dòng như biểu mẫu:** cùng JSON Schema (`formSchema`) và cùng bộ kiểm (`formValidator`), nên lời báo
  giống ô nhập tay ("Bắt buộc nhập", "Tối đa 50 ký tự").
- **Kiểm trùng trước khi gửi**, khi có `unique`:
  - giữa các dòng của tệp: mỗi dòng trùng chỉ tới các dòng còn lại;
  - với dòng con đã có của cùng dòng cha: đọc bằng vai trò của biểu mẫu, ngay lúc chọn tệp.

  Có thể có người thêm dòng trùng sau lần đọc đó. Khi ấy ràng buộc UNIQUE của bảng từ chối lệnh thêm và trang báo "Đã
  có dòng mang cùng mã".
- **Xem trước:** bảng có cột "Dòng" và từng cột của tệp. Ô sai có chữ "Lỗi: …" ngay dưới giá trị đã gõ; dòng sai ghi
  "(có lỗi)", không chỉ đổi màu. Có công tắc "Chỉ hiện dòng có lỗi". Còn lỗi thì nút nạp bị khóa.
- **Gửi một lệnh** `insert_<bảng>(objects: $objects)` bằng token người dùng, header `X-Hasura-Role` là vai trò của
  biểu mẫu. Cột `via` đặt sau cùng ở từng dòng. Số dòng Hasura trả phải bằng số dòng gửi. Bấm đúp chỉ gửi một lần.
- **Vai trò:** nút chỉ hiện khi token có vai trò của biểu mẫu; Hasura vẫn quyết định ai thêm được.
- **Kiểm theo gói lúc `make check-fast`** (`scripts/check-form-config.py`):
  - biểu mẫu thêm vào đúng bảng con; vai trò ghi được mọi trường và cột `via`; `via` không là trường;
  - không trường nào dùng `source` hay kiểu `boolean`; biểu mẫu không dùng `done.menu`;
  - `unique` là một trường; vai trò đọc được cột `via` và cột `unique`, vì lần kiểm trùng đọc hai cột đó.

  `catalog.ts` kiểm lại các luật tên và số dòng lúc chạy.
- **Gói xã:** bảng "Phòng" của tòa có nút "Nạp từ tệp" với cùng trường như "Thêm phòng", `unique: code` (như UNIQUE
  `(tenant_id, building_id, code)` của bảng), tối đa 200 dòng, vai trò `user`.
- **read-excel-file chuyển từ devDependencies sang dependencies**, ghim 9.3.14. Thư viện con: fflate, saxen,
  unzipper-esm, worker-f (MIT); graceful-fs (BlueOak-1.0.0, đã được phép từ ADR 0052) chỉ được bản Node dùng.
- **Cỡ tải:** đo bằng `npm run build` ngày 2026-11-27, phần đọc Excel là một tệp riêng 54,6 KB (gzip 13,7 KB), chỉ tải
  khi chọn tệp .xlsx; fflate nằm trong một tệp dùng chung với phần ghi Excel và bản đồ. Phần mã của hộp nạp nằm trong
  tệp chính.

## Hệ quả

- Gói thêm nạp từ tệp cho một bảng con bằng vài dòng cấu hình, dùng lại biểu mẫu thêm dòng con qua YAML anchor.
- Một lần nạp hoặc thêm mọi dòng hoặc không dòng nào. Nhật ký ([ADR 0009](0009-tamper-evident-audit-log.md)) ghi từng dòng như khi
  thêm tay.
- Chỉ thêm dòng mới: không sửa, không xóa dòng đã có, không gộp theo mã.
- Lần đọc dòng đã có dùng quyền đọc của vai trò biểu mẫu. Dòng mà người nạp không đọc được thì không được báo trùng
  trước; nếu trùng, ràng buộc của bảng vẫn chặn lúc gửi.
- Lời báo khi Hasura từ chối cả lệnh không chỉ ra dòng nào, vì Hasura chỉ trả thông điệp của PostgreSQL.
- Không có Idempotency-Key, như biểu mẫu thêm dòng ([ADR 0030](0030-form-component.md)). Mất kết nối sau khi gửi thì
  chọn lại tệp: lần kiểm trùng báo các mã đã vào.
- **Chưa kiểm:**
  - `e2e/catalog-import.spec.ts` (tệp mẫu, lỗi theo dòng, nạp bị từ chối cả lần, nạp được, axe, CSP) chưa chạy trên
    bản cài thật khi ghi quyết định này.
  - Tệp do Excel, LibreOffice lưu ra: kiểm tự động dùng tệp ghi bằng write-excel-file và CSV viết tay.
  - Trình duyệt xử lý worker của fflate thế nào khi CSP chặn: chưa thử, vì tệp như vậy bị từ chối trước khi đọc.
  - Firefox, Safari.
