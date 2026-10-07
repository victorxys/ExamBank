"""Image storage helpers for the ExamDB image migration.

New images are written to Qiniu. R2 remains a read-only legacy source and is
handled by the migration script or the dynamic-form reader.
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4


logger = logging.getLogger(__name__)

ROOT_PREFIX = "hr_media/"
IMAGE_MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}
MIME_EXTENSIONS = {mime: extension for extension, mime in IMAGE_MIME_TYPES.items()}


class ImageStorageError(RuntimeError):
    """Base error for image storage failures."""


class ImageStorageConfigurationError(ImageStorageError):
    """Raised when the Qiniu configuration is incomplete or invalid."""


class ImageStorageUploadError(ImageStorageError):
    """Raised when Qiniu rejects or cannot complete an upload."""


@dataclass(frozen=True)
class QiniuImageConfig:
    access_key: str
    secret_key: str
    bucket: str
    domain: str
    upload_url: str
    max_attempts: int = 3
    retry_backoff_seconds: float = 0.5
    download_expires_seconds: int = 300

    @classmethod
    def from_env(cls) -> "QiniuImageConfig":
        values = {
            name: os.environ.get(name, "").strip()
            for name in (
                "QINIU_ACCESS_KEY",
                "QINIU_SECRET_KEY",
                "QINIU_BUCKET",
                "QINIU_DOMAIN",
                "QINIU_UPLOAD_URL",
            )
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise ImageStorageConfigurationError(
                "七牛云配置不完整: " + ", ".join(missing)
            )

        domain = values["QINIU_DOMAIN"].rstrip("/")
        if not domain.startswith(("http://", "https://")):
            domain = "https://" + domain

        upload_url = values["QINIU_UPLOAD_URL"].rstrip("/")
        if not upload_url.startswith(("http://", "https://")):
            raise ImageStorageConfigurationError("QINIU_UPLOAD_URL 必须是 HTTP(S) 地址")

        return cls(
            access_key=values["QINIU_ACCESS_KEY"],
            secret_key=values["QINIU_SECRET_KEY"],
            bucket=values["QINIU_BUCKET"],
            domain=domain,
            upload_url=upload_url,
            max_attempts=_env_positive_int("QINIU_MAX_ATTEMPTS", 3),
            retry_backoff_seconds=_env_nonnegative_float(
                "QINIU_RETRY_BACKOFF_SECONDS", 0.5
            ),
            download_expires_seconds=_env_positive_int(
                "QINIU_DOWNLOAD_EXPIRES_SECONDS", 300
            ),
        )


def _env_positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def _env_nonnegative_float(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def mime_type_for_filename(filename: str, content_type: str | None = None) -> str | None:
    """Return a supported image MIME type without trusting arbitrary input."""
    extension = Path(filename or "").suffix.lower()
    if extension in IMAGE_MIME_TYPES:
        return IMAGE_MIME_TYPES[extension]

    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    if normalized_content_type in MIME_EXTENSIONS:
        return normalized_content_type
    return None


def extension_for_image(filename: str, content_type: str | None = None) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension in IMAGE_MIME_TYPES:
        return extension

    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    return MIME_EXTENSIONS.get(normalized_content_type, ".jpg")


def _safe_path_part(value: Any, fallback: str) -> str:
    text = str(value or "").strip("/")
    parts = [part for part in text.split("/") if part]
    safe_parts = [re.sub(r"[^A-Za-z0-9._-]+", "_", part) for part in parts]
    safe_parts = [part.strip(".") or fallback for part in safe_parts]
    return "/".join(safe_parts) or fallback


def build_image_key(
    module: str,
    business_id: str,
    extension: str,
    *,
    filename: str | None = None,
) -> str:
    """Build a collision-resistant key under the required hr_media prefix."""
    suffix = extension.lower() if extension else ""
    if suffix and not suffix.startswith("."):
        suffix = "." + suffix
    if suffix not in IMAGE_MIME_TYPES:
        raise ValueError(f"不支持的图片类型: {extension or '无扩展名'}")

    safe_module = _safe_path_part(module, "image")
    safe_business_id = _safe_path_part(business_id, "general")
    safe_filename = ""
    if filename:
        safe_filename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).stem)
        safe_filename = safe_filename.strip(".")

    # A UUID is always part of the key. The original filename is only a hint
    # and never the identity of the object.
    filename_hint = f"_{safe_filename}" if safe_filename else ""
    return f"{ROOT_PREFIX}{safe_module}/{safe_business_id}/{uuid4().hex}{filename_hint}{suffix}"


class QiniuImageStorage:
    """Small synchronous adapter around qiniu-python-sdk 7.12.1."""

    def __init__(self, config: QiniuImageConfig | None = None):
        self.config = config or QiniuImageConfig.from_env()

    def public_url(self, key: str) -> str:
        if not key or not key.startswith(ROOT_PREFIX):
            raise ValueError("七牛图片 key 必须以 hr_media/ 开头")
        return f"{self.config.domain}/{quote(key, safe='/')}"

    def stat_object(self, key: str) -> dict[str, Any] | None:
        """Return Qiniu object metadata, or None when the object is absent."""
        if not key or not key.startswith(ROOT_PREFIX):
            raise ValueError("七牛图片 key 必须以 hr_media/ 开头")

        try:
            from qiniu import Auth, BucketManager
        except ImportError as exc:
            raise ImageStorageConfigurationError(
                "未安装七牛云 SDK，请安装 qiniu==7.12.1"
            ) from exc

        auth = Auth(self.config.access_key, self.config.secret_key)
        result, info = BucketManager(auth).stat(self.config.bucket, key)
        status_code = getattr(info, "status_code", None)
        if status_code == 200:
            return result or {}
        if status_code == 612:
            return None

        detail = getattr(info, "text_body", "") or ""
        raise ImageStorageError(
            f"七牛云查询对象失败: status={status_code}, detail={detail[:300]}"
        )

    def private_download_url(self, key: str, *, expires: int | None = None) -> str:
        """Return a short-lived download URL for a private Qiniu space."""
        try:
            from qiniu import Auth
        except ImportError as exc:
            raise ImageStorageConfigurationError(
                "未安装七牛云 SDK，请安装 qiniu==7.12.1"
            ) from exc

        lifetime = (
            self.config.download_expires_seconds
            if expires is None
            else expires
        )
        if lifetime < 1:
            raise ValueError("七牛下载签名有效期必须大于 0 秒")

        auth = Auth(self.config.access_key, self.config.secret_key)
        return auth.private_download_url(
            self.public_url(key),
            expires=lifetime,
        )

    def _upload_once(self, data: bytes, key: str, mime_type: str, filename: str):
        try:
            from qiniu import Auth, Zone
            from qiniu.services.storage.uploaders import FormUploader
        except ImportError as exc:
            raise ImageStorageConfigurationError(
                "未安装七牛云 SDK，请安装 qiniu==7.12.1"
            ) from exc

        auth = Auth(self.config.access_key, self.config.secret_key)
        token = auth.upload_token(self.config.bucket, key, expires=3600)
        zone = Zone(
            up_host=self.config.upload_url,
            # Supplying both hosts makes QINIU_UPLOAD_URL authoritative and
            # avoids an extra region-discovery request for every upload.
            up_host_backup=self.config.upload_url,
        )
        uploader = FormUploader(
            self.config.bucket,
            auth=auth,
            regions=[zone],
        )
        return uploader.upload(
            key=key,
            data=data,
            data_size=len(data),
            file_name=filename,
            mime_type=mime_type,
            up_token=token,
        )

    @staticmethod
    def _retryable_status(status_code: int | None) -> bool:
        return status_code in {408, 425, 429, 500, 502, 503, 504}

    def upload_bytes(
        self,
        data: bytes,
        key: str,
        mime_type: str,
        *,
        filename: str | None = None,
    ) -> dict[str, str]:
        if not isinstance(data, (bytes, bytearray)) or not data:
            raise ValueError("图片内容不能为空")
        if not key.startswith(ROOT_PREFIX):
            raise ValueError("七牛图片 key 必须以 hr_media/ 开头")
        if mime_type not in IMAGE_MIME_TYPES.values():
            raise ValueError(f"不支持的图片 MIME 类型: {mime_type}")

        upload_filename = filename or key.rsplit("/", 1)[-1]
        last_error: Exception | None = None
        for attempt in range(self.config.max_attempts):
            status_code = None
            try:
                result, info = self._upload_once(
                    bytes(data), key, mime_type, upload_filename
                )
                status_code = getattr(info, "status_code", None)
                if status_code == 200:
                    return {
                        "key": key,
                        "url": self.public_url(key),
                        "hash": str(result.get("hash", "")) if isinstance(result, dict) else "",
                    }

                detail = getattr(info, "text_body", "") or ""
                error = ImageStorageUploadError(
                    f"七牛云上传失败: status={status_code}, detail={detail[:300]}"
                )
                last_error = error
                if not self._retryable_status(status_code):
                    raise error
            except ImageStorageConfigurationError:
                raise
            except ImageStorageUploadError as exc:
                last_error = exc
                if not self._retryable_status(status_code):
                    raise
            except Exception as exc:  # SDK/network errors are retryable.
                last_error = exc

            if attempt + 1 < self.config.max_attempts:
                delay = self.config.retry_backoff_seconds * (2**attempt)
                if delay:
                    time.sleep(delay)

        raise ImageStorageUploadError(
            f"七牛云上传失败，已重试 {self.config.max_attempts} 次"
        ) from last_error


def upload_image_bytes(
    data: bytes,
    module: str,
    business_id: str,
    mime_type: str,
    *,
    filename: str | None = None,
    extension: str | None = None,
) -> dict[str, str]:
    """Generate a new key and upload image bytes to Qiniu."""
    selected_extension = extension or MIME_EXTENSIONS.get(mime_type)
    if not selected_extension:
        raise ValueError(f"无法从 MIME 类型推断图片扩展名: {mime_type}")
    key = build_image_key(
        module,
        business_id,
        selected_extension,
        filename=filename,
    )
    return QiniuImageStorage().upload_bytes(
        data,
        key,
        mime_type,
        filename=filename,
    )
