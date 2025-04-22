# backend/api/wechatshare.py
from flask import Blueprint, request, jsonify
from wechatpy import WeChatClient
from wechatpy.exceptions import WeChatException
import os
import time
import logging
import uuid # 确保导入 uuid

# 配置日志
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

wechat_share_bp = Blueprint('wechat_share', __name__)

# --- 新增缓存变量 ---
wechat_cache = {
    'access_token': None,
    'access_token_expires_at': 0,
    'jsapi_ticket': None,
    'jsapi_ticket_expires_at': 0,
}
CACHE_TTL = 7000  # 缓存有效期，秒 (略小于微信的 7200 秒)
# --- 结束新增缓存变量 ---

# 从环境变量中获取微信 AppID 和 AppSecret
WECHAT_APP_ID = os.environ.get('WECHAT_APP_ID')
WECHAT_APP_SECRET = os.environ.get('WECHAT_APP_SECRET')

if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
    error_msg = "请设置环境变量 WECHAT_APP_ID 和 WECHAT_APP_SECRET"
    logger.error(error_msg)
    raise ValueError(error_msg)

# --- 新增：获取缓存的 access_token 的函数 ---
def get_cached_access_token(client):
    now = time.time()
    if wechat_cache['access_token'] and wechat_cache['access_token_expires_at'] > now:
        logger.debug("使用缓存的 access_token")
        return wechat_cache['access_token']
    else:
        logger.debug("缓存 access_token 失效或不存在，重新获取")
        try:
            token_info = client.fetch_access_token() # 使用 wechatpy 的方法获取
            wechat_cache['access_token'] = token_info['access_token']
            # 设置过期时间，比微信给的 expires_in 稍短一点点
            wechat_cache['access_token_expires_at'] = now + min(token_info.get('expires_in', 7200) - 200, CACHE_TTL)
            logger.info(f"获取到新的 access_token，有效期至: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(wechat_cache['access_token_expires_at']))}")
            return wechat_cache['access_token']
        except WeChatException as e:
            logger.error(f"获取 access_token 失败: {e}")
            raise # 重新抛出异常让上层处理

# --- 新增：获取缓存的 jsapi_ticket 的函数 ---
def get_cached_jsapi_ticket(client):
    now = time.time()
    if wechat_cache['jsapi_ticket'] and wechat_cache['jsapi_ticket_expires_at'] > now:
        logger.debug("使用缓存的 jsapi_ticket")
        return wechat_cache['jsapi_ticket']
    else:
        logger.debug("缓存 jsapi_ticket 失效或不存在，重新获取")
        try:
            # 确保 client 有最新的 access_token (wechatpy 会自动处理)
            # get_cached_access_token(client) # 通常不需要手动调用，wechatpy的jsapi会自动处理token
            
            ticket_info = client.jsapi.get_ticket() # 使用 wechatpy 的方法获取 ticket
            wechat_cache['jsapi_ticket'] = ticket_info['ticket']
             # 设置过期时间，比微信给的 expires_in 稍短一点点
            wechat_cache['jsapi_ticket_expires_at'] = now + min(ticket_info.get('expires_in', 7200) - 200, CACHE_TTL)
            logger.info(f"获取到新的 jsapi_ticket，有效期至: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(wechat_cache['jsapi_ticket_expires_at']))}")
            return wechat_cache['jsapi_ticket']
        except WeChatException as e:
            logger.error(f"获取 jsapi_ticket 失败: {e}")
            raise # 重新抛出异常让上层处理

# 添加微信验证文件路由
@wechat_share_bp.route('/RiytwalDyY.txt')
def mp_verify():
    return 'ec03f8357f153cf6c66f9c8a9ba0a303'


@wechat_share_bp.route('/jssdk-config')
def get_jssdk_config():
    nonce_str = uuid.uuid4().hex
    url = request.args.get('url')
    logger.info(f"收到JSSDK配置请求，URL: {url}")

    if not url:
        error_msg = "缺少 url 参数"
        logger.error(error_msg)
        return jsonify({'success': False, 'message': error_msg}), 400

    try:
        # --- 修改：使用 client 对象 ---
        # 注意：WeChatClient 应该只需要实例化一次，或者使用某种方式共享实例
        # 这里为了简单，每次请求都创建，但在高并发下可能不是最优
        client = WeChatClient(WECHAT_APP_ID, WECHAT_APP_SECRET, session=None) # 可以考虑使用 session 提高性能
        # client.access_token = get_cached_access_token(client) # wechatpy 会自动管理 access_token

        logger.info("微信客户端初始化成功")

        # --- 修改：使用缓存函数获取 ticket ---
        jsapi_ticket = get_cached_jsapi_ticket(client)
        logger.debug(f"成功获取jsapi_ticket (可能来自缓存): {jsapi_ticket[:10]}...") # 只打印前10位

        timestamp = int(time.time())
        logger.debug(f"URL 参数值 (调用 get_jsapi_signature 前): {url}")
        
        # 使用 wechatpy 提供的签名方法，它会自动处理 access_token
        signature = client.jsapi.get_jsapi_signature(
            nonce_str,
            jsapi_ticket,
            timestamp,
            url
        )
        logger.debug(f"成功生成jsapi签名: {signature}")

        config = {
            'success': True,
            'config': {
                'debug': False, # 生产环境建议设为 false
                'appId': WECHAT_APP_ID,
                'timestamp': timestamp,
                'nonceStr': nonce_str,
                'signature': signature,
                'jsApiList': [
                    'updateAppMessageShareData',
                    'updateTimelineShareData',
                    'showOptionMenu'
                    # 可以根据需要添加更多 API
                ]
            }
        }
        logger.info(f"成功生成JSSDK配置")
        return jsonify(config)
    except WeChatException as e:
        error_msg = f"微信 API 调用失败: {str(e)}"
        logger.error(error_msg)
        return jsonify({'success': False, 'message': error_msg}), 500
    except Exception as e:
        error_msg = f"获取 JSSDK 配置时发生未知错误: {str(e)}"
        logger.exception("get_jssdk_config 发生错误") # 记录完整堆栈
        return jsonify({'success': False, 'message': error_msg}), 500