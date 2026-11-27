-- SPDX-FileCopyrightText: 2026 Mortise DX contributors
-- SPDX-License-Identifier: Apache-2.0
--
-- Phiếu nhập, phiếu xuất và tồn kho (ADR 0062). Mỗi phiếu là một dòng cha, mỗi mặt hàng trên phiếu là một dòng con;
-- tồn kho là view tính từ tồn đầu của mặt hàng cộng số nhập trừ số xuất, không lưu ở đâu nên không lệch được. Gói chỉ
-- gồm khai báo (ADR 0022): luật "không xuất quá số đang có" đi qua platform.empty_guard_attach của nền tảng, nhật ký
-- qua core.audit_attach của lõi (ADR 0009).

-- migrate:up

-- Phiếu nhập: một lần hàng vào kho. Kho ghi trên từng dòng chứ không trên phiếu: biểu mẫu thêm dòng con chỉ điền sẵn
-- mã phiếu, nên kho ghi trên phiếu sẽ phải chọn lại ở mỗi dòng và có thể chọn lệch.
CREATE TABLE app_supplies_commune.receipts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    code        text NOT NULL CHECK (code <> ''),
    received_on date NOT NULL DEFAULT current_date,
    -- Bên giao hàng (nhà cung cấp, đơn vị cấp trên); chữ tự do vì gói không quản lý danh bạ đối tác.
    partner     text,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

CREATE TABLE app_supplies_commune.issues (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES core.tenants (id) ON DELETE RESTRICT,
    code       text NOT NULL CHECK (code <> ''),
    issued_on  date NOT NULL DEFAULT current_date,
    -- Bên nhận hàng (bộ phận, công trình, người nhận).
    partner    text,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);

-- Dòng của phiếu. Khóa ngoại ghép kèm tenant_id như bảng mặt hàng: không ghi được dòng vào phiếu hay mặt hàng của
-- tenant khác. RESTRICT: xóa phiếu còn dòng hay mặt hàng đã có dòng bị từ chối, không mất lịch sử nhập xuất. Mỗi
-- mặt hàng một dòng trên một phiếu, để bộ nạp dữ liệu demo nhận ra dòng đã nạp.
CREATE TABLE app_supplies_commune.receipt_lines (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    text NOT NULL,
    receipt_code text NOT NULL,
    store_code   text NOT NULL,
    item_code    text NOT NULL,
    quantity     numeric(12, 2) NOT NULL CHECK (quantity > 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, receipt_code)
        REFERENCES app_supplies_commune.receipts (tenant_id, code) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, store_code, item_code)
        REFERENCES app_supplies_commune.items (tenant_id, store_code, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, receipt_code, store_code, item_code)
);

CREATE TABLE app_supplies_commune.issue_lines (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL,
    issue_code text NOT NULL,
    store_code text NOT NULL,
    item_code  text NOT NULL,
    quantity   numeric(12, 2) NOT NULL CHECK (quantity > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant_id, issue_code)
        REFERENCES app_supplies_commune.issues (tenant_id, code) ON DELETE RESTRICT,
    FOREIGN KEY (tenant_id, store_code, item_code)
        REFERENCES app_supplies_commune.items (tenant_id, store_code, code) ON DELETE RESTRICT,
    UNIQUE (tenant_id, issue_code, store_code, item_code)
);

-- Tồn kho của từng mặt hàng trong từng kho. items.quantity là tồn đầu, nhập lúc thêm mặt hàng. Cộng nhập và xuất
-- riêng rồi mới nối: nối cả hai bảng dòng cùng lúc thì mỗi dòng nhập lặp theo số dòng xuất và tổng sai. id là id của
-- mặt hàng, làm khóa cho danh mục.
CREATE VIEW app_supplies_commune.stock AS
SELECT i.id, i.tenant_id, i.store_code, i.code AS item_code, i.name, i.unit, i.kind,
       i.quantity AS opening,
       coalesce(r.quantity, 0) AS received,
       coalesce(s.quantity, 0) AS issued,
       i.quantity + coalesce(r.quantity, 0) - coalesce(s.quantity, 0) AS on_hand
FROM app_supplies_commune.items i
LEFT JOIN (
    SELECT tenant_id, store_code, item_code, sum(quantity) AS quantity
    FROM app_supplies_commune.receipt_lines GROUP BY tenant_id, store_code, item_code
) r ON r.tenant_id = i.tenant_id AND r.store_code = i.store_code AND r.item_code = i.code
LEFT JOIN (
    SELECT tenant_id, store_code, item_code, sum(quantity) AS quantity
    FROM app_supplies_commune.issue_lines GROUP BY tenant_id, store_code, item_code
) s ON s.tenant_id = i.tenant_id AND s.store_code = i.store_code AND s.item_code = i.code;

-- Mặt hàng có tồn âm. View này phải luôn rỗng: platform.empty_guard_attach từ chối lệnh ghi làm nó có dòng.
CREATE VIEW app_supplies_commune.stock_shortfalls AS
SELECT tenant_id, store_code, item_code, on_hand FROM app_supplies_commune.stock WHERE on_hand < 0;

-- Ba bảng làm tồn giảm được: thêm, sửa dòng xuất; xóa dòng nhập; hạ tồn đầu của mặt hàng.
SELECT platform.empty_guard_attach('app_supplies_commune.issue_lines', 'app_supplies_commune.stock_shortfalls',
    'Số xuất vượt số tồn của mặt hàng trong kho. Giảm số lượng hoặc lập phiếu nhập trước.');
SELECT platform.empty_guard_attach('app_supplies_commune.receipt_lines', 'app_supplies_commune.stock_shortfalls',
    'Bỏ dòng nhập này thì tồn của mặt hàng xuống dưới số đã xuất.');
SELECT platform.empty_guard_attach('app_supplies_commune.items', 'app_supplies_commune.stock_shortfalls',
    'Tồn đầu mới làm tồn của mặt hàng xuống dưới số đã xuất.');

SELECT core.audit_attach('app_supplies_commune.receipts');
SELECT core.audit_attach('app_supplies_commune.receipt_lines');
SELECT core.audit_attach('app_supplies_commune.issues');
SELECT core.audit_attach('app_supplies_commune.issue_lines');

-- migrate:down
-- Bỏ trigger của luật trên items trước: bảng này còn lại sau khi lùi migration. DROP TABLE xóa trigger, nhật ký gắn
-- trên bảng dòng và phiếu; dòng đã ghi trong core.audit_log vẫn còn.
DROP TRIGGER empty_guard_stock_shortfalls ON app_supplies_commune.items;
DROP VIEW app_supplies_commune.stock_shortfalls;
DROP VIEW app_supplies_commune.stock;
DROP TABLE app_supplies_commune.issue_lines;
DROP TABLE app_supplies_commune.receipt_lines;
DROP TABLE app_supplies_commune.issues;
DROP TABLE app_supplies_commune.receipts;
