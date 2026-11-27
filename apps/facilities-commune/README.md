<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Gói cơ sở vật chất xã (`facilities-commune`)

Gói Tầng 3 minh họa: mỗi xã là một tenant quản lý các cơ sở nhà, đất (trụ sở) của mình, gồm cơ sở → tòa → phòng,
với diện tích thông thủy và loại diện tích của từng phòng để tính tiêu chuẩn, định mức. Gói chỉ gồm khai báo: tệp
`app.yaml`, lược đồ CSDL và metadata Hasura; không có mã chạy riêng.

## Bố cục

```
app.yaml             khai báo gói theo contracts/app.schema.json: lược đồ, thư mục migration, Hasura, quy trình,
                     settings (ngưỡng, thời hạn) và menu
schema/migrations/   migration dbmate của gói; bảng theo dõi public.facilities_commune_schema_migrations (ADR 0005)
hasura/tables.yaml   bảng đăng ký, quan hệ và quyền theo tenant và phân công, cùng định dạng với core/hasura/
catalog/             cấu hình thành phần danh mục (cơ sở → tòa → phòng) theo contracts/catalog.schema.json
map-layers/          cấu hình thành phần bản đồ (trụ sở tô theo phần vượt) theo contracts/map.schema.json
dashboards/          cấu hình bảng điều hành (diện tích, hồ sơ, độ ẩm của xã, tổng hợp cho tỉnh) theo
                      contracts/dashboard.schema.json
assistant/           cấu hình trợ lý hỏi dữ liệu (diện tích của xã, cơ sở được phân công) và hỏi văn bản theo
                     contracts/assistant.schema.json
knowledge/           văn bản pháp luật cho trợ lý hỏi văn bản theo contracts/knowledge.schema.json
cases/               trang hồ sơ rà soát đã lập theo contracts/cases.schema.json
bpmn/                quy trình BPMN của gói, deploy cho từng tenant khi cài
workflows/           khai báo bước của từng quy trình theo contracts/workflow.schema.json
authorities/         bảng phân cấp mặc định của bước quyết định theo contracts/authority.schema.json (ADR 0028)
rules/               luật ngưỡng của số đo thiết bị theo contracts/threshold-rule.schema.json
tests/smoke.sh       kiểm qua cổng: cách ly tenant, tenant lấy từ token, phân công, khóa ngoại ghép, RESTRICT,
                     nhật ký, phần vượt, tọa độ, tổng hợp cho tỉnh, trợ lý hỏi dữ liệu; mở việc kiểm tra kho khi độ ẩm vượt ngưỡng
                     (số đo gửi qua MQTT); gọi tests/workflow.sh kiểm quy trình rà soát
```

## Dữ liệu

Lược đồ `app_facilities_commune`.

