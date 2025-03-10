# backend/api/wechatshare.py
from flask import Blueprint, request, jsonify
from wechatpy import WeChatClient
import os

wechat_share_bp = Blueprint('wechat_share', __name__)

# 从环境变量中获取微信 AppID 和 AppSecret，更安全
WECHAT_APP_ID = os.environ.get('WECHAT_APP_ID')
WECHAT_APP_SECRET = os.environ.get('WECHAT_APP_SECRET')

if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
    raise ValueError("请设置环境变量 WECHAT_APP_ID 和 WECHAT_APP_SECRET")

client = WeChatClient(WECHAT_APP_ID, WECHAT_APP_SECRET)

@wechat_share_bp.route('/jssdk-config')
def get_jssdk_config():
    url = request.args.get('url')
    if not url:
        return jsonify({'success': False, 'message': '缺少 url 参数'}), 400

    try:
        jsapi_config = client.jsapi.get_jsapi_signature(url)
        return jsonify({
            'success': True,
            'config': {
                'appId': WECHAT_APP_ID,
                'timestamp': jsapi_config['timestamp'],
                'nonceStr': jsapi_config['nonce_str'],
                'signature': jsapi_config['signature']
            }
        })
    except Exception as e:
        print(f"获取 JSSDK 配置失败: {e}")
        return jsonify({'success': False, 'message': '获取 JSSDK 配置失败'}), 500