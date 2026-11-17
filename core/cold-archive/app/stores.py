# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Kết nối tới ba nơi công cụ dùng: PostgreSQL (nhật ký và bảng đoạn), DuckDB (ghi và đọc Parquet, đọc thẳng
# PostgreSQL), SeaweedFS qua S3 (bucket kho lạnh). Lỗi kết nối đổi thành thông báo kèm cách khắc phục.

import boto3
import duckdb
import pg8000.native
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .config import Settings

# Tiện ích của DuckDB đã cài sẵn ở đây lúc dựng image (Dockerfile); không cho tự tải để không cần internet.
EXTENSIONS = "/srv/duckdb-extensions"


def postgres(settings: Settings) -> pg8000.native.Connection:
    try:
        return pg8000.native.Connection(
            settings.db_user, host=settings.db_host, database=settings.db_name, password=settings.db_password
        )
    except (OSError, pg8000.exceptions.InterfaceError, pg8000.exceptions.DatabaseError) as error:
        raise SystemExit(f"Không kết nối được PostgreSQL ({error}); kiểm tra `make ps`.") from error


def duck(settings: Settings, extension_directory: str = EXTENSIONS) -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(
        config={"extension_directory": extension_directory, "autoinstall_known_extensions": False}
    )
    connection.execute("LOAD httpfs")
    connection.execute("LOAD postgres")
    connection.execute(
        "CREATE SECRET cold (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, URL_STYLE 'path', USE_SSL false, "
        "REGION 'us-east-1')",
        [settings.s3_access_key, settings.s3_secret_key, settings.s3_endpoint],
    )
    dsn = (
        f"host={settings.db_host} dbname={settings.db_name} user={settings.db_user} "
        f"password={settings.db_password}"
    )
    connection.execute("ATTACH ? AS pg (TYPE postgres, READ_ONLY)", [dsn])
    return connection


def ensure_bucket(settings: Settings) -> None:
    client = boto3.client(
        "s3",
        endpoint_url=f"http://{settings.s3_endpoint}",
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, connect_timeout=5, retries={"max_attempts": 2}),
    )
    try:
        client.head_bucket(Bucket=settings.bucket)
    except ClientError:
        try:
            client.create_bucket(Bucket=settings.bucket)
        except (BotoCoreError, ClientError) as error:
            raise SystemExit(
                f"Không tạo được bucket {settings.bucket} ({error}); kiểm tra seaweedfs."
            ) from error
    except BotoCoreError as error:
        raise SystemExit(f"Không kết nối được SeaweedFS ({error}); kiểm tra `make ps`.") from error
