-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Luật ngưỡng của số đo thiết bị (contracts/threshold-rule.schema.json), một dòng mỗi luật mỗi tenant. Bộ cài gói
-- (scripts/app-deploy.py) và `make seed` (luật mẫu của lõi) ghi và xóa; core/iot-bridge đọc để biết khi nào mở hồ
-- sơ. Người dùng không sửa.

-- migrate:up
CREATE TABLE core.threshold_rules (
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE CASCADE,
    -- Gói sở hữu luật (id trong app.yaml), hay `core` cho luật mẫu của lõi; gỡ gói thì xóa theo cột này.
    app        text NOT NULL,
    rule       text NOT NULL,
    -- Nội dung tệp luật, đã kiểm theo schema ở `make check-fast`.
    definition jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, app, rule)
);

-- Đổi luật là đổi khi nào hồ sơ được mở, nên có nhật ký như menu và khai báo bước (ADR 0009).
SELECT core.audit_attach('core.threshold_rules');

GRANT SELECT ON core.threshold_rules TO iot_bridge;

-- migrate:down
REVOKE SELECT ON core.threshold_rules FROM iot_bridge;
SELECT core.audit_detach('core.threshold_rules');
DROP TABLE core.threshold_rules;