| Bảng | Nội dung | Ràng buộc chính |
|---|---|---|
| `facilities` | Cơ sở nhà, đất của một xã; `status` là `in_use` (đang dùng) hoặc `surplus` (dôi dư, không còn dùng); `latitude`, `longitude` là tọa độ WGS 84, trống khi chưa đo ([ADR 0020](../../docs/adr/0020-facility-locations.md)) | `UNIQUE (tenant_id, code)`; `tenant_id` tham chiếu `core.tenants`; tọa độ trong miền hợp lệ, có đủ cả hai hoặc trống cả hai |
| `buildings` | Tòa trong một cơ sở | Khóa ngoại ghép `(tenant_id, facility_id)`, `ON DELETE RESTRICT` |
| `rooms` | Phòng, với `clear_area_m2` (thông thủy) và `area_type`: `working`, `shared`, `specialized` | Khóa ngoại ghép `(tenant_id, building_id)`, `ON DELETE RESTRICT` |
| `working_area_norms` | Phụ lục mức m² theo chức danh của NĐ 369/2026/NĐ-CP, STT 1–10, chép nguyên văn cả ghi chú; dữ liệu chung, không đăng ký trong Hasura | Khóa chính `row_no` (STT) |
| `staffing` | Biên chế được giao của xã: chức danh, dòng phụ lục (`norm_row`), số người | `UNIQUE (tenant_id, position)`; `norm_row` tham chiếu `working_area_norms` |
| `specialized_allowances` | Diện tích chuyên dùng do cấp có thẩm quyền quyết định, kèm căn cứ | `UNIQUE (tenant_id, name)` |
| `staffing_allowances` (view) | Mỗi dòng biên chế kèm mức m², diện tích được phép và trích dẫn dòng phụ lục | Chỉ đọc |
| `area_summary` (view) | Mỗi xã một dòng: làm việc, sử dụng chung, chuyên dùng, được phép, đang dùng, dôi dư, phần vượt, phần trăm đang dùng so với được phép (làm tròn, trống khi chưa có diện tích được phép) | Chỉ đọc |
| `facility_status_counts` (view) | Mỗi xã và trạng thái (`in_use`, `surplus`) một dòng: số cơ sở, tổng diện tích thông thủy | Chỉ đọc; mọi vai trò trong xã |
| `area_by_type` (view) | Mỗi xã và loại diện tích một dòng: đang dùng, được phép (lấy từ `area_summary`); chỉ để đối chiếu, phần vượt tính trên tổng | Chỉ đọc; mọi vai trò trong xã |
| `facility_coverage` (view) | Mỗi xã một dòng: số cơ sở, số cơ sở chưa có người phụ trách, chưa có người duyệt | Chỉ đọc; `manager`, `tenant_admin` |
| `facility_assignments` | Phân công: `user_id` (`sub` của cán bộ trong token) phụ trách (`custodian`) hay duyệt (`approver`) một cơ sở | Khóa ngoại ghép `(tenant_id, facility_id)`, `ON DELETE CASCADE`; `UNIQUE (tenant_id, facility_id, user_id, duty)` |
| `area_rollup` (view) | Mỗi xã có tenant cha một dòng, lấy nguyên số của `area_summary`, kèm `parent_tenant_id` và tên xã | Chỉ đọc; chỉ vai trò `rollup_reader` của tenant cha đọc ([ADR 0016](../../docs/adr/0016-parent-tenant-rollup.md)) |
| `facility_rollup` (view) | Mỗi cơ sở đang dùng của xã có tenant cha một dòng: mã, tên, tọa độ, phần vượt của cả xã | Chỉ đọc; chỉ vai trò `rollup_reader` của tenant cha đọc ([ADR 0020](../../docs/adr/0020-facility-locations.md)) |

Khóa ngoại ghép kèm `tenant_id` làm CSDL tự chặn việc nối tòa, phòng hay phân công vào cơ sở của xã khác, dù lớp
API có lọt. Mọi quyền Hasura lọc theo tenant trong token trước, rồi xét phân công
([ADR 0015](../../docs/adr/0015-assignment-as-data.md)):

| Vai trò | Được làm |
|---|---|
| `user` | Thấy cơ sở có phân công của mình cùng tòa, phòng của nó; nhiệm vụ `custodian` sửa cơ sở, thêm, sửa, xóa tòa và phòng; đọc phân công của chính mình |
| `manager` | Chỉ đọc toàn xã |
| `tenant_admin` | Đọc, ghi toàn xã; thêm, xóa phân công |

Vai trò khác `user` gửi kèm header `X-Hasura-Role`. Cột `tenant_id` không nhận từ dữ liệu gửi lên mà gán từ token.
Mọi bảng xã nhập gắn nhật ký thay đổi (`core.audit_attach`, ADR 0009): mỗi thao tác qua Hasura ghi lại `sub` của
token và vai trò.

Biên chế, diện tích chuyên dùng và hai view diện tích không gắn với cơ sở nên không xét phân công: mọi vai trò
trong xã đọc được; `user` và `tenant_admin` sửa được biên chế, diện tích chuyên dùng.

Mỗi cơ sở có quan hệ `summary` tới dòng `area_summary` của xã mình, nên đọc được phần vượt của xã cùng với cơ sở
(ví dụ để tô màu cơ sở trên bản đồ) mà quyền vẫn là quyền của từng bên.

## Hỏi dữ liệu

Mục menu "Hỏi dữ liệu cơ sở" (`ask-data`, `assistant/ask-data.yaml`, [ADR 0027](../../docs/adr/0027-data-assistant-guarded-graphql.md))
có ba câu mẫu: phần vượt của xã, cơ sở mình phụ trách, cơ sở dôi dư. Bấm là chạy câu GraphQL chỉ đọc trên view
`area_summary` và bảng `facilities` bằng token người hỏi, nên cán bộ chỉ thấy số của xã mình và cơ sở mình được phân
công; kết quả là bảng kèm câu truy vấn đã chạy. Tên cơ sở hiện nguyên văn trong ô, dù chứa chữ trông như lệnh. Smoke
của gói kiểm cán bộ xã A hỏi đúng mã cơ sở của xã B không nhận dòng nào, câu xóa biên chế bị guard chặn, và nhật ký
câu hỏi không chứa dòng dữ liệu.

