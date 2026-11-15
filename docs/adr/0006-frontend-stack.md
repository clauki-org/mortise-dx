<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0006. Giao diện Tầng 2: React, Mantine và component đọc cấu hình gói

- Trạng thái: Chấp nhận
- Ngày: 2026-11-15

## Bối cảnh

Tầng 2 cần giao diện cho người dùng nghiệp vụ. Giá trị của tầng này là một bộ component dùng chung (danh mục, biểu
mẫu, bảng việc, bản đồ, bảng điều hành) **đọc cấu hình của gói** để hiển thị, không viết màn hình riêng cho từng
bảng ([ADR 0003](0003-three-tier-layout.md)). Ràng buộc:

- Đăng nhập bằng Keycloak theo Authorization Code + PKCE; ứng dụng không bao giờ nhận mật khẩu (RFC 9700 không cho
  dùng password grant).
- Chỉ gọi lõi qua cổng: GraphQL của Hasura (`/v1/graphql`) và các REST tự viết (`/v1/workflow`, sau này `/v1/files`).
- Biểu mẫu sinh từ JSON Schema do gói khai báo.
- Bản đồ tự lưu trữ được, không phụ thuộc dịch vụ bản đồ thương mại.
- Thương hiệu (tên, logo, màu) theo bản cài, đổi không cần build lại.
- Chạy được trên máy chủ của tổ chức mà không thêm máy chủ ứng dụng; mọi thư viện có giấy phép OSI dùng được cùng
  Apache-2.0.
- Nhóm phát triển nhỏ, thời gian ngắn: ưu tiên thư viện có sẵn cho phần không phải giá trị riêng của dự án.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Next.js | Mạnh ở render phía máy chủ, SEO và route API. Ứng dụng nội bộ sau đăng nhập không cần SEO; route API thành cửa thứ hai vào hệ thống bên cạnh APISIX; phải chạy thêm máy chủ Node |
| Vue 3 + JSONForms | Dùng được, dễ học. Bộ renderer JSON Schema cho Vue chưa đầy đủ bằng rjsf của React, phải tự viết thêm cho trường đặc thù |
| Angular | Nặng và lâu học so với thời gian có |
| Refine | Có sẵn CRUD trên Hasura và chỗ cắm đăng nhập. Nhưng component lõi của Tầng 2 phải theo khái niệm của Refine (resource, data provider); phần nhóm cần chứng minh lại do khung làm; thêm một lớp phụ thuộc |
| Ant Design, MUI | Nhiều component nhưng nặng; đổi giao diện thành thương hiệu riêng của từng bản cài khó hơn Mantine |
| React + Mantine, ghép thư viện chuyên dụng | Hệ sinh thái lớn nhất cho OIDC, form từ JSON Schema, bản đồ; nhóm tự viết lớp đọc cấu hình |

## Quyết định

Mã giao diện nằm ở `platform/web/`, là ứng dụng trang đơn (SPA) build ra tệp tĩnh.

| Việc | Thư viện | Phiên bản chính | Giấy phép |
|---|---|---|---|
| Nền | React, React DOM | 19 | MIT |
| Ngôn ngữ | TypeScript | 7 | Apache-2.0 |
| Build và máy chủ phát triển | Vite | 8 | MIT |
| Bộ component, theme | Mantine (`core`, `hooks`, `dates`, `notifications`) | 9 | MIT |
| Đăng nhập OIDC + PKCE | oidc-client-ts | 3 | Apache-2.0 |
| GraphQL tới Hasura | urql, graphql | 5, 17 | MIT |
| REST tới `/v1/*` | TanStack Query | 5 | MIT |
| Điều hướng | React Router | 8 | MIT |
| Biểu mẫu từ JSON Schema | rjsf (`core`, `utils`, `mantine`) | 6 | Apache-2.0 |
| Kiểm dữ liệu biểu mẫu | `@cfworker/json-schema` | 4 | MIT |
| Bản đồ | MapLibre GL JS, react-map-gl | 6, 8 | BSD-3-Clause, MIT |
| Kiểm lỗi và định dạng mã | Biome (`@biomejs/biome`) | 2 | MIT hoặc Apache-2.0 |
| Kiểm thử đơn vị | Vitest | 5 | MIT |
| Kiểm thử trên trình duyệt | Playwright | 1 | Apache-2.0 |
| Kiểm giấy phép phụ thuộc | license-checker-rseidelsohn | 5 | BSD-3-Clause |
| Phục vụ tệp tĩnh khi chạy | nginx, image chính thức nhánh stable | 1.30 | BSD-2-Clause |

Phiên bản cụ thể khóa trong `platform/web/package-lock.json` và thẻ image trong `compose.yaml`; Node theo bản LTS
hiện hành (26 khi viết), ghim trong image build. Đã tra trên npm và Docker Hub ngày 2026-11-15: mọi gói trên có bản
phát hành trong năm 2026; `@rjsf/mantine` 6 nhận Mantine từ 8 trở lên, React Router 8 cần React từ 19.2.7; nhánh
stable của nginx là 1.30.

Cách dùng:

