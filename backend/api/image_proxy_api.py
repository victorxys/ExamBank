# backend/api/image_proxy_api.py
from flask import Blueprint, request, Response
import logging
import os
from urllib.parse import unquote, urlparse

from backend.services.image_storage_service import (
    ImageStorageError,
    QiniuImageStorage,
    ROOT_PREFIX,
)

try:
    import requests
except ImportError:
    requests = None

image_proxy_bp = Blueprint('image_proxy', __name__, url_prefix='/api/image-proxy')


def _configured_netloc(value):
    value = (value or '').strip()
    if not value:
        return ''
    if not value.startswith(('http://', 'https://')):
        value = f'https://{value}'
    return urlparse(value).netloc.lower()


def _qiniu_key_from_url(image_url):
    """Return an allowed Qiniu image key, or None for non-Qiniu URLs."""
    qiniu_netloc = _configured_netloc(os.environ.get('QINIU_DOMAIN'))
    parsed_url = urlparse(image_url)
    if not qiniu_netloc or parsed_url.netloc.lower() != qiniu_netloc:
        return None

    key = unquote(parsed_url.path.lstrip('/'))
    if not key.startswith(ROOT_PREFIX):
        raise ValueError('仅允许代理 hr_media/ 图片')
    return key

@image_proxy_bp.route('/', methods=['GET'])
def proxy_image():
    """
    代理图片请求，解决 CORS 问题
    用法: /api/image-proxy/?url=https://img.mengyimengsao.com/path/to/image.jpg
    """
    if requests is None:
        return {'error': 'Requests library not available'}, 500
        
    image_url = request.args.get('url')
    
    if not image_url:
        return {'error': 'Missing url parameter'}, 400
    
    # 安全检查：只允许代理我们自己的图片域名
    parsed_url = urlparse(image_url)
    qiniu_netloc = _configured_netloc(os.environ.get('QINIU_DOMAIN'))
    allowed_hosts = {'img.mengyimengsao.com', 'jinshujufiles.com'}
    if qiniu_netloc:
        allowed_hosts.add(qiniu_netloc)

    if parsed_url.scheme not in {'http', 'https'} or parsed_url.netloc.lower() not in allowed_hosts:
        return {'error': 'Domain not allowed'}, 403

    request_url = image_url
    private_qiniu_image = False
    try:
        qiniu_key = _qiniu_key_from_url(image_url)
        if qiniu_key:
            request_url = QiniuImageStorage().private_download_url(qiniu_key)
            private_qiniu_image = True

        # 请求原始图片
        response = requests.get(request_url, stream=True, timeout=30)
        response.raise_for_status()
        
        # 创建代理响应
        def generate():
            try:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            finally:
                response.close()
        
        # 设置响应头
        headers = {
            'Content-Type': response.headers.get('Content-Type', 'image/jpeg'),
            'Content-Length': response.headers.get('Content-Length'),
            'Cache-Control': (
                'private, max-age=300'
                if private_qiniu_image
                else 'public, max-age=31536000'
            ),
            'Access-Control-Allow-Origin': '*',  # 允许所有源
            'X-Content-Type-Options': 'nosniff',
        }
        
        # 移除可能导致问题的头部
        headers = {k: v for k, v in headers.items() if v is not None}
        
        return Response(
            generate(),
            status=response.status_code,
            headers=headers
        )
        
    except ImageStorageError as e:
        logging.error(f'Qiniu image signing error: {str(e)}')
        return {'error': 'Image storage service unavailable'}, 503
    except ValueError as e:
        logging.warning(f'Invalid image proxy URL: {str(e)}')
        return {'error': 'Invalid image URL'}, 403
    except Exception as e:
        logging.error(f"Image proxy error: {str(e)}")
        return {'error': 'Failed to fetch image'}, 502
