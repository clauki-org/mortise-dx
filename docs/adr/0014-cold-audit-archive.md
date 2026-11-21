<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0014. Kho lạnh cho nhật ký thay đổi: Parquet trên SeaweedFS, truy vấn bằng DuckDB, chuỗi băm nối qua đoạn

- Trạng thái: Chấp nhận
- Ngày: 2026-11-17

## Bối cảnh

Nhật ký thay đổi (`core.audit_log`, ADR 0009) chỉ tăng. Để lâu trong CSDL nghiệp vụ thì bảng lớn dần, sao lưu và
truy vấn chậm dần, trong khi dòng cũ hiếm khi được đọc trừ lúc phân tích hay đối chứng. Cần chuyển dòng cũ xuống
kho rẻ hơn, vẫn truy vấn được, và vẫn kiểm được chuỗi băm.

| Lựa chọn | Đánh giá |
|---|---|
| Parquet trên SeaweedFS, truy vấn bằng DuckDB | Dùng kho đối tượng có sẵn; Parquet nén theo cột; DuckDB chạy trong tiến trình, không thêm máy chủ |
| Phân vùng bảng PostgreSQL theo tháng | Vẫn nằm trong CSDL nghiệp vụ, không giảm dung lượng sao lưu |
| Kho phân tích riêng (ClickHouse, Trino + Iceberg) | Thêm dịch vụ chạy thường trực cho một lượng dữ liệu nhỏ |

## Quyết định

- Công cụ `core/cold-archive` (Python, DuckDB 2.0.0) chạy theo lệnh của người vận hành, không thường trực: dịch vụ
  `cold-archive` trong profile `tools` của compose. Tiện ích `httpfs` và `postgres` của DuckDB cài sẵn lúc dựng
  image, nên chạy được trên máy không có internet. Không có route qua cổng: tệp chứa giá trị trước và sau của mọi
  tenant.
- `make archive BEFORE=<ngày>` xuất một đoạn: mọi dòng sau đoạn trước, tới dòng cuối cùng cũ hơn mốc. Cắt theo id vì
  nhật ký ghi lần lượt dưới một khóa (ADR 0009): thứ tự id là thứ tự chuỗi, id bỏ trống do rollback không làm đứt
  chuỗi. Tệp `audit_log/<id đầu>-<id cuối>.parquet` trong bucket `mortise-cold`.
- Dạng cột lấy từ chính PostgreSQL: jsonb ở dạng chữ chuẩn (`::text`), thời điểm là số micro giây từ epoch, băm
  dạng nhị phân. Đó đúng là những gì `core.audit_hash` băm, nên nạp lại vào PostgreSQL thì tính lại được đúng băm.
- Chỉ ghi nhận đoạn sau khi đọc lại tệp vừa ghi, nạp vào bảng tạm của PostgreSQL và kiểm, trong một giao dịch:
  số dòng bằng CSDL; băm tính lại khớp từng dòng; chuỗi liền, dòng đầu nối với băm cuối của đoạn trước; mỗi dòng
  khớp dòng cùng id trong CSDL. Không khớp thì không ghi nhận gì.
- Bảng `core.audit_segments` (chỉ được thêm, như nhật ký) giữ id đầu, id cuối, băm đầu (`first_prev`), băm cuối,
  số dòng, khóa tệp và SHA-256 của tệp; các đoạn không chồng nhau (ràng buộc loại trừ).
- `make cold-query SQL=…` cho bảng ảo `audit_all` gồm các tệp đã ghi nhận (không đọc cả thư mục, để tệp của lần
  xuất bị hủy không bị đếm) cộng các dòng còn trong CSDL sau đoạn cuối; cột `source` là `cold` hay `live`.
- SeaweedFS chạy với `-volume.max=100`: mặc định 8 volume, mà mỗi bucket chiếm vài volume ngay lần ghi đầu, nên
  bucket thứ hai không ghi được (đã gặp: lỗi 500 "No writable volumes").

