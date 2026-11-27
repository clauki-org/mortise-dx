<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0056. Nền bản đồ OpenStreetMap tự lưu trữ dạng PMTiles, mặc định không chữ

- Trạng thái: Chấp nhận
- Ngày: 2026-11-27
- Sửa đổi: [ADR 0024](0024-map-component.md) (phần nền trơn)

## Bối cảnh

ADR 0024 chọn nền trơn: không cần internet, không đổi CSP, và điểm demo ở tọa độ hư cấu quanh vĩ độ 0, kinh độ 0
không rơi vào nơi có thật. Đổi lại, người xem không thấy đường, sông hay khu dân cư nên khó định hướng. ADR 0024 đã
xét và để lại lựa chọn tệp tile tự lưu trữ (PMTiles) vì phải tải, phục vụ một tệp dữ liệu và thêm một thư viện.

Yêu cầu của #225: nền thật, chạy không cần internet, không đổi CSP; không đưa dữ liệu bản đồ vào repo; nguồn và phiên
bản ghim, kiểm SHA-256 lúc cài; bản demo vẫn hư cấu (không tên địa danh, không điểm quan tâm, không khối nhà), bản cài
thật bật được chữ; luôn ghi nguồn OpenStreetMap theo ODbL; chưa có tệp nền thì vẫn chạy với nền trơn.

Nguồn dữ liệu đã xét, đọc ngày 2026-11-27:

| Lựa chọn | Đánh giá |
|---|---|
| Tự dựng tile từ tệp `.osm.pbf` của một vùng (Planetiler, tilemaker) | Kiểm soát hoàn toàn, nhưng thêm một công cụ dựng chạy JVM hay C++ và tốn RAM, thời gian lúc cài; kết quả phụ thuộc phiên bản công cụ |
| Bản dựng theo ngày của Protomaps (`build.protomaps.com/<ngày>.pmtiles`), cắt vùng bằng `pmtiles extract` | Dữ liệu OpenStreetMap đã dựng sẵn thành tile vector; `extract` chỉ đọc phần của vùng bằng yêu cầu Range nên không tải cả tệp toàn cầu; công cụ là một image chính thức nhỏ. Bản dựng theo ngày có thể bị gỡ |
| Dịch vụ tile công cộng | Cần internet, phải mở CSP (ADR 0024) |

Kiểu vẽ đã xét: viết tay một kiểu tối thiểu, hay dùng gói `@protomaps/basemaps` (BSD-3-Clause) vốn viết cho đúng lược
đồ của bản dựng Protomaps. Gói cho ra các lớp của MapLibre; gọi không kèm ngôn ngữ thì không có lớp chữ nào (đã đếm:
57 lớp, không lớp `symbol`), kèm `lang` thì thêm tên địa danh, đường, sông.

## Quyết định

- **Nguồn:** bản dựng Protomaps ngày 2026-08-11 (phiên bản lược đồ 4.15.1), cắt vùng bằng image chính thức
  `protomaps/go-pmtiles:v1.31.2` ghim cả digest, chạy như dịch vụ `basemap` của profile `tools` trong `compose.yaml`
  để `make check-fast` kiểm ghim và giấy phép như mọi image khác (ADR 0039). Nguồn, vùng, mức phóng và SHA-256 ghim
  trong `platform/web/basemap.pins`.
  - Chọn bản dựng cũ hơn bản mới nhất: danh sách bản dựng (`build-metadata.protomaps.dev/builds.json`) chỉ còn đủ bản
    theo ngày của khoảng một tuần gần nhất, bản cũ hơn chỉ còn rải rác, mỗi phiên bản lược đồ vài bản.
  - Cắt cùng nguồn, vùng, mức phóng và image hai lần ra cùng một tệp, cùng SHA-256 (thử ngày 2026-11-27), nên băm ghim
    kiểm được.
- **`make basemap`** (`scripts/basemap.sh`): cắt vào thư mục tạm, kiểm SHA-256, rồi mới đổi tên thành
  `region.pmtiles` và ghi `basemap.json` sau cùng, trong `MORTISE_BASEMAP_DIR` (mặc định
  `~/.cache/mortise-dx/basemap`, ngoài repo). Băm khác thì dừng, không thay tệp đang dùng.
  - Vùng khác vùng ghim: `make basemap BBOX=... SHA256=...`; lần đầu không có băm thì lệnh cắt, in băm rồi dừng, để
    người vận hành kiểm tệp trước khi ghim.
  - `LABELS=on` tải thêm phông Noto Sans dạng glyph PBF (OFL-1.1) từ gói mã nguồn của kho `protomaps/basemaps-assets`
    tại một commit ghim, kiểm SHA-256, giải nén vào thư mục tạm và chỉ giữ ba bộ phông kiểu vẽ dùng cùng giấy phép.