## Hỏi văn bản

Mục menu "Hỏi văn bản" (`ask-documents`, `assistant/ask-documents.yaml`,
[ADR 0021](../../docs/adr/0021-document-assistant.md)) trả lời bằng câu trích nguyên văn của hai văn bản ở
`knowledge/`, mỗi đoạn là một khoản:

| Tệp | Văn bản | Các đoạn |
|---|---|---|
| `nd-155-2025.yaml` | NĐ 155/2025/NĐ-CP | Điều 3 khoản 1 tới 5 |
| `nd-369-2026.yaml` | NĐ 369/2026/NĐ-CP | Điều 2 khoản 1, 2 (sửa khoản 2, 3 Điều 3 NĐ 155); Điều 3 (Điều 3a khoản 1 tới 4 bổ sung vào NĐ 155); Điều 4 (Điều 3b khoản 1 tới 4); Điều 10 khoản 3; Điều 11 khoản 1 |

Điều 3a, 3b chỉ có nguyên văn trong NĐ 369, nên nằm ở văn bản NĐ 369 cho khớp mã băm của tệp đó; nhãn đoạn ghi điều,
khoản của NĐ 155 mà đoạn trở thành. Khoản 2, 3 Điều 3 NĐ 155 khai `superseded_by` trỏ tới Điều 2 khoản 1, 2 NĐ 369;
khoản 5 bị bãi bỏ, không có đoạn nào viết lại, nên trỏ tới Điều 10 khoản 3 NĐ 369 là khoản bãi bỏ nó. Trợ lý không
trích ba đoạn đó. Chưa nạp: phụ lục của hai nghị định, Điều 12 (chuyển tiếp) NĐ 369 và NĐ 186/2025.

Nguồn là tệp PDF trên datafiles.chinhphu.vn ghi ở `source.url`, tải ngày 2026-11-27; `source.sha256` là SHA-256 của
tệp tải về. Hai tệp là bản quét có chữ ký số, không có lớp chữ: chữ lấy bằng `pdftoppm` và `tesseract -l vie`, rồi
soát từng dòng với ảnh trang 300 dpi (NĐ 155 trang 2, 3; NĐ 369 trang 1 tới 7, 12, 13), sửa lỗi dấu, số và ký hiệu
của OCR theo ảnh. Phần sửa đổi trong bản gốc đặt trong ngoặc kép; `text` bỏ ngoặc kép bao ngoài và số khoản ở đầu
(số nằm ở nhãn); "m" kèm số 2 viết trên được ghi là "m²".

## Bảng điều hành

Mục menu "Bảng điều hành" (`dashboard`, `dashboards/overview.yaml`, [ADR 0033](../../docs/adr/0033-dashboard-component.md))
hiện diện tích được phép, đang dùng, phần vượt và dôi dư của cả xã (`area_summary`), số cơ sở theo trạng thái
(`facility_status_counts`), diện tích theo loại (`area_by_type`), biên chế và diện tích chuyên dùng. Khối diện tích là
khối chính, số lớn trên cùng, có vòng đo phần trăm đang dùng so với được phép (cột `in_use_percent` của
`area_summary`); thẻ phần vượt lớn hơn 0 tô đỏ kèm chữ "Vượt định mức", thẻ chưa phân công, bước hay việc quá hạn lớn
hơn 0 cũng có màu và chữ; biểu đồ độ ẩm có thang tới 100 ([ADR 0049](../../docs/adr/0049-bento-dashboard.md)). Cách
tính và câu truy vấn đã gửi của mỗi khối nằm trong "Xem cách tính"
([ADR 0045](../../docs/adr/0045-readable-dashboard.md)). Số tính cho cả xã, kể cả với cán bộ chỉ được phân công một phần cơ sở. Lãnh đạo xã
(`manager`) thấy thêm số cơ sở chưa có người phụ trách, chưa có người duyệt (`facility_coverage`). Tỉnh
(`rollup_reader`) thấy biểu đồ và bảng số của từng xã con (`area_rollup`); các xã không được cộng lại.

