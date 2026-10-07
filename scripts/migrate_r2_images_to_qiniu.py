#!/usr/bin/env python3
"""Migrate legacy R2 image URLs in dynamic_form_data to Qiniu.

Safety rules:
* Without --apply this script only scans the database and performs no object
  or database writes.
* With --apply, R2 is read through GetObject only. This script never deletes
  or overwrites an R2 object.
* A database row is changed only after every legacy URL in that row has been
  uploaded successfully. The original row data is backed up first.
* The manifest makes an upload idempotent across process restarts. If an
  upload completed but the database commit failed, the next run reuses the
  recorded Qiniu URL.

Typical production use:

    /path/to/venv/bin/python scripts/migrate_r2_images_to_qiniu.py --dry-run
    /path/to/venv/bin/python scripts/migrate_r2_images_to_qiniu.py --apply \
        --manifest /var/backups/examdb/r2-to-qiniu.jsonl \
        --db-backup /var/backups/examdb/dynamic-form-data-before-qiniu.jsonl

Rollback restores the exact JSON data captured in the database backup. It
does not delete Qiniu objects:

    /path/to/venv/bin/python scripts/migrate_r2_images_to_qiniu.py --apply \
        --restore-backup /var/backups/examdb/dynamic-form-data-before-qiniu.jsonl
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote, urlparse
from uuid import UUID

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import boto3  # noqa: E402
from botocore.client import Config  # noqa: E402
from sqlalchemy.orm.attributes import flag_modified  # noqa: E402

from backend.app import app  # noqa: E402
from backend.extensions import db  # noqa: E402
from backend.models import DynamicForm, DynamicFormData  # noqa: E402
from backend.services.image_storage_service import (  # noqa: E402
    IMAGE_MIME_TYPES,
    MIME_EXTENSIONS,
    QiniuImageStorage,
)


LEGACY_IMAGE_HOST = "img.mengyimengsao.com"
ROOT_PREFIX = "hr_media/"


class MigrationItemError(RuntimeError):
    """An individual source image could not be migrated."""


@dataclass(frozen=True)
class R2Settings:
    account_id: str
    access_key: str
    secret_key: str
    bucket: str
    public_domain: str

    @classmethod
    def from_env(cls) -> "R2Settings":
        values = {
            name: os.environ.get(name, "").strip()
            for name in (
                "CF_ACCOUNT_ID",
                "R2_ACCESS_KEY_ID",
                "R2_SECRET_ACCESS_KEY",
                "R2_BUCKET_NAME",
                "PUBLIC_DOMAIN",
            )
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise MigrationItemError("R2 配置不完整: " + ", ".join(missing))
        return cls(
            account_id=values["CF_ACCOUNT_ID"],
            access_key=values["R2_ACCESS_KEY_ID"],
            secret_key=values["R2_SECRET_ACCESS_KEY"],
            bucket=values["R2_BUCKET_NAME"],
            public_domain=values["PUBLIC_DOMAIN"].rstrip("/"),
        )


def _env_positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def strip_cdn_transform(path: str) -> str:
    """Remove Cloudflare image-transform prefixes from a URL path."""
    while path.startswith("/cdn-cgi/image/"):
        parts = path.split("/", 4)
        if len(parts) < 5:
            break
        path = "/" + parts[4]
    return path


def normalized_legacy_url(url: str) -> str | None:
    if not isinstance(url, str) or not url.strip():
        return None

    parsed = urlparse(url.strip())
    public_host = urlparse(os.environ.get("PUBLIC_DOMAIN", "")).netloc
    qiniu_host = urlparse(os.environ.get("QINIU_DOMAIN", "")).netloc
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc in {qiniu_host} or parsed.netloc not in {LEGACY_IMAGE_HOST, public_host}:
        return None

    path = strip_cdn_transform(parsed.path)
    if not path or path == "/":
        return None
    # Query parameters are transform/signature metadata, not part of an R2
    # object key. Dropping them also makes migration reruns deterministic.
    return f"https://{parsed.netloc}{path}"


def r2_key_from_url(url: str) -> str | None:
    normalized = normalized_legacy_url(url)
    if not normalized:
        return None
    return unquote(urlparse(normalized).path.lstrip("/")) or None


def is_qiniu_url(url: str) -> bool:
    domain = urlparse(os.environ.get("QINIU_DOMAIN", "")).netloc
    return bool(domain and urlparse(url).netloc == domain)


def source_extension(url: str, content_type: str | None = None) -> str:
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[mime]
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in IMAGE_MIME_TYPES else ".jpg"


def source_mime_type(url: str, content_type: str | None = None) -> str:
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime in IMAGE_MIME_TYPES.values():
        return mime

    extension = source_extension(url, content_type)
    return IMAGE_MIME_TYPES[extension]


def migration_key(url: str, extension: str) -> str:
    digest = hashlib.sha256(normalized_legacy_url(url).encode("utf-8")).hexdigest()
    return f"{ROOT_PREFIX}examdb/r2-migration/{digest}{extension}"


class R2Reader:
    def __init__(self):
        settings = R2Settings.from_env()
        self.bucket = settings.bucket
        self.public_domain = settings.public_domain
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.access_key,
            aws_secret_access_key=settings.secret_key,
            config=Config(
                signature_version="s3v4",
                connect_timeout=_env_positive_int("R2_CONNECT_TIMEOUT_SECONDS", 3),
                read_timeout=_env_positive_int("R2_READ_TIMEOUT_SECONDS", 8),
                retries={
                    "mode": "standard",
                    "total_max_attempts": _env_positive_int("R2_MAX_ATTEMPTS", 2),
                },
            ),
        )

    def read(self, url: str) -> tuple[bytes, str]:
        key = r2_key_from_url(url)
        if not key:
            raise MigrationItemError("无法从 URL 解析 R2 key")

        response = self.client.get_object(Bucket=self.bucket, Key=key)
        body = response["Body"]
        try:
            data = body.read()
        finally:
            close = getattr(body, "close", None)
            if close:
                close()

        expected_size = response.get("ContentLength")
        if expected_size is not None and int(expected_size) != len(data):
            raise MigrationItemError(
                f"R2 内容长度校验失败: expected={expected_size}, actual={len(data)}"
            )
        return data, response.get("ContentType", "")


def _replace_legacy_strings(
    value: Any,
    resolver: Callable[[str], str],
) -> tuple[Any, bool]:
    if isinstance(value, str):
        if "," in value:
            changed = False
            parts = []
            for part in value.split(","):
                part_normalized = normalized_legacy_url(part.strip())
                if part_normalized:
                    parts.append(resolver(part_normalized))
                    changed = True
                else:
                    parts.append(part)
            if changed:
                return ",".join(parts), True

        normalized = normalized_legacy_url(value)
        if normalized:
            return resolver(normalized), True
        return value, False

    if isinstance(value, list):
        changed = False
        updated = []
        for item in value:
            new_item, item_changed = _replace_legacy_strings(item, resolver)
            updated.append(new_item)
            changed = changed or item_changed
        return (updated, True) if changed else (value, False)

    if isinstance(value, dict):
        changed = False
        updated = {}
        for key, item in value.items():
            new_item, item_changed = _replace_legacy_strings(item, resolver)
            updated[key] = new_item
            changed = changed or item_changed
        return (updated, True) if changed else (value, False)

    return value, False


def _scan_legacy_urls(value: Any, found: set[str]) -> None:
    if isinstance(value, str):
        if "," in value:
            for part in value.split(","):
                normalized = normalized_legacy_url(part.strip())
                if normalized:
                    found.add(normalized)
            return
        normalized = normalized_legacy_url(value)
        if normalized:
            found.add(normalized)
        return
    if isinstance(value, list):
        for item in value:
            _scan_legacy_urls(item, found)
    elif isinstance(value, dict):
        for item in value.values():
            _scan_legacy_urls(item, found)


class MigrationRunner:
    def __init__(self, manifest: Path, failures: Path, db_backup: Path):
        self.manifest_path = manifest
        self.failure_path = failures
        self.db_backup_path = db_backup
        self.manifest_records = self._load_manifest()
        self.backed_up_ids = self._load_backup_ids()
        self.reader = R2Reader()
        self.qiniu = QiniuImageStorage()
        self.reused_existing = 0
        self.uploaded = 0

    def _load_manifest(self) -> dict[str, dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        if not self.manifest_path.exists():
            return records
        with self.manifest_path.open("r", encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    print(f"警告: 跳过损坏的清单行 {line_number}", file=sys.stderr)
                    continue
                source_url = record.get("source_url")
                if source_url:
                    records[source_url] = record
        return records

    def _load_backup_ids(self) -> set[str]:
        backed_up: set[str] = set()
        if not self.db_backup_path.exists():
            return backed_up
        with self.db_backup_path.open("r", encoding="utf-8") as stream:
            for line in stream:
                if line.strip():
                    try:
                        record = json.loads(line)
                        backed_up.add(str(record["id"]))
                    except (KeyError, TypeError, json.JSONDecodeError):
                        continue
        return backed_up

    @staticmethod
    def _append_jsonl(path: Path, record: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())

    def _record_manifest(self, record: dict[str, Any]) -> None:
        self.manifest_records[record["source_url"]] = record
        self._append_jsonl(self.manifest_path, record)

    def _record_failure(self, record: dict[str, Any]) -> None:
        self._append_jsonl(self.failure_path, record)

    def _backup_entry(self, entry: DynamicFormData) -> None:
        entry_id = str(entry.id)
        if entry_id in self.backed_up_ids:
            return
        record = {
            "id": entry_id,
            "form_id": str(entry.form_id),
            "data": entry.data,
        }
        self._append_jsonl(self.db_backup_path, record)
        self.backed_up_ids.add(entry_id)

    def _reuse_existing_object(self, source_url: str, key: str) -> str | None:
        metadata = self.qiniu.stat_object(key)
        if metadata is None:
            return None

        qiniu_url = self.qiniu.public_url(key)
        self._record_manifest({
            "source_url": source_url,
            "source_key": r2_key_from_url(source_url),
            "target_key": key,
            "qiniu_url": qiniu_url,
            "bytes": metadata.get("fsize"),
            "mime_type": metadata.get("mimeType", ""),
            "status": "success",
            "reused_existing": True,
        })
        self.reused_existing += 1
        return qiniu_url

    def _resolve_url(self, source_url: str) -> str:
        existing = self.manifest_records.get(source_url)
        if existing and existing.get("status") == "success" and existing.get("qiniu_url"):
            return existing["qiniu_url"]

        try:
            # The migration key is deterministic, so an existing target can
            # be reused even when the manifest is missing or was not copied.
            candidate_key = migration_key(source_url, source_extension(source_url))
            existing_url = self._reuse_existing_object(source_url, candidate_key)
            if existing_url:
                return existing_url

            data, content_type = self.reader.read(source_url)
            mime_type = source_mime_type(source_url, content_type)
            extension = source_extension(source_url, mime_type)
            key = migration_key(source_url, extension)

            # Recheck after reading R2 to cover MIME-derived extensions and a
            # concurrent migration that created the object after the first check.
            existing_url = self._reuse_existing_object(source_url, key)
            if existing_url:
                return existing_url

            result = self.qiniu.upload_bytes(
                data,
                key,
                mime_type,
                filename=Path(key).name,
            )
            qiniu_url = result["url"]
            record = {
                "source_url": source_url,
                "source_key": r2_key_from_url(source_url),
                "target_key": key,
                "qiniu_url": qiniu_url,
                "bytes": len(data),
                "mime_type": mime_type,
                "status": "success",
            }
            self._record_manifest(record)
            self.uploaded += 1
            return qiniu_url
        except Exception as exc:
            record = {
                "source_url": source_url,
                "source_key": r2_key_from_url(source_url),
                "status": "failed",
                "error_type": type(exc).__name__,
                "error": str(exc)[:500],
            }
            self._record_manifest(record)
            self._record_failure(record)
            raise MigrationItemError(str(exc)) from exc

    def migrate_entry(self, entry: DynamicFormData) -> tuple[int, bool]:
        found: set[str] = set()
        _scan_legacy_urls(entry.data, found)
        if not found:
            return 0, False

        try:
            new_data, changed = _replace_legacy_strings(entry.data, self._resolve_url)
        except MigrationItemError:
            # Uploaded objects and manifest records are retained. The row is
            # intentionally left untouched so a later run can retry it.
            return len(found), False

        if changed:
            self._backup_entry(entry)
            try:
                entry.data = new_data
                flag_modified(entry, "data")
                db.session.commit()
            except Exception as exc:
                db.session.rollback()
                record = {
                    "entry_id": str(entry.id),
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "error": str(exc)[:500],
                }
                self._record_failure(record)
                return len(found), False
        return len(found), changed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="将 dynamic_form_data 中的 R2 图片迁移到七牛云")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="执行七牛上传和数据库更新；缺省为只读扫描")
    mode.add_argument("--dry-run", action="store_true", help="只扫描，不上传、不更新数据库")
    parser.add_argument("--form-token", help="只处理指定 form_token")
    parser.add_argument("--entry-id", help="只处理指定 dynamic_form_data UUID")
    parser.add_argument("--limit", type=int, help="最多扫描多少条 dynamic_form_data 记录")
    parser.add_argument("--manifest", type=Path, help="迁移清单 JSONL 路径")
    parser.add_argument("--failures", type=Path, help="失败清单 JSONL 路径")
    parser.add_argument("--db-backup", type=Path, help="修改前的 dynamic_form_data JSONL 备份路径")
    parser.add_argument("--restore-backup", type=Path, help="从指定数据库备份恢复原始 data")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit 必须大于 0")
    if args.entry_id:
        try:
            UUID(args.entry_id)
        except ValueError:
            parser.error("--entry-id 必须是合法 UUID")
    if args.restore_backup and not args.apply:
        parser.error("恢复数据库备份必须显式指定 --apply")
    if args.restore_backup and any((args.form_token, args.entry_id, args.limit)):
        parser.error("--restore-backup 不能与筛选参数同时使用")
    return args


def default_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    manifest = args.manifest or Path(f"r2-to-qiniu-{stamp}.jsonl")
    failures = args.failures or manifest.with_name(manifest.stem + ".failures.jsonl")
    db_backup = args.db_backup or manifest.with_name(manifest.stem + ".db-backup.jsonl")
    return manifest, failures, db_backup


def restore_backup(path: Path) -> int:
    if not path.exists():
        raise RuntimeError(f"备份文件不存在: {path}")
    restored = 0
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            entry = db.session.get(DynamicFormData, UUID(record["id"]))
            if not entry:
                print(f"警告: 备份第 {line_number} 行对应记录不存在: {record['id']}")
                continue
            entry.data = record["data"]
            flag_modified(entry, "data")
            db.session.commit()
            restored += 1
    return restored


def scan_entries(args: argparse.Namespace) -> tuple[int, int, set[str]]:
    query = DynamicFormData.query.join(
        DynamicForm, DynamicForm.id == DynamicFormData.form_id
    ).order_by(DynamicFormData.id)
    if args.form_token:
        query = query.filter(DynamicForm.form_token == args.form_token)
    if args.entry_id:
        query = query.filter(DynamicFormData.id == UUID(args.entry_id))

    entry_count = 0
    reference_count = 0
    found: set[str] = set()
    iterator = query.limit(args.limit) if args.limit else query
    for entry in iterator:
        entry_count += 1
        before = len(found)
        _scan_legacy_urls(entry.data, found)
        reference_count += len(found) - before
    return entry_count, reference_count, found


def apply_migration(args: argparse.Namespace, paths: tuple[Path, Path, Path]) -> int:
    manifest, failures, db_backup = paths
    runner = MigrationRunner(manifest, failures, db_backup)
    query = DynamicFormData.query.join(
        DynamicForm, DynamicForm.id == DynamicFormData.form_id
    ).order_by(DynamicFormData.id)
    if args.form_token:
        query = query.filter(DynamicForm.form_token == args.form_token)
    if args.entry_id:
        query = query.filter(DynamicFormData.id == UUID(args.entry_id))
    iterator = query.limit(args.limit) if args.limit else query

    entries = images = migrated_entries = 0
    for entry in iterator:
        entries += 1
        count, changed = runner.migrate_entry(entry)
        images += count
        migrated_entries += int(changed)
        if entries % 50 == 0:
            print(f"已处理记录={entries}，发现图片引用={images}，已更新记录={migrated_entries}")
    print(f"迁移完成：记录={entries}，图片引用={images}，已更新记录={migrated_entries}")
    print(f"复用七牛已有对象：{runner.reused_existing}")
    print(f"实际从 R2 上传：{runner.uploaded}")
    print(f"迁移清单：{manifest}")
    print(f"失败清单：{failures}")
    print(f"数据库备份：{db_backup}")
    return 0


def main() -> int:
    args = parse_args()
    with app.app_context():
        if args.restore_backup:
            restored = restore_backup(args.restore_backup)
            print(f"已恢复数据库记录：{restored} 条；七牛对象未删除。")
            return 0

        paths = default_paths(args)
        if args.apply:
            print("模式：执行迁移。R2 只读，绝不删除 R2 对象。")
            return apply_migration(args, paths)

        entry_count, reference_count, found = scan_entries(args)
        print("模式：只读扫描（未上传、未修改数据库、未写入清单）。")
        print(f"扫描记录：{entry_count}")
        print(f"发现图片引用：{reference_count}")
        print(f"去重后待迁移 URL：{len(found)}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
