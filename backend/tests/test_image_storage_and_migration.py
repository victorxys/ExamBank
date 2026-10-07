import re
from io import BytesIO

from flask import Flask

import backend.api.upload_api as upload_api
import backend.api.image_proxy_api as image_proxy_api
from backend.services.image_storage_service import (
    QiniuImageConfig,
    QiniuImageStorage,
    build_image_key,
    mime_type_for_filename,
)
from scripts.migrate_r2_images_to_qiniu import (
    MigrationRunner,
    _replace_legacy_strings,
    migration_key,
    normalized_legacy_url,
)


def test_build_image_key_uses_required_prefix_and_supported_mime():
    key = build_image_key("dynamic-form", "entry/field", ".jpg", filename="身份证.jpg")

    assert key.startswith("hr_media/dynamic-form/entry/field/")
    assert re.search(r"/[0-9a-f]{32}__\.jpg$", key)
    assert mime_type_for_filename("photo.jpg", "application/octet-stream") == "image/jpeg"


def test_qiniu_storage_upload_returns_stable_public_url_without_sdk_call():
    config = QiniuImageConfig(
        access_key="ak",
        secret_key="sk",
        bucket="bucket",
        domain="https://cdn.example.test",
        upload_url="https://upload-z1.qiniup.com",
        max_attempts=1,
    )
    storage = QiniuImageStorage(config)

    class Info:
        status_code = 200

    storage._upload_once = lambda *args: ({"hash": "etag"}, Info())
    result = storage.upload_bytes(
        b"image-bytes",
        "hr_media/test/image.jpg",
        "image/jpeg",
    )

    assert result == {
        "key": "hr_media/test/image.jpg",
        "url": "https://cdn.example.test/hr_media/test/image.jpg",
        "hash": "etag",
    }


def test_migration_replaces_nested_and_comma_separated_legacy_urls(monkeypatch):
    monkeypatch.setenv("PUBLIC_DOMAIN", "https://img.mengyimengsao.com")
    monkeypatch.setenv("QINIU_DOMAIN", "https://cdn.example.test")
    old_url = "https://img.mengyimengsao.com/cdn-cgi/image/width=400/uploads/a.jpg?x=1"
    normalized = normalized_legacy_url(old_url)
    assert normalized == "https://img.mengyimengsao.com/uploads/a.jpg"

    value = {
        "files": [{"content": old_url}],
        "nested": {"urls": f"{old_url},keep-me"},
        "qiniu": "https://cdn.example.test/hr_media/already.png",
    }
    def replacement(url):
        key = migration_key(url, ".jpg")
        return f"https://cdn.example.test/{key[len('hr_media/'):]}"

    replaced, changed = _replace_legacy_strings(value, replacement)

    assert changed is True
    assert replaced["files"][0]["content"].startswith("https://cdn.example.test/")
    assert replaced["nested"]["urls"].endswith(",keep-me")
    assert replaced["qiniu"] == value["qiniu"]


def test_image_upload_route_returns_qiniu_url(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(upload_api.upload_bp)
    uploaded = {}

    def fake_upload(data, module, business_id, mime_type, **kwargs):
        uploaded.update({"data": data, "module": module, "mime_type": mime_type, **kwargs})
        return {
            "key": "hr_media/test/upload.jpg",
            "url": "https://cdn.example.test/hr_media/test/upload.jpg",
        }

    monkeypatch.setattr(upload_api, "upload_image_bytes", fake_upload)
    with app.test_client() as client:
        response = client.post(
            "/api/upload/image",
            data={"file": (BytesIO(b"image-bytes"), "photo.jpg")},
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    assert response.get_json()["storage"] == "qiniu"
    assert response.get_json()["url"] == "https://cdn.example.test/hr_media/test/upload.jpg"
    assert uploaded["data"] == b"image-bytes"
    assert uploaded["mime_type"] == "image/jpeg"


def test_private_qiniu_image_proxy_signs_stable_url(monkeypatch):
    monkeypatch.setenv("QINIU_ACCESS_KEY", "ak")
    monkeypatch.setenv("QINIU_SECRET_KEY", "sk")
    monkeypatch.setenv("QINIU_BUCKET", "bucket")
    monkeypatch.setenv("QINIU_DOMAIN", "https://cdn.example.test")
    monkeypatch.setenv("QINIU_UPLOAD_URL", "https://upload-z1.qiniup.com")

    class FakeResponse:
        status_code = 200
        headers = {"Content-Type": "image/png", "Content-Length": "5"}

        def raise_for_status(self):
            return None

        def iter_content(self, chunk_size):
            assert chunk_size == 8192
            yield b"image"

        def close(self):
            return None

    requested = {}
    monkeypatch.setattr(
        image_proxy_api.requests,
        "get",
        lambda url, stream, timeout: (
            requested.update({"url": url, "stream": stream, "timeout": timeout})
            or FakeResponse()
        ),
    )

    app = Flask(__name__)
    app.register_blueprint(image_proxy_api.image_proxy_bp)
    with app.test_client() as client:
        response = client.get(
            "/api/image-proxy/",
            query_string={
                "url": "https://cdn.example.test/hr_media/test/image.png"
            },
        )

    assert response.status_code == 200
    assert response.data == b"image"
    assert requested["stream"] is True
    assert requested["timeout"] == 30
    assert requested["url"].startswith(
        "https://cdn.example.test/hr_media/test/image.png?e="
    )
    assert "token=" in requested["url"]
    assert response.headers["Cache-Control"] == "private, max-age=300"


def test_migration_reuses_existing_qiniu_object_without_reading_r2(monkeypatch, tmp_path):
    monkeypatch.setenv("PUBLIC_DOMAIN", "https://img.mengyimengsao.com")
    monkeypatch.setenv("QINIU_DOMAIN", "https://cdn.example.test")
    source_url = "https://img.mengyimengsao.com/uploads/already.jpg"
    key = migration_key(source_url, ".jpg")
    calls = []

    class ExistingQiniu:
        def stat_object(self, requested_key):
            calls.append(("stat", requested_key))
            return {"fsize": 12, "mimeType": "image/jpeg"}

        def public_url(self, requested_key):
            return f"https://cdn.example.test/{requested_key}"

        def upload_bytes(self, *args, **kwargs):
            raise AssertionError("已有对象不应再次上传")

    class UnexpectedR2Read:
        def read(self, url):
            raise AssertionError("已有对象不应读取 R2")

    runner = MigrationRunner.__new__(MigrationRunner)
    runner.manifest_path = tmp_path / "manifest.jsonl"
    runner.failure_path = tmp_path / "failures.jsonl"
    runner.db_backup_path = tmp_path / "backup.jsonl"
    runner.manifest_records = {}
    runner.backed_up_ids = set()
    runner.reader = UnexpectedR2Read()
    runner.qiniu = ExistingQiniu()
    runner.reused_existing = 0
    runner.uploaded = 0

    assert runner._resolve_url(source_url) == f"https://cdn.example.test/{key}"
    assert calls == [("stat", key)]
    assert runner.reused_existing == 1
    assert runner.uploaded == 0