Khối đọc qua API của lõi ([ADR 0035](../../docs/adr/0035-case-counts-and-device-readings-on-dashboards.md)): lãnh đạo xã
thấy số hồ sơ rà soát (tổng và theo bước) và số hồ sơ kiểm tra kho do luật ngưỡng mở, do workflow-api đếm; số đó là số
hồ sơ, không phải số lần đo vượt ngưỡng. Mọi người thấy số việc rà soát đang chờ chính mình và độ ẩm mới nhất của từng
thiết bị của xã.

## Diện tích được phép và phần vượt

Căn cứ: Nghị định 155/2025/NĐ-CP, sửa đổi, bổ sung bởi Nghị định 369/2026/NĐ-CP (hiệu lực 11/11/2026). View
`area_summary` tính cho từng xã:

- Làm việc: tổng số người theo biên chế nhân mức m² của dòng phụ lục (Điều 5; phụ lục của NĐ 369 thay Phụ lục I, II
  của NĐ 155). Chức danh nào thuộc dòng nào do xã xác định theo Quy định 368-QĐ/TW hoặc văn bản của cấp có thẩm
  quyền (Điều 3 khoản 2, sửa bởi NĐ 369): phụ lục không ghi tên chức danh cấp xã, nên gói không tự suy ra.
- Sử dụng chung: bằng phần làm việc, mức tối đa 100% (Điều 6 khoản 2 điểm a, sửa bởi NĐ 369). Phần bù theo diện tích
  tối thiểu của Tiêu chuẩn quốc gia (điểm b) chưa tính.
- Chuyên dùng: tổng các dòng `specialized_allowances` (Điều 7).
- Đang dùng: tổng diện tích thông thủy các phòng của mọi cơ sở `in_use` (Điều 3 khoản 3, sửa bởi NĐ 369: tính trên
  tổng các trụ sở). Cơ sở `surplus` cộng riêng vào `surplus_m2`.
- Phần vượt: đang dùng trừ được phép, không âm.

Bản gốc đã đối chiếu (tải ngày 2026-11-19 từ cổng văn bản của Chính phủ; không lưu trong repo):

| Văn bản | Tệp | SHA-256 |
|---|---|---|
| NĐ 155/2025/NĐ-CP | https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/155-cp.signed.pdf | `b5cf65d96ea278c83150db0490d57b9522dd0a505a6c6e369c650499fff4765b` |
| NĐ 369/2026/NĐ-CP | https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/9/369_2026_nd-cp_25092026-signed.signed.pdf | `83bb37181f6a8f2c3bcc9a7824321a6501817af8b19e146a18edf6949c918500` |

## Quy trình rà soát

`bpmn/facilities-review.bpmn20.xml` (khóa `facilities-review`). Cán bộ mở một cơ sở trong mục "Cơ sở nhà, đất",
bấm "Lập hồ sơ rà soát", xem lại các giá trị rồi gửi (nút khai trong `catalog/facilities.yaml`,
[ADR 0026](../../docs/adr/0026-start-process-from-catalog-row.md)). Hồ sơ mang các biến `title` (tên cơ sở),
`facilityId` (id của cơ sở) và `excessM2` (phần vượt tiêu chuẩn, định mức, m²). Người có vai trò `manager` trong cùng
xã duyệt; người lập không tự duyệt được (bốn mắt).

`excessM2` là phần vượt của cả xã trong view `area_summary`, đọc qua quan hệ `summary` của cơ sở, nên mọi cơ sở
trong một xã mang cùng số. Lý do: diện tích đang dùng tính trên tổng các trụ sở (Điều 3 khoản 3 NĐ 155/2025/NĐ-CP,
sửa bởi NĐ 369/2026/NĐ-CP, mục trên), không tính riêng từng cơ sở.

- **Phần vượt từ ngưỡng trở xuống** (`review_report`): duyệt xong là kết thúc ở "báo cáo để tiếp tục sử dụng".
- **Phần vượt trên ngưỡng** (`review_publish`): duyệt xong thì công khai trong thời hạn, không có bước nào cho người
  dùng. Hết hạn thì `manager` của xã làm bước `submit`, trình người có thẩm quyền kèm đơn vị đề nghị nhận; rồi người
  có thẩm quyền theo bảng phân cấp làm bước `decide`, ghi nhận quyết định, và hồ sơ kết thúc ở "đã có quyết định".
- **Phần vượt thiếu hay âm:** đi nhánh công khai.
- **Phần vượt không đọc được thành số:** không lập được hồ sơ, API quy trình trả 502.

