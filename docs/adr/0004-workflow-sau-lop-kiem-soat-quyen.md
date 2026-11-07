<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0004. Workflow: Flowable REST đứng sau lớp kiểm soát quyền workflow-api

- Trạng thái: Chấp nhận
- Ngày: 2026-11-05

## Bối cảnh

Workflow là một trong bốn dịch vụ lõi ([ADR 0002](0002-chon-thanh-phan-loi.md)).
Flowable (Apache-2.0) chạy được BPMN và có REST API, nhưng REST API
xác thực bằng tài khoản riêng của Flowable (basic auth), không hiểu token Keycloak, tenant hay vai trò của lõi. Nếu
mở thẳng REST API qua APISIX với một tài khoản kỹ thuật, mọi người dùng đã đăng nhập đều có toàn quyền trên Flowable:
xem task của tenant khác, hoàn thành task không thuộc vai trò của mình.

Các lựa chọn đã xét:

| Lựa chọn | Đánh giá |
|---|---|
| Mở REST API của Flowable qua APISIX, chèn basic auth của tài khoản kỹ thuật | Phá cách ly tenant và phân quyền theo vai trò |
| Cấu hình Flowable xác thực bằng OIDC của Keycloak | Phải tùy biến ứng dụng Spring của Flowable (sửa hoặc đóng gói lại mã bên thứ ba) |
| Một dịch vụ nhỏ của lõi đứng trước Flowable, kiểm token và quyền rồi gọi Flowable bằng tài khoản kỹ thuật | Không sửa Flowable, quy tắc quyền nằm ở một chỗ, kiểm thử được |

## Quyết định

- Flowable chạy bằng image chính thức `flowable/flowable-rest`, chỉ engine và REST API, không mở route công khai;
  cổng quản trị chỉ bind 127.0.0.1.
- Dịch vụ `core/workflow-api` (Python, FastAPI) là cửa duy nhất tới Flowable, đứng sau APISIX tại `/v1/workflow/*`:
  - kiểm access token lần nữa bằng JWKS của Keycloak;
  - đặt `tenantId` của Flowable bằng claim `tenant`, đặt biến `initiator` bằng `sub` của token; ứng dụng không ghi
    đè được các biến này;
  - chỉ cho hoàn thành task nếu cùng tenant và người gọi là người được giao hoặc thuộc nhóm ứng viên (vai trò);
  - task có `flowable:category="four-eyes"` không cho người khởi tạo tự hoàn thành (quy tắc bốn mắt).
- Sơ đồ BPMN nằm trong repo dưới dạng XML và được deploy theo từng tenant bằng `make seed`; không dùng công cụ vẽ
  BPMN chạy trong lõi.

## Hệ quả

- Ứng dụng Tầng 2 dùng workflow qua bốn endpoint: khởi tạo quy trình, liệt kê task của mình, hoàn thành task, xem
  trạng thái quy trình.
- Quy tắc quyền là hàm thuần trong `app/policy.py`, có kiểm thử đơn vị; `make smoke` kiểm tra đầu-cuối cách ly
  tenant, vai trò và quy tắc bốn mắt.
- Flowable ghi người hoàn thành task là `sub` của người dùng; người khởi tạo lưu trong biến `initiator` vì REST API
  không cho đặt người khởi tạo khi dùng tài khoản kỹ thuật.
- Thêm một dịch vụ tự viết phải bảo trì; giữ nhỏ, chỉ chứa phần Flowable không làm được.
