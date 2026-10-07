from flask import Blueprint, request, jsonify, current_app
import os
from werkzeug.utils import secure_filename

from backend.services.image_storage_service import (
    ImageStorageError,
    extension_for_image,
    mime_type_for_filename,
    upload_image_bytes,
)

upload_bp = Blueprint('upload_api', __name__, url_prefix='/api/upload')

@upload_bp.route('/image', methods=['POST'])
@upload_bp.route('/r2', methods=['POST'])  # Backward-compatible legacy route.
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    try:
        filename = secure_filename(file.filename) or "image"
        mime_type = mime_type_for_filename(filename, file.mimetype)
        if not mime_type:
            return jsonify({'error': '仅支持 JPG、PNG、GIF、WEBP 或 SVG 图片'}), 400

        max_size = _max_image_size()
        data = file.stream.read(max_size + 1)
        if len(data) > max_size:
            return jsonify({'error': f'图片不能超过 {max_size // (1024 * 1024)} MB'}), 413

        result = upload_image_bytes(
            data,
            "dynamic-form-upload",
            "general",
            mime_type,
            filename=filename,
            extension=extension_for_image(filename, mime_type),
        )
        return jsonify({
            'url': result['url'],
            'file_url': result['url'],
            'key': result['key'],
            'storage': 'qiniu',
        }), 200
    except ImageStorageError as exc:
        current_app.logger.error(
            "Error uploading image to Qiniu error_type=%s",
            type(exc).__name__,
            exc_info=True,
        )
        return jsonify({'error': '图片存储服务暂时不可用，请稍后重试'}), 503
    except Exception as exc:
        current_app.logger.error(
            "Unexpected image upload error error_type=%s",
            type(exc).__name__,
            exc_info=True,
        )
        return jsonify({'error': '图片上传失败，请稍后重试'}), 500


def _max_image_size():
    try:
        return max(1, int(os.environ.get('QINIU_IMAGE_MAX_BYTES', 20 * 1024 * 1024)))
    except (TypeError, ValueError):
        return 20 * 1024 * 1024