Nhánh được chọn ngay khi lập hồ sơ, trước bước duyệt: người duyệt gửi kèm biến khi duyệt cũng không đổi được nhánh.

```
lập hồ sơ ─┬─ vượt ≤ ngưỡng ─ review_report ─┬─ duyệt ─── báo cáo để tiếp tục sử dụng
           │                                 └─ trả lại ─ trả lại
           └─ vượt > ngưỡng, ── review_publish ─┬─ duyệt ─── công khai (hẹn giờ) ─ submit ─ decide ─ đã có quyết định
              thiếu hay âm                      └─ trả lại ─ trả lại
```

Bước `decide` chỉ có một nút, "Ghi nhận quyết định", với nội dung quyết định ở trường `decision`; sau bước này không
có cổng rẽ nhánh. Người lập không tự quyết định hồ sơ của mình (bốn mắt). Mỗi bước khai trong BPMN trường nó ghi
(`flowable:formProperty`, [ADR 0031](../../docs/adr/0031-step-fields.md)): `decision` và `decided` là trường của
`decide`, nên workflow-api từ chối người lập gửi chúng lúc lập hồ sơ, và người duyệt hay người trình gửi chúng khi
hoàn thành bước của mình. `comment` là trường chung của hai bước duyệt và bước trình, nên bước nào trong ba bước đó
cũng ghi được.

Người lập theo dõi hồ sơ ở mục menu "Hồ sơ rà soát đã lập" (`cases/reviews.yaml`, thành phần `cases`,
[ADR 0032](../../docs/adr/0032-case-tracking-for-initiators.md)): bước đang chờ (kể cả "Công khai"), vai trò hay đơn
vị đang xử lý, các bước đã qua và kết quả, cùng phần vượt (`details` của bước duyệt). Ý kiến, nơi nhận và quyết định
là trường của bước nên không hiện cho người lập.

### Bảng phân cấp của bước quyết định

Vai trò làm bước `decide` không viết trong BPMN mà lấy từ bảng phân cấp của xã
([ADR 0028](../../docs/adr/0028-step-authority-table.md)): BPMN ghi `candidateGroups="${authority_decide}"`,
workflow-api chọn dòng lúc lập hồ sơ và đặt biến `authority_decide`. Dòng mặc định ở
`authorities/facilities-review.yaml`, khai trong `authorities` của `app.yaml`:

| Mã dòng | So biến | Ngưỡng | Vai trò | Phạm vi |
|---|---|---|---|---|
| `default` | | | `manager` | xã của hồ sơ |
| `province` | `excessM2` | 1000 (minh họa) | `manager` | tỉnh, tenant cha của xã |

- **Ai sửa:** `tenant_admin` của tỉnh (tenant cha), qua GraphQL, chỉ cột `role` và `above` của dòng thuộc xã con. Quản
  trị xã không sửa được bảng của chính xã mình. Cài lại gói chỉ thêm dòng chưa có, nên giữ dòng tỉnh đã sửa.
- **Đổi một dòng thì hồ sơ lập sau đi theo dòng mới; hồ sơ đã lập giữ vai trò cũ**, kể cả khi dòng được đổi lại.
- **Bước quyết định cần OTP với mọi vai trò.** `manager` luôn có OTP. Giao bước cho vai trò khác, ví dụ
  `tenant_admin`, thì người vận hành gán vai trò `otp_required` của client `mortise-web` cho tài khoản nhận bước; bản
  demo có `admin2.a`. Tài khoản cùng vai trò mà không có nó (`admin.a`) thấy việc nhưng bị từ chối khi hoàn thành.
- **Dòng `province`: bước quyết định thuộc thẩm quyền của tỉnh** khi phần vượt trên 1000 m²
  ([ADR 0029](../../docs/adr/0029-parent-completes-delegated-step.md)). 1000 m² là ngưỡng minh họa, không lấy từ văn bản
  nào: chưa đối chiếu được văn bản đặt mức phần vượt chuyển hồ sơ lên cấp khác; quản trị tỉnh sửa `above` của dòng ở
  từng xã. Mọi hồ sơ tới `decide` đã vượt trên ngưỡng công khai hoặc thiếu số liệu, nên ngưỡng từ 300 m² trở xuống là
  mọi bước quyết định thuộc về tỉnh. Hồ sơ thiếu hay âm `excessM2` coi như vượt mọi ngưỡng (ADR 0028), nên tới tỉnh. Xã
  A của dữ liệu demo vượt 420 m², bước quyết định vẫn ở xã.
