# SPDX-FileCopyrightText: 2026 Mortise DX contributors
# SPDX-License-Identifier: Apache-2.0
#
# Nội dung tệp trong SeaweedFS qua API S3. Khóa của đối tượng là <tenant>/<id>, nên tệp của
# hai tenant tách nhau ngay ở chỗ lưu, không chỉ ở bảng thông tin. Chỉ module này biết S3.

import logging
from typing import BinaryIO

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .config import settings
from .policy import Denied

_s3 = boto3.client(
    "s3",
    endpoint_url=settings.s3_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    # SeaweedFS không quan tâm vùng nhưng chữ ký S3 cần một giá trị; path-style vì không có DNS cho bucket.
    region_name="us-east-1",
    config=Config(
        s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30, retries={"max_attempts": 2}
    ),
)


def _key(tenant: str, file_id: str) -> str:
    return f"{tenant}/{file_id}"


log = logging.getLogger("files-api.storage")


def _unavailable(error: Exception) -> Denied:
    # Chi tiết lỗi S3 có tên bucket và khóa nội bộ: ghi vào log cho người vận hành, không trả cho client.
    log.error("SeaweedFS lỗi: %s", error)
    return Denied(
        503, "Không lưu hay đọc được tệp; báo người vận hành kiểm tra dịch vụ seaweedfs (`make ps`)."
    )


def _code(error: ClientError) -> str:
    return error.response.get("Error", {}).get("Code", "")


_bucket_ready = False


def _ensure_bucket() -> None:
    # Bucket được tạo ở lần tải lên đầu tiên của bản cài, không cần bước cài đặt riêng.
    global _bucket_ready
    if _bucket_ready:
        return
    try:
        _s3.head_bucket(Bucket=settings.bucket)
    except ClientError:
        try:
            _s3.create_bucket(Bucket=settings.bucket)
        except ClientError as error:
            # Hai lần tải lên đầu tiên cùng lúc: yêu cầu kia vừa tạo bucket, không phải lỗi.
            if _code(error) not in {"BucketAlreadyExists", "BucketAlreadyOwnedByYou"}:
                raise
    _bucket_ready = True


def put(tenant: str, file_id: str, body: BinaryIO, content_type: str) -> None:
    try:
        _ensure_bucket()
        _s3.upload_fileobj(
            body, settings.bucket, _key(tenant, file_id), ExtraArgs={"ContentType": content_type}
        )
    except (BotoCoreError, ClientError) as error:
        raise _unavailable(error) from error


def open_stream(tenant: str, file_id: str):
    try:
        return _s3.get_object(Bucket=settings.bucket, Key=_key(tenant, file_id))["Body"]
    except ClientError as error:
        # Có thông tin tệp mà không có nội dung, ví dụ khôi phục bản sao lưu chụp giữa lúc đang tải lên.
        if _code(error) in {"NoSuchKey", "404"}:
            log.error("Thiếu nội dung của tệp %s/%s", tenant, file_id)
            raise Denied(404, "Nội dung tệp không còn trong kho lưu trữ; báo người vận hành.") from error
        raise _unavailable(error) from error
    except BotoCoreError as error:
        raise _unavailable(error) from error


def delete(tenant: str, file_id: str) -> None:
    try:
        _s3.delete_object(Bucket=settings.bucket, Key=_key(tenant, file_id))
    except (BotoCoreError, ClientError):
        # Gọi khi ghi thông tin tệp thất bại; đối tượng mồ côi còn sót không ai đọc được, không báo lỗi chồng.
        pass