- Build bằng Vite ra tệp tĩnh, phục vụ bằng nginx đứng sau APISIX. Không có máy chủ Node khi chạy.
- Route `/` của APISIX trỏ tới nginx, là route đón mọi đường dẫn không khớp `/auth` hay `/v1` (APISIX khớp đường dẫn dài
  nhất trước); route này không đòi token vì chỉ trả tệp tĩnh. nginx trả `index.html` cho mọi đường dẫn không phải tệp,
  để điều hướng phía trình duyệt của React Router hoạt động khi tải lại trang.
- Client Keycloak của giao diện là client công khai, chỉ bật Authorization Code + PKCE, tắt password grant; redirect URI
  và web origin đặt theo URL công khai của bản cài (`MORTISE_PUBLIC_URL`), không dùng `+` hay ký tự đại diện rộng. Smoke
  và CI dùng một client kiểm thử riêng còn bật password grant; client này không có redirect URI nên không dùng được cho
  luồng đăng nhập qua trình duyệt, và không cấp cho ứng dụng nào.
- Token do oidc-client-ts giữ trong `sessionStorage` của tab (mặc định của thư viện), không dùng `localStorage`; làm mới
  bằng refresh token, không dùng iframe ẩn vì trình duyệt chặn cookie bên thứ ba sẽ làm cách đó hỏng.
- nginx gửi header bảo mật: `Content-Security-Policy` chỉ cho tải script từ chính origin, riêng worker cho phép `blob:`
  vì MapLibre GL JS tạo web worker từ URL `blob:`; `X-Content-Type-Options`, `Referrer-Policy`, chặn nhúng trang vào
  khung của site khác.
- Thương hiệu đọc từ một tệp cấu hình của bản cài lúc trang khởi động, áp vào theme Mantine.
- Mỗi component Tầng 2 có schema cấu hình nằm cạnh mã của nó (`platform/components/<tên>/`, theo bố cục ở `AGENTS.md`);
  mã component không chứa từ nghiệp vụ.
- Biểu mẫu dùng theme Mantine của rjsf để cùng giao diện với phần còn lại; trường đặc thù (chọn đơn vị, chọn vị trí trên
  bản đồ, đính kèm tệp) viết thành widget riêng của rjsf.
- Dữ liệu biểu mẫu kiểm bằng `@cfworker/json-schema` qua một bộ nối nhỏ (`platform/web/src/formValidator.ts`), không
  dùng bộ kiểm AJV đi kèm rjsf. AJV dịch schema thành mã bằng `new Function`, mà CSP ở trên (không có `'unsafe-eval'`)
  chặn; cfworker diễn giải schema trực tiếp. Bổ sung ngày 2026-11-15, khi làm màn hình xử lý việc: bản build không chứa
  `new Function`, và biểu mẫu chạy đúng dưới CSP của nginx (kiểm bằng Playwright).
- CI kiểm giấy phép mọi phụ thuộc theo danh sách cho phép (MIT, Apache-2.0, BSD, ISC, 0BSD và tương đương); gặp giấy
  phép ngoài danh sách thì CI đỏ.

## Hệ quả

- Thêm Node vào công cụ phát triển và CI. Bước kiểm giao diện (Biome, kiểu TypeScript, Vitest, giấy phép, build)
  chỉ chạy khi thay đổi chạm `platform/web/`, theo cơ chế phát hiện vùng thay đổi đã có.
- Cấu hình hiện tại chưa khớp quyết định: client `mortise-web` trong `core/keycloak/realm-mortise.json` còn bật
  password grant, redirect URI là `http://localhost:3000/*`, web origin là `+`, và `scripts/smoke.sh` lấy token
  bằng password grant qua client này. Pull request dựng khung giao diện sửa realm, thêm client kiểm thử và chuyển
  smoke sang client đó.
- Token nằm trong bộ nhớ mà JavaScript của trang đọc được: một lỗ hổng XSS hoặc một phụ thuộc bị chèn mã độc có thể
  lấy token. CSP, kiểm giấy phép và khóa phiên bản phụ thuộc giảm rủi ro này nhưng không loại bỏ; cách loại bỏ là một
  lớp backend giữ token thay trình duyệt (mô hình BFF), chưa làm vì thêm một dịch vụ phải vận hành.
- README, `docs/tools.md` và bảng thành phần cập nhật trong pull request dựng khung giao diện, khi mã thật sự có mặt.
- `package-lock.json` không chứa được chú thích SPDX: thêm vào `REUSE.toml` như `uv.lock`.
- Lớp đọc cấu hình là mã của nhóm, phải tự viết và tự kiểm: danh mục cần sinh câu GraphQL từ cấu hình cột và quan hệ.
- Nguồn nền bản đồ chọn khi làm thành phần bản đồ: không tải tile trực tiếp khối lượng lớn từ máy chủ của
  OpenStreetMap, ghi nguồn dữ liệu theo ODbL.
- Trang đăng nhập vẫn do Keycloak hiển thị; theme đăng nhập theo thương hiệu bản cài là việc riêng, vị trí trong
  bố cục quyết định khi làm.
