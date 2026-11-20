#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Dịch vụ ghi vào CSDL, kho tệp hay tài khoản MQTT, kể cả cổng nhận yêu cầu ghi từ ngoài vào. scripts/backup.sh dừng
# chúng trong lúc sao lưu để CSDL, CSDL của Scorpio và kho tệp cùng một thời điểm; scripts/restore.sh dừng chúng
# trong lúc nạp để không có gì ghi xen vào dữ liệu đang bị ghi đè. Thêm dịch vụ mới có ghi thì thêm vào đây; thiếu
# một dịch vụ thì bản sao lưu có thể có dòng trỏ tới tệp không có, hoặc tệp không còn dòng nào trỏ tới.
# shellcheck disable=SC2034  # dùng ở tệp source tệp này
writers=(apisix workflow-api files-api flowable hasura keycloak context-api iot-bridge mosquitto scorpio seaweedfs)