Bổ sung ngày 2026-11-21 (#97):

- Ghi nhận đoạn xong, cùng giao dịch đó `core.audit_purge` xóa các dòng của đoạn khỏi `core.audit_log`. Trigger của
  `core.audit_log` chỉ cho xóa khi superuser chạy hàm này, hàm xóa đúng đoạn nó nhận, và đoạn được ghi nhận trong
  chính giao dịch đó. Chỉ superuser ghi nhận được đoạn: đoạn nối chuỗi qua các dòng đã xóa, nên ai ghi được đoạn
  giả là che được việc xóa. cold-archive chạy bằng tài khoản `postgres`; `hasura` (tài khoản Hasura dùng, chủ các
  bảng) không xóa được bằng lệnh DML nào. Đoạn ghi nhận trước khi có bổ sung này không bao giờ được xóa: dòng của
  chúng ở lại CSDL.
- Chuỗi băm nối qua phần đã xóa: băm trước của mỗi dòng mới lấy từ `core.audit_head` (băm của dòng mới nhất, dù dòng
  đó còn trong bảng hay đã chuyển đi), và mỗi lần ghi cập nhật dòng này. Ở REPEATABLE READ hay SERIALIZABLE, ràng
  buộc UNIQUE trên `prev_hash` không còn đủ chặn snapshot cũ khi dòng trùng đã bị xóa; cập nhật `core.audit_head`
  thì PostgreSQL báo lỗi tuần tự hóa. `core.audit_verify` nối dòng đầu tiên sau một đoạn vào băm cuối của đoạn đó.
  `make cold-verify` tính lại chuỗi bên trong mọi đoạn từ tệp, so SHA-256 của tệp và kiểm các đoạn nối liền nhau;
  `make restore` chạy bước này khi có đoạn.
- Băm neo của bản sao lưu: CSDL đã xóa hết dòng thì lấy băm cuối của đoạn cuối. Neo trùng dòng cuối của một đoạn thì
  đối chiếu với `core.audit_segments`; neo nằm giữa một đoạn đã xóa thì `core.audit_verify` trả một dòng riêng và
  `make audit-verify` đối chiếu neo qua tệp.
- Chủ bảng vẫn tắt được trigger bằng DDL (ADR 0009). Khi đó một đoạn giả che được việc xóa trong CSDL, nhưng
  `make cold-verify` không tìm được tệp khớp với đoạn đó, trừ khi người làm có cả quyền ghi bucket kho lạnh.

Đã thử ngày 2026-11-17: xuất 24 dòng rồi nạp lại, 24 băm khớp; hai đoạn liên tiếp (1–5, 8–8, id 6, 7 bỏ trống do
rollback) nối đúng chuỗi; truy vấn gộp đếm 6 dòng ở kho lạnh cộng 1 dòng trong CSDL, bằng 7 dòng của CSDL; sửa
`core.audit_segments` bị từ chối; DuckDB nạp tiện ích trong container không có mạng.

Đo ngày 2026-11-21 (#97) bằng `scripts/audit-measure.sh 2000` trên bản cài vừa `make reset`, `make seed`, cài gói
facilities-commune và `make seed-demo`; PostgreSQL 17.11, một máy phát triển 16 nhân. Nhật ký sinh bằng thao tác thật:
`user.a` sửa diện tích mọi phòng của xã A qua GraphQL ở cổng, 4.000 lần sửa (cộng rồi trừ 0,5 m²) trong 41 giây.
Truy vấn phân tích là số thay đổi theo bảng và ngày; thời gian do chính PostgreSQL (`EXPLAIN ANALYZE`, trung vị 5
lần) và DuckDB (`EXPLAIN ANALYZE` trên `audit_all`, trung vị 3 lần, không tính thời gian khởi động container) đo.

| | Số dòng trong CSDL | `core.audit_log` (gồm chỉ mục) | Truy vấn phân tích |
|---|---|---|---|
| Trước khi chuyển | 52.077 | 56.672.256 byte | PostgreSQL 16,7 ms |
| Ngay sau `make archive` | 0 | 56.672.256 byte | PostgreSQL 2,9 ms (bảng rỗng, còn trang chết) |
| Sau `VACUUM` | 0 | 9.273.344 byte | |
| Sau `VACUUM FULL` | 0 | 32.768 byte | |
| Kho lạnh | 52.077 dòng trong 1 tệp | 4.091.474 byte Parquet | DuckDB 7,4 ms trên `audit_all` |

- Xóa không trả lại chỗ ngay: `make archive` không chạy `VACUUM`. Autovacuum hay `VACUUM` cắt phần cuối bảng; chỉ
  `VACUUM FULL` (khóa bảng, chặn mọi lần ghi có nhật ký trong lúc chạy) mới thu gọn cả chỉ mục.
- Cùng 52.077 dòng, tệp Parquet nhỏ hơn bảng trong CSDL khoảng 14 lần.
- Số đo một lần trên một máy, một tập dữ liệu; chưa đo với đoạn nhiều triệu dòng hay bộ nhớ của lần xuất.

## Hệ quả

- Tự động chuyển theo lịch là kế hoạch; hiện người vận hành chạy `make archive`.
- Kho lạnh không làm mạnh thêm khả năng phát hiện sửa: ai giữ quyền ghi bucket và quyền chủ CSDL vẫn thay được tệp
  rồi sửa bảng đoạn. SHA-256 của tệp chỉ phát hiện thay tệp khi bảng đoạn còn nguyên.
- Tệp kho lạnh nằm trong bản sao lưu cùng SeaweedFS (bản sao lưu lớn dần theo kho lạnh); bảng đoạn nằm trong bản
  dump PostgreSQL. `-volume.max` chỉ là trần số volume, volume tạo khi cần.
- Hai lần `make archive` cùng lúc: lần sau dừng ngay (khóa advisory), không ghi đè tệp của lần trước.
- Công cụ dùng tài khoản `postgres` như `make backup`, vì nó là lệnh của người vận hành.
- Mỗi lần xuất đọc cả đoạn vào bộ nhớ để kiểm; đã xuất một đoạn 52.077 dòng (bảng trên), chưa đo bộ nhớ hay đoạn lớn hơn.
