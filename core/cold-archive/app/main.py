# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Công cụ kho lạnh của người vận hành (dịch vụ cold-archive, profile tools trong compose.yaml; ADR 0014):
#   archive --before <ngày hay thời điểm ISO>   xuất nhật ký cũ hơn mốc sang kho lạnh (make archive)
#   query "<SQL>"                               truy vấn bảng ảo audit_all bằng DuckDB (make cold-query)
#   verify [--anchor <id>:<băm>]                tính lại chuỗi băm của mọi đoạn từ tệp (make cold-verify)
# Không có route qua cổng: tệp kho lạnh chứa giá trị trước và sau của mọi tenant.

import argparse
import re
import sys
from datetime import UTC, datetime

import duckdb
import pg8000
from botocore.exceptions import BotoCoreError, ClientError

from . import config, query, stores
from .archive import Busy, Mismatch, archive
from .verify import verify


def cutoff(text: str) -> datetime:
    """`2026-11-01` là 0 giờ UTC ngày đó; thời điểm ISO phải có múi giờ."""
    try:
        moment = datetime.fromisoformat(text)
    except ValueError as error:
        raise SystemExit(f"--before phải là ngày hay thời điểm ISO 8601, nhận: {text}") from error
    if moment.tzinfo is None:
        if len(text) > 10:
            raise SystemExit("--before có giờ thì phải có múi giờ, ví dụ 2026-11-01T00:00:00Z")
        moment = moment.replace(tzinfo=UTC)
    return moment


def anchor_of(text: str) -> tuple[int, bytes]:
    """`<id>:<sha256 hex>` như audit_head trong MANIFEST của bản sao lưu."""
    found = re.fullmatch(r"([0-9]+):([0-9a-f]{64})", text)
    if not found:
        raise SystemExit(f"--anchor phải có dạng <id>:<sha256 hex>, nhận: {text}")
    return int(found[1]), bytes.fromhex(found[2])


def main() -> int:
    parser = argparse.ArgumentParser(prog="cold-archive", description="Kho lạnh của nhật ký thay đổi")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("archive").add_argument("--before", required=True)
    commands.add_parser("query").add_argument("sql")
    commands.add_parser("verify").add_argument("--anchor")
    args = parser.parse_args()

    settings = config.load()
    pg = stores.postgres(settings)
    duck = stores.duck(settings)
    if args.command == "archive":
        stores.ensure_bucket(settings)
        try:
            print(archive(pg, duck, settings.bucket, cutoff(args.before)))
        except (Mismatch, Busy) as error:
            raise SystemExit(f"Không ghi nhận đoạn: {error}.") from error
        except duckdb.Error as error:
            raise SystemExit(f"Không ghi hay đọc được tệp kho lạnh ({error}); kiểm tra seaweedfs.") from error
        except (pg8000.exceptions.DatabaseError, pg8000.exceptions.InterfaceError) as error:
            raise SystemExit(f"PostgreSQL báo lỗi ({error}); không có đoạn nào được ghi nhận.") from error
        except (BotoCoreError, ClientError) as error:
            raise SystemExit(f"SeaweedFS báo lỗi ({error}); kiểm tra `make ps`.") from error
        return 0
    if args.command == "verify":
        try:
            problems, summary = verify(
                pg, duck, settings.bucket, anchor_of(args.anchor) if args.anchor else None
            )
        except duckdb.Error as error:
            raise SystemExit(f"Không đọc được tệp kho lạnh ({error}); kiểm tra seaweedfs.") from error
        if problems:
            print("Kho lạnh không còn nguyên vẹn:", *problems, sep="\n", file=sys.stderr)
            return 1
        print(summary + (f"; khớp neo tại dòng {args.anchor.split(':')[0]}" if args.anchor else ""))
        return 0
    query.define(pg, duck, settings.bucket)
    print(query.run(duck, args.sql))
    return 0


if __name__ == "__main__":
    sys.exit(main())