- **Tỉnh chỉ thấy bước của tỉnh.** `manager.tinh` thấy và hoàn thành `decide` của hồ sơ xã con, cùng mọi biến
  của hồ sơ ở bước đó; không thấy bước duyệt, bước trình, không đọc được trạng thái hồ sơ, không đọc được bảng cơ sở
  của xã. Người của xã khác và của tỉnh khác (`manager.k`, tenant `tinh-khac`) nhận 404.

`tests/workflow.sh` kiểm: quản trị tỉnh (`admin.tinh`) đổi dòng của xã A sang `tenant_admin`, hồ sơ lập sau có bước
`decide` ở `tenant_admin`, hồ sơ lập trước vẫn ở `manager`; `admin.a` không sửa được bảng và bị từ chối ở bước
`decide` vì thiếu OTP; `admin2.a` và `manager.a` đăng nhập kèm OTP thì ghi nhận được quyết định. Bài đặt lại dòng về
`manager` ngay sau khi lập hồ sơ thứ hai. Bài cũng kiểm lập hồ sơ kèm `decision`, và hoàn thành bước `submit` kèm
`decision`, đều nhận `400`. Hồ sơ thứ ba vượt 1500 m²: `manager.tinh` không thấy bước duyệt và bước trình của nó, thấy
và ghi nhận được bước `decide`; `manager.a`, `manager.b` và `manager.k` không thấy bước đó và nhận 404 khi gửi thẳng
mã task; trạng thái hồ sơ trả 404 với tỉnh.

Ngưỡng và thời hạn là `settings` trong `app.yaml` (ADR 0019): `review_threshold_m2: 300`, `publication_period: P30D`
theo Điều 3a khoản 2, 3 NĐ 155/2025/NĐ-CP, bổ sung bởi Điều 3 NĐ 369/2026/NĐ-CP. Demo và CI ghi đè thời hạn khi cài:
`make app-install APP=facilities-commune SETTINGS=publication_period=PT20S`.

**Giới hạn:**

- `excessM2` do trình duyệt đọc từ `area_summary` lúc bấm nút rồi gửi đi. Người gọi thẳng API vẫn gửi được số khác,
  nên người duyệt đối chiếu với hồ sơ. Quy trình chưa tự lấy phần vượt ở phía máy chủ; đó là việc sau.
- Lập hai hồ sơ cho cùng một cơ sở không bị chặn. Bấm đúp trong cùng hộp xác nhận chỉ tạo một hồ sơ.
- Người lập khai thấp `excessM2` là né được dòng `province`, tức hồ sơ ở lại xã thay vì lên tỉnh, vì `excessM2` do
  người lập gửi (ADR 0028, giới hạn đã biết). Người có thẩm quyền của xã phải đối chiếu với hồ sơ.
- Với dòng mặc định, cùng một `manager` của xã làm được cả bước trình lẫn bước quyết định: bốn mắt chỉ loại người lập.
- Biến người lập gửi (`title`, `facilityId`, `excessM2`) không phải trường của bước nào, nên người hoàn thành bước sau
  vẫn ghi đè được chúng qua API ([ADR 0031](../../docs/adr/0031-step-fields.md)): workflow-api chỉ chặn trường của
  bước. Nhánh và người nhận bước quyết định đã chọn lúc lập hồ sơ nên không đổi, nhưng tên, cơ sở và phần vượt hiện
  trên hồ sơ thì đổi được.
- Mọi hồ sơ rà soát, kể cả nhánh báo cáo, cần xã có dòng trong bảng phân cấp: xã tạo sau khi cài gói nhận `409` khi
  lập hồ sơ cho tới khi chạy lại `make app-install APP=facilities-commune`.

## Cài và gỡ

Cần lõi đang chạy và đã `make seed`. Cài gói chạy migration, áp quyền Hasura, nạp bảng phân cấp mặc định, deploy quy
trình cho mọi xã, nạp khai báo bước và menu:

```bash
make app-install APP=facilities-commune                  # P30D theo app.yaml: smoke không chờ hết hạn công khai
make app-install APP=facilities-commune SETTINGS=publication_period=PT20S   # demo, CI: thời hạn 20 giây
make seed-demo                                           # dữ liệu demo ba xã (seed/demo.yaml), qua cổng
make app-smoke APP=facilities-commune                    # kiểm qua cổng
make app-status APP=facilities-commune                   # migration nào đã áp
make app-uninstall APP=facilities-commune CONFIRM=yes    # XÓA dữ liệu của gói ở mọi tenant; lõi vẫn qua smoke
```

