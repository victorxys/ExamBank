# -*- coding: utf-8 -*-
import requests
import json
import os
import logging

logger = logging.getLogger(__name__)

def normalize_wechat_touser(value):
    if not value:
        return ""
    stripped = str(value).strip()
    if stripped == "@all":
        return stripped
    return "|".join(part.strip() for part in stripped.split("|") if part.strip())

def get_wechat_config():
    """获取企业微信配置"""
    # 优先从 Flask config 获取，如果无法获取则从 os.environ 获取
    try:
        from flask import current_app
        corp_id = current_app.config.get('WECHAT_CORP_ID')
        agent_id = current_app.config.get('WECHAT_AGENT_ID')
        secret = current_app.config.get('WECHAT_SECRET')
        default_users = current_app.config.get('WECHAT_NOTIFY_USERS')
    except RuntimeError:
        corp_id = None
        agent_id = None
        secret = None
        default_users = None

    if not corp_id:
        corp_id = os.environ.get('WECHAT_CORP_ID', 'ww_dummy_corp_id')
    if not agent_id:
        agent_id = os.environ.get('WECHAT_AGENT_ID', '1000002')
    if not secret:
        secret = os.environ.get('WECHAT_SECRET', 'dummy_app_secret')
    if not default_users:
        default_users = os.environ.get('WECHAT_NOTIFY_USERS', '@all')

    try:
        agent_id = int(agent_id)
    except:
        agent_id = 1000002

    return corp_id, agent_id, secret, default_users

def get_access_token():
    """获取企业微信 API 临时访问凭证"""
    corp_id, agent_id, secret, _ = get_wechat_config()
    
    if corp_id == 'ww_dummy_corp_id' or secret == 'dummy_app_secret':
        logger.warning("WeChat Work config is dummy/incomplete, skipping token acquisition.")
        return None

    token_url = f"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid={corp_id}&corpsecret={secret}"
    try:
        response = requests.get(token_url, timeout=5)
        result = response.json()
        if result.get("errcode") == 0:
            return result.get("access_token")
        else:
            logger.error(f"获取 WeChat Token 失败: {result}")
            return None
    except Exception as e:
        logger.error(f"请求 WeChat Token 接口发生网络异常: {e}")
        return None

def send_wechat_notification(touser, title, description, jump_url, btn_text="点击查看详情"):
    """
    向指定用户推送微信文本卡片消息
    :param touser: 接收消息的员工账号(UserID)，多个人用竖线 | 分隔。发给全员填 "@all"
    :param title: 卡片标题
    :param description: 卡片内容（支持部分常用 HTML 标签如 <div class="gray">）
    :param jump_url: 点击卡片后跳转的系统链接
    :param btn_text: 卡片底部按钮文字，默认为“点击查看详情”
    :return: (success_boolean, raw_result_dict)
    """
    _, agent_id, _, default_users = get_wechat_config()
    
    target_user = normalize_wechat_touser(touser) if touser else normalize_wechat_touser(default_users)
    if not target_user:
        target_user = "@all"

    access_token = get_access_token()
    if not access_token:
        logger.warning(f"Unable to obtain access token. Notification '{title}' not sent to '{target_user}'.")
        return False, {"errcode": -1, "errmsg": "Unable to obtain access token."}

    send_url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={access_token}"
    
    payload = {
        "touser": target_user,
        "msgtype": "textcard",
        "agentid": agent_id,
        "textcard": {
            "title": title,
            "description": description,
            "url": jump_url,
            "btntxt": btn_text
        },
        "enable_id_trans": 0,
        "enable_duplicate_check": 0
    }

    try:
        response = requests.post(send_url, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), timeout=5)
        result = response.json()
        if result.get("errcode") == 0:
            logger.info(f"WeChat notification sent successfully to '{target_user}' for '{title}'")
            return True, result
        else:
            logger.error(f"WeChat notification failed: {result}")
            return False, result
    except Exception as e:
        logger.error(f"WeChat sending interface exception: {e}")
        return False, {"errcode": -500, "errmsg": str(e)}
