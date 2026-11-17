import asyncio
from typing import TYPE_CHECKING
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import Settings

if TYPE_CHECKING:  # the stubs exist for the type checker only; boto3 builds clients at run time
    from types_boto3_s3 import S3Client
    from types_boto3_s3.type_defs import ObjectIdentifierTypeDef

_CONFIG = Config(
    signature_version="s3v4",
    s3={"addressing_style": "path"},  # http://host/bucket/key, which RustFS (like MinIO) serves
    # Newer botocore adds CRC32 checksum parameters to presigned PUTs; a browser can't compute
    # them, so its upload would be rejected. Only send checksums when an operation requires one.
    request_checksum_calculation="when_required",
    response_checksum_validation="when_required",
)


class Storage:
    """S3 through boto3. boto3 is synchronous, so every network call runs in a worker thread."""

    def __init__(self, settings: Settings) -> None:
        def client(endpoint: str) -> S3Client:
            return boto3.client(
                "s3",
                endpoint_url=endpoint,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                config=_CONFIG,
            )

        self._internal = client(str(settings.s3_endpoint))
        # Signatures cover the host, so URLs for the browser are signed with the public endpoint.
        self._presigner = client(str(settings.s3_public_endpoint))
        self.bucket = settings.s3_bucket

    def presign_upload(self, key: str, content_type: str, size_bytes: int, expires_in: int) -> str:
        # Signing is local computation (no network), so it needs no thread.
        return self._presigner.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": size_bytes,
            },
            ExpiresIn=expires_in,
        )

    def presign_download(self, key: str, file_name: str, expires_in: int) -> str:
        disposition = f"attachment; filename*=UTF-8''{quote(file_name, safe='')}"
        return self._presigner.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key, "ResponseContentDisposition": disposition},
            ExpiresIn=expires_in,
        )

    async def size_of(self, key: str) -> int | None:
        """The stored object's size, or None if it doesn't exist."""
        try:
            head = await asyncio.to_thread(self._internal.head_object, Bucket=self.bucket, Key=key)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return head["ContentLength"]

    async def delete_prefix(self, prefix: str) -> int:
        """Deletes every object under a prefix, 1000 keys per request (the S3 maximum)."""
        return await asyncio.to_thread(self._delete_prefix, prefix)

    def _delete_prefix(self, prefix: str) -> int:
        deleted = 0
        paginator = self._internal.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objects: list[ObjectIdentifierTypeDef] = [
                {"Key": o["Key"]} for o in page.get("Contents", []) if "Key" in o
            ]
            if objects:
                self._internal.delete_objects(Bucket=self.bucket, Delete={"Objects": objects})
                deleted += len(objects)
        return deleted
