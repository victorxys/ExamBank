# backend/api/wechatshare.py
from flask import Blueprint, request, jsonify
from wechatpy import WeChatClient
from wechatpy.exceptions import WeChatException
import os
import time
import logging

# 配置日志
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

wechat_share_bp = Blueprint('wechat_share', __name__)

# 从环境变量中获取微信 AppID 和 AppSecret
WECHAT_APP_ID = os.environ.get('WECHAT_APP_ID')
WECHAT_APP_SECRET = os.environ.get('WECHAT_APP_SECRET')

if not WECHAT_APP_ID or not WECHAT_APP_SECRET:
    error_msg = "请设置环境变量 WECHAT_APP_ID 和 WECHAT_APP_SECRET"
    logger.error(error_msg)
    raise ValueError(error_msg)



@wechat_share_bp.route('/jssdk-config')
def get_jssdk_config():
    import uuid
    nonce_str = uuid.uuid4().hex  #  生成随机字符串

    try:
        client = WeChatClient(WECHAT_APP_ID, WECHAT_APP_SECRET)
        logger.info("微信客户端初始化成功")
    except Exception as e:
        logger.error(f"微信客户端初始化失败: {str(e)}")
        raise
    url = request.args.get('url')
    logger.info(f"收到JSSDK配置请求，URL: {url}")

    if not url:
        error_msg = "缺少 url 参数"
        logger.error(error_msg)
        return jsonify({'success': False, 'message': error_msg}), 400

    try:
        # 获取jsapi_ticket
        try:
            logger.debug("开始获取jsapi_ticket")
            jsapi_ticket = client.jsapi.get_jsapi_ticket()
            logger.debug(f"成功获取jsapi_ticket: {jsapi_ticket}")
            # 生成时间戳
            timestamp = int(time.time())
            # 生成签名
            logger.debug(f"URL 参数值 (调用 get_jsapi_signature 前): {url}") # 添加这行日志
            jsapi_config = client.jsapi.get_jsapi_signature(
                nonce_str,
                jsapi_ticket,
                timestamp,
                url
            )
            logger.debug(f"成功生成jsapi签名: {jsapi_config}")
        except WeChatException as e:
            error_msg = f"生成签名失败: {str(e)}"
            logger.error(error_msg)
            return jsonify({'success': False, 'message': error_msg}), 500
        logger.debug(f"jsapi_config 类型: {type(jsapi_config)}")  #  新增日志： 打印 jsapi_config 的类型
        logger.debug(f"jsapi_config 内容: {jsapi_config}")    #  新增日志： 打印 jsapi_config 的内容

        config = {
            'success': True,
            'config': {
                'debug': True,  # 开启调试模式
                'appId': WECHAT_APP_ID,
                'timestamp': timestamp, #  直接使用之前生成的 timestamp 变量
                'nonceStr': nonce_str, #  直接使用之前生成的 nonce_str 变量
                'signature': jsapi_config, #  直接使用 jsapi_config 变量 (现在它就是签名字符串)
                'jsApiList': [
                    'updateAppMessageShareData',
                    'updateTimelineShareData'
                ]
            }
        }
        logger.info(f"成功生成JSSDK配置: {config}")
        return jsonify(config)
    except Exception as e:
        error_msg = f"获取 JSSDK 配置失败: {str(e)}"
        logger.error(error_msg)
        return jsonify({'success': False, 'message': error_msg}), 500