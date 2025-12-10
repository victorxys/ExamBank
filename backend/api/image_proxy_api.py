# backend/api/image_proxy_api.py
from flask import Blueprint, request, Response
import logging

try:
    import requests
except ImportError:
    requests = None

image_proxy_bp = Blueprint('image_proxy', __name__, url_prefix='/api/image-proxy')

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
    allowed_domains = [
        'img.mengyimengsao.com',
        'jinshujufiles.com'
    ]
    
    if not any(domain in image_url for domain in allowed_domains):
        return {'error': 'Domain not allowed'}, 403
    
    try:
        # 请求原始图片
        response = requests.get(image_url, stream=True, timeout=30)
        response.raise_for_status()
        
        # 创建代理响应
        def generate():
            for chunk in response.iter_content(chunk_size=8192):
                yield chunk
        
        # 设置响应头
        headers = {
            'Content-Type': response.headers.get('Content-Type', 'image/jpeg'),
            'Content-Length': response.headers.get('Content-Length'),
            'Cache-Control': 'public, max-age=31536000',  # 缓存1年
            'Access-Control-Allow-Origin': '*',  # 允许所有源
        }
        
        # 移除可能导致问题的头部
        headers = {k: v for k, v in headers.items() if v is not None}
        
        return Response(
            generate(),
            status=response.status_code,
            headers=headers
        )
        
    except Exception as e:
        logging.error(f"Image proxy error: {str(e)}")
        return {'error': 'Failed to fetch image'}, 500