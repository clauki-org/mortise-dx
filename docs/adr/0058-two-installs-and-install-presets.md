<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0058. Hai bản cài trên một máy và mẫu cài `make install PRESET=<mẫu>`

- Trạng thái: Đề xuất
- Ngày: 2026-11-27

## Bối cảnh

Demo cần hai org chạy cạnh nhau trên một máy: chính quyền "Tỉnh Mẫu" và "Công ty Điện mặt trời Mẫu" (cả hai hư cấu),
mỗi org một bản cài riêng: CSDL, Keycloak, cổng riêng, khác thương hiệu, khác bộ gói, cùng mã nguồn.

Trước quyết định này, `compose.yaml` viết cứng tên dự án `mortise` và cổng 9080 của APISIX trên máy chủ; Alloy lọc log
theo nhãn dự án `mortise`. Các cổng quản trị khác đã đọc từ `.env`. Hai checkout cùng tên dự án là một bản cài: lệnh
`up` ở checkout thứ hai dựng lại container của bản thứ nhất.

Cookie không tách theo cổng: hai bản cài cùng ở `localhost` (khác cổng) dùng chung cookie phiên của Keycloak (cùng
tên realm `mortise`, cùng đường dẫn), nên đăng nhập bản này làm hỏng phiên của bản kia. Chrome và Firefox phân giải mọi tên
`*.localhost` về máy mình, nên hai tên máy như `tinh.localhost` và `dmt.localhost` tách được cookie mà không phải sửa
tệp hosts.

Tệp realm của Keycloak chỉ được nạp ở lần khởi động đầu; redirect URI, web origin của client giao diện lấy
`MORTISE_PUBLIC_URL` lúc đó. Đổi URL sau này (ví dụ bản cài đang chạy ở `localhost:9080` chuyển sang
`tinh.localhost:9080`) thì Keycloak từ chối địa chỉ mới.

Dựng một org hiện là chuỗi lệnh viết tay: `make up`, `make seed`, `make app-install` từng gói, `make seed-demo`, đặt
thư mục thương hiệu.

## Quyết định

**Bản cài theo `.env`.** Tên dự án (`COMPOSE_PROJECT_NAME`), cổng APISIX trên máy chủ (`MORTISE_PORT`), các cổng quản
trị và URL công khai (`MORTISE_PUBLIC_URL`) đều đọc từ `.env`; giá trị mặc định giữ đúng bản cài một máy như trước.
Bản cài thứ hai là checkout thứ hai với `.env` riêng. `make env` lấy biến không phải bí mật từ môi trường khi tạo
`.env`, để đặt các giá trị đó trong một lệnh; bí mật luôn sinh mới. Alloy lọc log theo tên dự án của bản cài.

**Tên máy riêng cho mỗi bản cài.** Hai bản cài trên một máy dùng hai tên `*.localhost`. `make seed` đặt lại redirect
URI, web origin và địa chỉ sau đăng xuất của client giao diện theo `MORTISE_PUBLIC_URL` hiện tại mỗi lần chạy, ghi đè
chứ không cộng dồn, để URL cũ không còn đăng nhập được. Giao diện đã lấy địa chỉ OIDC từ origin của trang nên không
phải sửa. `scripts/compose.sh up` dừng khi URL localhost mang cổng khác `MORTISE_PORT`. Bộ đếm mã OTP đã dùng của
`scripts/otp.py` tách theo tên dự án.

**Mẫu cài.** `presets/<mẫu>/preset.yaml` (`contracts/preset.schema.json`) khai cái org là gì: thư mục thương hiệu, tenant
gốc và tài khoản demo, gói cài, dữ liệu demo (của gói, hay tệp `seed/*.yaml` của mẫu cho tenant của mẫu). Cái máy chạy ở
đâu (tên dự án, cổng, URL) không nằm trong mẫu mà nằm trong `.env`: cùng một mẫu cài được ở máy demo và máy chủ thật.
`make install PRESET=<mẫu>` kiểm mẫu, tạo `.env`, ghi `MORTISE_PRESET` và `MORTISE_BRANDING_DIR`, dựng lõi, seed, cài
gói, nạp dữ liệu demo; mọi bước chạy lại được. Lệnh dừng khi dự án compose cùng tên đang chạy từ thư mục khác, trừ khi
có `CONFIRM=yes`.

**Tài khoản của mẫu cộng thêm vào tài khoản của lõi.** `make seed` luôn tạo tài khoản và tenant demo của lõi ("Tỉnh
Mẫu"), vì `make smoke` và smoke của gói đăng nhập bằng chúng; tenant và tài khoản của mẫu (`MORTISE_PRESET`) được tạo
thêm, trước khi deploy quy trình mẫu và cài gói, vì cả hai chỉ nạp cho tenant đã có.

Hai mẫu đầu: `chinh-quyen` (gói cơ sở vật chất xã và kho vật tư, dữ liệu demo của hai gói, thương hiệu "Cổng số Tỉnh
Mẫu") và `dien-mat-troi` bản tối thiểu (tenant `dmt` với `admin.dmt`, `manager.dmt`, `user.dmt`; gói kho vật tư với dữ
liệu kho của công ty; thương hiệu "Công ty Điện mặt trời Mẫu"). Gói kho dùng chung và gói vận hành hiện trường sẽ được
thêm vào mẫu này bằng cách thêm dòng vào `packages` và `demo`.

## Hệ quả

- Mỗi bản cài chạy đủ bộ dịch vụ của lõi với CSDL và volume riêng; RAM của hai bản chạy cùng lúc chưa được đo.
- Bản cài thứ hai cũng có tài khoản và tenant demo của "Tỉnh Mẫu". Tách tài khoản kiểm thử của lõi khỏi tài khoản demo
  để bản cài của công ty chỉ có tenant của mình là việc sau.
- Hai checkout dùng chung tên image tự dựng (`mortise.invalid/<dịch vụ>:dev`), và `up` không dựng lại image đã có. Hai
  checkout ở hai commit khác nhau thì đặt `MORTISE_VERSION` khác nhau trong `.env` để mỗi bản cài dựng image của mình.
- `make seed` ghi đè danh sách địa chỉ đăng nhập của client giao diện: địa chỉ thêm tay trên trang quản trị Keycloak
  mất ở lần seed sau.
- Script trên máy chủ gọi cổng qua `*.localhost` cần hệ điều hành phân giải tên đó về máy mình (curl tự làm; Python
  dựa vào bộ phân giải của hệ thống).