- **Phục vụ cùng origin:** compose gắn thư mục đó vào `/usr/share/nginx/html/basemap` của web, chỉ đọc; nginx có
  `location /basemap/` trả 404 khi thiếu tệp (không rơi xuống `index.html`), không giữ trong bộ nhớ đệm. Tile đọc bằng
  yêu cầu Range qua `connect-src 'self'`, phông qua `default-src 'self'`: CSP không đổi. `scripts/compose.sh up` tạo
  thư mục trước khi dựng, vì thư mục do Docker tự tạo thuộc root và lệnh cắt không ghi vào được.
- **Giao diện** (`basemap.ts`, `MapCanvas.tsx`): đọc `/basemap/basemap.json` (`tiles`, `labels`) và phần đầu của tệp
  PMTiles bằng thư viện `pmtiles` 4.5.0 (BSD-3-Clause); thiếu tệp, sai định dạng hay không phải tile vector thì vẽ nền
  trơn như ADR 0024. Không thu nhỏ được dưới mức phóng thấp nhất của tệp.
- **Kiểu vẽ:** bản "light" của `@protomaps/basemaps` 5.7.2, luôn bỏ khối nhà (điểm không được trỏ vào công trình có
  thật nào) và ranh giới hành chính (gói tự vẽ ranh giới của mình). `labels: false` (mặc định) bỏ mọi lớp `symbol` và
  không khai `glyphs`, nên không cần phông; `labels: true` giữ tên địa danh, đường, sông, bỏ lớp cần ảnh biểu tượng
  (điểm quan tâm, biển số đường, mũi tên một chiều) vì bản cài không có bộ ảnh biểu tượng. Kiểm thử đơn vị kiểm cả hai.
- **Ghi nguồn:** có nền thì góc bản đồ luôn có dòng "© OpenStreetMap (ODbL)" là chữ của trang, liên kết tới trang bản
  quyền của OpenStreetMap; không dùng nút ghi nguồn của MapLibre vì nút đó thu thành biểu tượng ở màn hình hẹp và nhận
  HTML.
- **Vùng mặc định** là vùng mà dữ liệu demo dùng (#226): `106.37,20.405,106.46,20.475`, mức phóng 12 tới 15, một vùng nông thôn
  đồng bằng khoảng 9 × 8 km, có đường liên xã, kênh và một sông nhỏ uốn khúc, xóm dọc đường, ruộng. Chọn vì ít người
  biết và không có công trình nổi bật; khung dừng ở phía bắc một thị trấn và phía nam một con sông lớn gần đó. Ranh
  giới, tên xã và vị trí trụ sở mà #226 đặt trên vùng này là hư cấu ([ADR 0020](0020-facility-locations.md)).

Đã chạy thử ngày 2026-11-27:

- `make basemap` với vùng ghim: tệp 357.619 byte, SHA-256
  `dda1013a66c50b360a1fb32ae6b8b63151a6fb11375fff1ea11f068cb275ae1d`, đọc khoảng 371 kB từ nguồn trong khoảng 12
  giây; `LABELS=on` thêm thư mục `fonts/` với ba bộ phông.
- Bản build của `MapCanvas` phục vụ bằng nginx 1.30.6 với `nginx.conf` và `security-headers.conf` của repo, mở bằng
  Chromium qua Playwright, cỡ 1000 và 390 px: tile trả 206, mọi yêu cầu cùng origin, console không có lỗi CSP, dòng
  ghi nguồn hiện ở cả hai cỡ; `labels: true` hiện tên đường có dấu tiếng Việt; thư mục nền trống thì
  `/basemap/basemap.json` trả 404 và bản đồ vẽ nền trơn.

## Hệ quả

- Bản đồ cho thấy đường, sông, khu dân cư dưới các điểm, vẫn không cần internet khi chạy. Lần cài đầu cần mạng tới
  `build.protomaps.com` và, khi bật chữ, `github.com`.
- **Bản dựng ghim có thể bị gỡ khỏi `build.protomaps.com`.** Khi đó `make basemap` báo không cắt được; bản cài đã có
  tệp vẫn chạy. Người vận hành chọn một bản dựng còn trong danh sách, sửa `SOURCE` và `SHA256` trong tệp ghim bằng một
  pull request, kèm ngày kiểm.
- **Hình dạng thật vẫn nhận ra được.** Không có chữ, nhưng sông, đường và khu dân cư là của một nơi có thật; người
  quen vùng có thể nhận ra, nhất là khi thu nhỏ tới mức 12 (thấy thêm mép một thành phố và một con sông lớn ở phía
  tây bắc). Vì vậy tên, ranh giới và vị trí demo trên nền phải là hư cấu, và bản đồ của gói ghi rõ điều đó (#226).
- **ODbL:** tệp cắt ra là một cơ sở dữ liệu phái sinh của OpenStreetMap; chia sẻ lại tệp đó thì theo ODbL. Repo không
  chứa tệp nào; ghi nguồn luôn hiện khi dùng nền.
- Image của `web` không đổi; thêm một thư mục gắn vào và một dịch vụ công cụ chỉ chạy khi gọi. Hai thư viện mới chỉ
  tải cùng mã của trang bản đồ.
- Phông chữ khi bật chữ chưa có trong bảng kiểm giấy phép tự động: gói phông không qua npm hay image, giấy phép ghi ở
  bảng README.
