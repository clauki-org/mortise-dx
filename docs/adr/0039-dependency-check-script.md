<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# 0039. Kiểm ghim phiên bản, giấy phép và bản mới của phụ thuộc bằng script trong repo

- Trạng thái: Chấp nhận
- Ngày: 2026-11-25

## Bối cảnh

AGENTS.md đòi image và thư viện được ghim cụ thể, thành phần bên thứ ba chỉ dùng giấy phép OSI (ADR 0002), nhưng trước
quyết định này chỉ hai phần được kiểm tự động: giấy phép thư viện web trong `make web-check` (ADR 0006) và digest
trọng số mô hình lúc `make ai-up` (ADR 0021). Tag image, uv.lock, giấy phép thư viện Python của các dịch vụ tự viết
và bảng giấy phép trong README chỉ dựa vào người review. Cũng không có cách định kỳ biết thành phần nào đã có bản mới
(#172).

Yêu cầu: kiểm ghim và giấy phép là bắt buộc với mọi thay đổi; bản mới chỉ báo, người xem quyết định nâng cấp gì;
mỗi lần kiểm ghi thành một comment trong issue theo dõi.

Các lựa chọn đã xét, tài liệu đọc ngày 2026-11-25:

| Lựa chọn | Đánh giá |
|---|---|
| Dependabot | Có sẵn trên GitHub; theo tài liệu GitHub hỗ trợ npm, uv, Docker, Docker Compose, GitHub Actions. Mỗi bản mới thành một pull request nâng phiên bản. Là công cụ nâng phiên bản: danh sách giấy phép cho phép, đối chiếu bảng README, digest mô hình trong `core/ollama/models.txt` vẫn phải tự viết |
| Renovate | Dependency Dashboard là một issue liệt kê bản mới; preset `:dependencyDashboardApproval` chỉ mở pull request khi có người duyệt trong issue đó, trừ pull request vá lỗ hổng vẫn mở ngay. Thêm một công cụ phải cài và cấp quyền trên repo; kiểm giấy phép, README, digest mô hình cũng phải tự viết |
| Script trong repo, gọi từ Makefile | Một chính sách cho cả ba phần, đọc được trong một tệp; phần ghim và giấy phép không hỏi registry hay PyPI nên đưa được vào `make check-fast`; báo cáo đúng mẫu comment của issue. Phải tự bảo trì; không tự mở pull request nâng cấp |

## Quyết định

**Script trong repo.** `make deps-check` chạy `scripts/deps-check.py` (Python thư viện chuẩn, không cài thêm gì), in
báo cáo theo mẫu: ngày, commit, Ghim, Giấy phép, Bản mới, Quyết định ("chờ người xem"). Mã thoát khác 0 chỉ khi ghim
hay giấy phép lỗi. Chính sách nằm ở `scripts/deps-policy.toml`, đổi qua pull request như mã:

- Giấy phép được nhận, tách hai danh sách: thư viện Python chạy chung tiến trình với mã của dự án chỉ nhận giấy phép
  dễ dãi, Python-2.0.1 (giấy phép của chính trình thông dịch) và MPL-2.0; image bên thứ ba chạy tiến trình riêng, không sửa, nhận cả copyleft được OSI công nhận. Mọi mã
  trong hai danh sách được danh sách giấy phép SPDX đánh dấu OSI công nhận.
- Image nào ứng với dòng nào của bảng "Thành phần đang chạy" trong README.
- Image nào được ghim tới mức thô hơn bản vá, kèm lý do (upstream không phát hành tag chi tiết hơn).
- Giấy phép của một bản cụ thể của gói, đọc từ tệp LICENSE gói đóng kèm, khi METADATA ghi mã không đủ hay mơ hồ
  (`[licenses.packages]`). Đây là ghi lại giấy phép thật của gói, không phải miễn kiểm: giấy phép ghi vào vẫn phải nằm
  trong danh sách cho phép, và lên bản mới thì phải đọc lại.

**Ghim.** Image bên thứ ba trong `compose.yaml` (mọi profile) và mọi dòng `FROM` của Dockerfile có phiên bản tới bản
vá, không `latest`; digest `@sha256:` không thay được tag; mỗi `pyproject.toml` có `uv.lock` khớp (`uv lock --check`) và Dockerfile cài bằng
`uv sync --frozen`; `package-lock.json` khớp `package.json` và mỗi gói có băm `integrity`; mô hình Ollama ghi tag cụ
thể và digest `sha256`; công cụ chạy qua `uvx` hay `uv run --with` trong Makefile, scripts và workflow ghi
`==<phiên bản>`.

**Giấy phép.** Thư viện Python: danh sách gói lấy từ `uv.lock` bỏ nhóm dev, giấy phép đọc từ METADATA của gói đã cài
trong môi trường ảo mà `make test` dùng (`uv sync --frozen`). uv.lock không ghi giấy phép; hỏi PyPI mỗi lần thì cần
mạng. Image bên thứ ba: dòng README tương ứng phải có, cùng phiên bản với tag, và mọi giấy phép ghi trong dòng đó nằm
trong danh sách cho phép. Thư viện web vẫn kiểm trong `make web-check`.

**Bản mới**, cần mạng, chỉ báo: tag ổn định mới hơn cùng khuôn với tag đang dùng (hỏi registry không đăng nhập), tag
mô hình đã trỏ sang trọng số khác digest đã ghim, thư viện Python (`uv pip list --outdated`) và web (`npm outdated`)
lỗi thời. Hỏi một nguồn lỗi thì nguồn đó ghi "không kiểm được", không làm lệnh lỗi.

**Chạy ở đâu.** `make check-fast` gọi `scripts/deps-check.py --offline` ở bước cuối, nên hook pre-push và job
`check` của CI chặn ghim hay giấy phép sai với mọi thay đổi. Không tách thành bước CI riêng: cùng một lệnh ở máy và
trên CI, như mọi kiểm tra khác. Workflow `.github/workflows/deps-check.yml` chạy bản đầy đủ mỗi thứ Hai và khi bấm
tay, rồi đăng báo cáo thành comment trong issue theo dõi bằng `GITHUB_TOKEN`; chỉ job đó có quyền `issues: write`.
Người xem trả lời trong issue, nâng cấp bằng pull request riêng.

## Hệ quả

- Đo ngày 2026-11-25 trên máy phát triển, môi trường ảo của bảy dịch vụ đã cài sẵn, bằng `time`: phần `--offline`
  mất 0,4 giây; bản đầy đủ mất khoảng 1 phút, phần lớn là hỏi registry danh sách tag. Lần đầu trên máy trắng, phần
  `--offline` phải cài thư viện của bảy dịch vụ như `make test`.
- Lần kiểm đầu tiên (2026-11-25) tìm ra và cùng pull request này sửa: `python:3.13-slim-trixie` trong bảy
  Dockerfile trôi theo bản vá, nay ghim `python:3.13.18-slim-trixie`; ruff, yamllint, REUSE, shellcheck-py chạy qua
  `uvx` không ghim, nay ghim đúng bản uvx đang dùng; `typing-extensions` 4.16.0 ghi `PSF-2.0` (danh sách SPDX không
  đánh dấu OSI) trong METADATA, còn tệp LICENSE đóng kèm là trọn bộ giấy phép của CPython, trùng 99,5% LICENSE.txt
  của CPython 3.13, tức SPDX `Python-2.0.1`, được OSI công nhận; `python-dateutil` 2.9.0.post0 chỉ có classifier, tệp
  LICENSE ghi BSD-3-Clause áp cho mọi mã. Bảng README nay ghi đủ giấy phép thư viện của từng dịch vụ tự viết.
- Giấy phép thư viện Python tin vào điều gói tự khai trong METADATA, trừ bản ghi trong `[licenses.packages]`. Gói chỉ
  khai classifier chung "BSD License" không được nhận vì không rõ điều khoản; gói khai nhiều classifier thì mọi giấy
  phép khai đều phải được nhận, vì classifier không nói là chọn một hay theo cả hai.
- Chưa kiểm: action của GitHub ghim theo bản chính (`@v4`); giấy phép image nền trong Dockerfile (`python`, `node`,
  `uv`, `nginx`) vì đối chiếu README chỉ xét image trong `compose.yaml`.
- Không có pull request nâng cấp tự động: người xem tự mở. Nếu số bản mới mỗi tuần làm việc này nặng, có thể thêm
  Dependabot chỉ cho phần nâng phiên bản mà vẫn giữ script cho ghim và giấy phép.
