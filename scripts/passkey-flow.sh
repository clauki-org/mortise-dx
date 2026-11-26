#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dựng bù luồng đăng nhập Passkey (ADR 0042) trên realm `mortise` đang chạy. Tệp realm chỉ nạp khi Keycloak khởi động
# lần đầu, nên bản cài dựng trước đó chỉ có mật khẩu rồi OTP; `make seed` gọi lệnh này để không phải `make reset`.
# Mỗi phần được kiểm trước khi tạo, nên chạy lại, kể cả sau một lần dừng giữa chừng, chỉ tạo phần còn thiếu. Kết quả
# giống tệp realm, trừ một bước mật khẩu cũ ở `browser-mfa forms` được để DISABLED thay vì xóa: xóa một bước là
# Keycloak xóa luôn cấu hình `amr-pwd` của nó, mà cấu hình đó dùng chung với luồng lấy token bằng mật khẩu.
set -euo pipefail
cd "$(dirname "$0")/.."
# .env do `make env` sinh ra và không có trong repo, nên shellcheck không đọc theo.
set -a
# shellcheck source=/dev/null
source .env
set +a

kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }

if ! kc config credentials --server http://localhost:8080/auth --realm master \
  --user admin --password "$KEYCLOAK_ADMIN_PASSWORD" </dev/null >/dev/null 2>&1; then
  echo "Không đăng nhập được API quản trị Keycloak. Lõi đã chạy chưa (make up)?" >&2
  exit 1
fi

forms="browser-mfa forms"
# Bí danh luồng con nằm trong đường dẫn API, nên khoảng trắng phải mã hóa.
executions() { kc get "authentication/flows/${1// /%20}/executions" -r mortise </dev/null; }
# Mã của bước trực tiếp (level 0) trong một luồng, theo tên luồng con hay mã bộ xác thực; rỗng nếu chưa có.
step_id() {
  executions "$1" | jq -r --arg n "$2" '.[] | select(.level == 0 and (.displayName == $n or .providerId == $n)) | .id'
}

# Đặt yêu cầu (REQUIRED, CONDITIONAL, DISABLED...) cho một bước trực tiếp nếu đang khác. Gửi lại nguyên bản ghi đọc
# được: API so cả priority, thiếu trường đó là bước bị dời lên đầu luồng.
set_requirement() {
  local step
  step=$(executions "$1" | jq -c --arg n "$2" --arg r "$3" '.[] | select(.level == 0 and
    (.displayName == $n or .providerId == $n) and .requirement != $r) | .requirement = $r')
  [[ -z "$step" ]] || kc update "authentication/flows/${1// /%20}/executions" -r mortise -n -f - <<<"$step" >/dev/null
}

# Luồng con trong `browser-mfa forms` ở thứ tự cho trước. Keycloak tạo luồng con ở trạng thái DISABLED; yêu cầu thật
# đặt sau khi luồng con đủ bước, để người đang đăng nhập không gặp một bước bắt buộc còn rỗng.
ensure_subflow() {
  local alias=$1 priority=$2 description=$3
  if [[ -z "$(step_id "$forms" "$alias")" ]]; then
    jq -n --arg a "$alias" --arg d "$description" --argjson p "$priority" \
      '{alias: $a, type: "basic-flow", provider: "registration-page-form", description: $d, priority: $p}' |
      kc create "authentication/flows/${forms// /%20}/executions/flow" -r mortise -f - >/dev/null
  fi
}