Gói đã cài thì `make seed` áp lại quyền của gói và `make smoke` báo lệch nếu ai sửa tay trên Hasura, như bảng của
lõi. CI cài gói, chạy smoke của gói, chạy `make seed` và `make smoke` khi gói đang cài, rồi gỡ gói và chạy lại
`make smoke`.

## Kiểm tra kho lưu trữ

Luật `rules/archive-humidity.yaml` (ADR 0018): độ ẩm (`humidity`) của một thiết bị trong xã lớn hơn 75% liên tục 5
phút thì lõi mở quy trình `archive-inspection` cho xã đó; người duyệt (`manager`) của xã thấy việc "Kiểm tra kho lưu
trữ" trên bảng việc và ghi kết quả kiểm tra. Còn việc chưa xử lý thì không mở thêm. Ngưỡng 75% và 5 phút là số minh
họa, không lấy từ quy định hay tiêu chuẩn nào.

Thử trên bản cài demo (đã chạy ngày 2026-11-21: sau khoảng 5 phút `manager.a` có việc "Kiểm tra kho lưu trữ:
archive-01"):

```bash
make simulate ARGS="--set xa-a/archive-01:humidity=78"   # giữ độ ẩm kho xã A ở 78%, dừng bằng Ctrl+C
```

## Chưa có

Phần bù diện tích sử dụng chung theo Tiêu chuẩn quốc gia; diện tích sử
dụng chung khi nhiều cơ quan chung một trụ sở (Điều 6 khoản 2 điểm a, sửa bởi NĐ 369).

## Dữ liệu demo

`seed/demo.yaml` là dữ liệu hư cấu của ba xã thuộc "Tỉnh Mẫu": tổng diện tích thông thủy của cơ sở đang dùng là
1.000 m² (xã A), 730 m² (xã B), 460 m² (xã C); xã C còn một cơ sở dôi dư 250 m². Biên chế hư cấu chỉ dùng hai dòng
phụ lục có ghi thẳng chức danh (STT 9 chuyên viên chính 20 m², STT 10 chuyên viên 15 m²); kết quả: xã A được phép
580 m², vượt 420 m²; xã B được phép 600 m², vượt 130 m²; xã C được phép 480 m², không vượt. `make seed-demo` nạp qua
cổng bằng tài khoản quản trị của từng xã (`admin.*`, `seed/load.py`) rồi phân công `user.*` phụ trách mọi cơ sở của
xã mình; chạy lại không tạo bản trùng; smoke của gói kiểm các số này khi đã nạp. Tọa độ của các cơ sở cũng hư
cấu, nằm trong vài km quanh điểm vĩ độ 0, kinh độ 0, giữa biển, để không trỏ vào địa điểm có thật; chạy lại
`make seed-demo` thì cơ sở đã nạp từ trước nhận tọa độ.

Mục `menu` `facilities` trong `app.yaml` khai cấu hình danh mục, được `make check-fast` kiểm theo schema. Cài gói
thì mục "Cơ sở nhà, đất" hiện trên menu của giao diện và mở danh sách cơ sở → tòa → phòng dựng từ
`catalog/facilities.yaml`; gói không có mã giao diện riêng. Cán bộ thấy cơ sở mình được phân công; giao diện chưa
chọn vai trò khác `user`, nên quản trị xã và lãnh đạo xã trên giao diện cũng chỉ thấy như cán bộ.

Mục `menu` `map` mở bản đồ trụ sở dựng từ `map-layers/facilities.yaml` ([ADR 0024](../../docs/adr/0024-map-component.md)),
trên nền trơn, không tải tile:

- Lớp "Trụ sở đang dùng": cơ sở cán bộ thấy được, tô theo phần vượt của xã (quan hệ `summary`): xanh khi không vượt,
  đỏ khi vượt.
- Lớp "Cơ sở dôi dư": màu xám, vì cơ sở dôi dư không tính vào phần vượt.
- Lớp "Trụ sở đang dùng của các xã": đọc view `facility_rollup` với vai trò `rollup_reader`, nên chỉ hiện cho
  `leader.tinh`.

Cơ sở chưa có tọa độ không có trên bản đồ; trang báo số dòng như vậy.
