<!--
SPDX-FileCopyrightText: 2026 Mortise DX contributors
SPDX-License-Identifier: Apache-2.0
-->

# Triển khai lên máy chủ demo

Máy chủ chạy đúng image CI đã dựng và kiểm cho một tag phát hành, tự kéo bản mới về, smoke lỗi thì quay về tag trước.
Lý do và các cách đã cân nhắc: [ADR 0036](../docs/adr/0036-pull-based-gitops-with-compose.md).

| Tệp | Vai trò |
|---|---|
| `pull-deploy.sh` | Một lần kéo và triển khai: chọn tag, kéo image, sao lưu, dựng, smoke, quay về nếu lỗi |
| `systemd/mortise-deploy.service`, `.timer` | Chạy `pull-deploy.sh` 5 phút sau khi khởi động, rồi 15 phút một lần |
| `deploy.env.example` | Mẫu cho `/etc/mortise/deploy.env` |

**Chỉ dành cho máy chủ demo.** Mỗi lần triển khai chạy `make seed` và smoke, chúng tạo tài khoản demo, hồ sơ và tệp thử.
Không dùng cho bản cài có dữ liệu thật. Keycloak vẫn chạy chế độ `start-dev`.

## Yêu cầu

Linux có systemd; Docker Engine với Docker Compose v2; `git`, `make`, `curl`,
`jq`, `openssl`, `flock` (util-linux) và [`uv`](https://docs.astral.sh/uv/) như ở README gốc.

## Cài lần đầu từ một tag

```bash
sudo useradd --system --create-home --groups docker mortise
sudo install -d -o mortise -g mortise -m 700 /opt/mortise-dx /var/backups/mortise-dx
sudo -iu mortise
git clone https://github.com/clauki-org/mortise-dx.git /opt/mortise-dx && cd /opt/mortise-dx
git checkout --detach v0.1.0
make env                         # sinh .env; sửa MORTISE_PUBLIC_URL, MORTISE_BIND theo địa chỉ của máy chủ
printf 'MORTISE_IMAGE_PREFIX=ghcr.io/clauki-org/mortise-dx\nMORTISE_VERSION=v0.1.0\nMORTISE_NO_BUILD=1\n' >> .env
make up && make seed && make smoke
make app-install APP=facilities-commune && make app-install APP=supplies-commune && make seed-demo
```

Ba dòng thêm vào `.env` trỏ tám dịch vụ tự viết sang image CI đã đẩy cho tag ghi ở `MORTISE_VERSION`, và
`MORTISE_NO_BUILD=1` làm mọi lệnh `make` (qua `scripts/compose.sh`) từ chối dựng image tại chỗ: image thiếu thì kéo,
kéo không được thì dừng. Từ đó `pull-deploy.sh` tự ghi lại ba dòng này mỗi lần đổi bản. Đừng gọi thẳng
`docker compose run --build` hay `docker compose build` trên máy chủ: chúng dựng đè image phát hành.

## Bật bộ hẹn giờ

```bash
sudo install -d /etc/mortise
sudo install -m 644 /opt/mortise-dx/deploy/deploy.env.example /etc/mortise/deploy.env   # sửa nếu cần
sudo install -m 644 /opt/mortise-dx/deploy/systemd/mortise-deploy.service \
  /opt/mortise-dx/deploy/systemd/mortise-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mortise-deploy.timer
sudo systemctl start mortise-deploy.service      # chạy ngay một lần, không chờ lịch
```

Unit được chép vào `/etc/systemd/system/`, không trỏ thẳng vào repo, vì thư mục clone đổi theo mỗi tag. Bản phát hành
đổi unit thì CHANGELOG ghi, chép lại như trên.

Mỗi lần chạy, `pull-deploy.sh`:

1. Hỏi GitHub Release mới nhất không phải bản thử (`MORTISE_PIN` có giá trị thì dùng tag đó). Trùng bản đang chạy, hay
   nằm trong danh sách lỗi, thì dừng.
2. Kéo image của tag đích trong một worktree tạm, chưa đụng tới bản đang chạy. Kéo lỗi (mạng, image chưa đẩy xong) thì
   dừng với mã 75; lần hẹn sau thử lại.
3. Sao lưu bằng `make backup` (dịch vụ ghi dữ liệu dừng trong lúc sao lưu).
4. `git checkout --detach <tag>`, `make env`, ghi `MORTISE_IMAGE_PREFIX`, `MORTISE_VERSION`, `MORTISE_NO_BUILD`, dựng lại
   mọi container
   (`docker compose up -d --wait --force-recreate`: tệp cấu hình gắn vào container như routes của APISIX chỉ được đọc
   lại khi tạo lại container), `make seed`, `make app-install` cho từng gói trong `MORTISE_APPS`, `make smoke` và
   `make app-smoke` từng gói.
5. Lỗi ở bước 4: ghi tag vào danh sách lỗi, checkout tag trước, dựng lại, seed, smoke; in lệnh khôi phục CSDL.

Thư mục clone phải sạch (không có thay đổi chưa commit), nếu không script dừng thay vì checkout đè lên.

## Ghim một bản, bỏ ghim

```bash
sudo sed -i 's/^MORTISE_PIN=.*/MORTISE_PIN=v0.1.0/' /etc/mortise/deploy.env   # giữ ở v0.1.0, kể cả khi có bản mới
sudo sed -i 's/^MORTISE_PIN=.*/MORTISE_PIN=/' /etc/mortise/deploy.env         # theo Release mới nhất trở lại
```

Bản thử (`vX.Y.Z-rc.N`) chỉ lên máy chủ khi ghim đúng tag đó.

## Quay về bản trước bằng tay

Ghim tag cũ rồi chạy ngay: `MORTISE_PIN=<tag cũ>` như trên, `sudo systemctl start mortise-deploy.service`. Tag đang chạy
và tag trước nằm ở `/var/lib/mortise-deploy/current` và `previous`. Quay về chỉ đổi image và mã; CSDL giữ nguyên, kể cả
migration bản mới đã chạy.

Tag nằm trong `/var/lib/mortise-deploy/failed` không được thử lại; xóa dòng của nó sau khi đã có bản sửa mà vẫn muốn
chạy lại tag đó.

## Khôi phục CSDL sau một migration hỏng

Script không bao giờ tự khôi phục CSDL. Khi bản mới lỗi, log in lệnh với bản sao lưu làm ngay trước lần triển khai (đường
dẫn cũng ghi ở `/var/lib/mortise-deploy/last_backup`). Bản sao lưu đó làm khi lõi còn chạy tag trước, và lúc in lệnh
thư mục clone đã quay về đúng tag trước:

```bash
sudo systemctl stop mortise-deploy.timer
sudo -iu mortise
cd /opt/mortise-dx
grep -E '^(git_commit|created_utc)=' <thư mục sao lưu>/MANIFEST   # commit lúc sao lưu phải trùng `git rev-parse --short HEAD`
make restore FROM=<thư mục sao lưu> CONFIRM=yes
make smoke
exit
sudo systemctl start mortise-deploy.timer
```

Khôi phục cài lại `.env` của bản sao lưu, gồm `MORTISE_VERSION` lúc sao lưu, nên image khớp dữ liệu.

## Xem log và trạng thái

```bash
systemctl list-timers mortise-deploy.timer        # lần chạy trước, lần chạy sau
journalctl -u mortise-deploy.service -e           # log của các lần triển khai
cat /var/lib/mortise-deploy/{current,previous,failed,last_backup}
```

Mã thoát: 0 xong hoặc không có gì làm; 75 chưa kéo được image hay chưa hỏi được GitHub, lần sau thử lại (systemd không
tính là lỗi); 1 bản mới lỗi và đã quay về bản trước, hay sao lưu lỗi; 2 quay về cũng lỗi, cần người vận hành.

Máy chủ hỏi API công khai của GitHub không kèm token, giới hạn 60 lần mỗi giờ cho một địa chỉ IP; vượt thì nhận 403 và
thử lại lần sau.

## Tự phục hồi và giới hạn

Mọi dịch vụ chạy lâu có `restart: unless-stopped`: tiến trình chính thoát hay máy khởi động lại thì Docker dựng lại.
`make heal-check SERVICE=workflow-api` kiểm điều đó trên lõi đang chạy. Docker không dựng lại container khi người vận
hành dừng nó (`docker stop`, `docker compose stop`, `docker kill`), và không dựng lại container còn chạy mà healthcheck
báo unhealthy.

## Thử script mà không đụng máy chủ

`MORTISE_DEPLOY_ENV=<tệp cấu hình>` đổi nơi đọc cấu hình; `MORTISE_TAG_SOURCE=git` lấy tag mới nhất trong git thay vì
GitHub Release, để thử trên một bản sao với tag giả và `make`, `docker` giả trong `PATH`.