# Một bộ xác thực trong luồng con `flow` của `browser-mfa forms`. Không có `config` thì `alias` là cấu hình đã có, dùng
# chung (amr-pwd); có thì tạo cấu hình mới tên `alias` với nội dung đó.
ensure_step() {
  local flow=$1 authenticator=$2 requirement=$3 priority=$4 alias=$5 config=${6:-} shared="" flow_id id
  [[ -n "$config" ]] || shared=$alias
  id=$(step_id "$flow" "$authenticator")
  if [[ -z "$id" ]]; then
    flow_id=$(executions "$forms" | jq -r --arg n "$flow" '.[] | select(.displayName == $n) | .flowId')
    jq -n --arg f "$flow_id" --arg a "$authenticator" --arg r "$requirement" --argjson p "$priority" --arg c "$shared" \
      '{parentFlow: $f, authenticator: $a, requirement: $r, priority: $p, authenticatorFlow: false}
        + (if $c == "" then {} else {authenticatorConfig: $c} end)' |
      kc create authentication/executions -r mortise -f - >/dev/null
    id=$(step_id "$flow" "$authenticator")
  fi
  # Chỉ gắn cấu hình mới lên bước chưa có cấu hình: gắn lên bước đã có thì Keycloak xóa cấu hình cũ.
  [[ -n "$config" ]] || return 0
  if [[ -z "$(executions "$flow" | jq -r --arg i "$id" '.[] | select(.id == $i) | .authenticationConfig // empty')" ]]
  then
    jq -n --arg a "$alias" --argjson c "$config" '{alias: $a, config: $c}' |
      kc create "authentication/executions/$id/config" -r mortise -f - >/dev/null
  fi
}

# Chính sách Passkey của realm. Tắt passkeysEnabled để ô mật khẩu không tự nhận Passkey: Passkey đi qua ô đó được ghi
# `pwd` trong amr như mật khẩu, và người duyệt sẽ không phân biệt được hai cách. Khóa phải lưu trên thiết bị (resident
# key) để đăng nhập không cần gõ tên.
kc update realms/mortise -s webAuthnPolicyPasswordlessRpEntityName="Mortise DX" \
  -s webAuthnPolicyPasswordlessResidentKey=required \
  -s webAuthnPolicyPasswordlessUserVerificationRequirement=required \
  -s webAuthnPolicyPasswordlessPasskeysEnabled=false </dev/null >/dev/null
kc update authentication/required-actions/webauthn-register-passwordless -r mortise -s enabled=true \
  </dev/null >/dev/null

web_client=$(kc get clients -r mortise -q clientId=mortise-web --fields id --format csv --noquotes </dev/null)
if ! kc get "clients/$web_client/roles/passkey_allowed" -r mortise </dev/null >/dev/null 2>&1; then
  kc create "clients/$web_client/roles" -r mortise -s name=passkey_allowed \
    -s "description=Được đăng nhập bằng Passkey (ADR 0042)" </dev/null >/dev/null
fi

first="browser-mfa first factor" policy="browser-mfa passkey policy"
# Yếu tố đầu đứng trước bước mật khẩu cũ (priority 10), gate Passkey trước luồng OTP (priority 20) vốn giữ nguyên.
ensure_subflow "$first" 5 "Yếu tố đầu: mật khẩu (amr pwd) hay Passkey (amr hwk)"
ensure_step "$first" auth-username-password-form ALTERNATIVE 10 amr-pwd
ensure_step "$first" webauthn-authenticator-passwordless ALTERNATIVE 20 amr-hwk \
  '{"default.reference.value": "hwk", "default.reference.maxAge": "36000"}'
ensure_subflow "$policy" 15 "Từ chối Passkey của tài khoản không có passkey_allowed"
ensure_step "$policy" conditional-credential REQUIRED 10 passkey-used \
  '{"credentials": "webauthn-passwordless", "included": "true"}'
ensure_step "$policy" conditional-user-role REQUIRED 20 passkey-not-allowed \
  '{"condUserRole": "mortise-web.passkey_allowed", "negate": "true"}'
ensure_step "$policy" deny-access-authenticator REQUIRED 30 passkey-denied \
  '{"denyErrorMessage": "Đơn vị của tài khoản này chưa cho đăng nhập bằng Passkey. Hãy đăng nhập bằng mật khẩu."}'
# Gate bật trước, rồi yếu tố đầu, rồi mới tắt bước mật khẩu cũ: trong lúc chuyển, người đăng nhập có thể bị hỏi mật
# khẩu hai lần, nhưng không lúc nào thiếu bước mật khẩu hay Passkey lọt qua gate.
set_requirement "$forms" "$policy" CONDITIONAL
set_requirement "$forms" "$first" REQUIRED
if [[ -n "$(step_id "$forms" auth-username-password-form)" ]]; then
  set_requirement "$forms" auth-username-password-form DISABLED
fi
echo "keycloak: luồng đăng nhập có Passkey cho tenant có passkey_allowed, OTP vẫn hỏi người có otp_required"
