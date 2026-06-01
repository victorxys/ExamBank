# -*- coding: utf-8 -*-
import sys
import os
import time

# 将项目路径添加至环境变量
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import app
from backend.services.reminder_service import (
    check_nanny_contracts_expiring,
    check_maternity_nurse_delivery
)
from backend.tasks import send_wechat_notification_task

def main():
    print("==================================================")
    print("🚀  微信通知推送 [REAL-SEND] 真实触发工具已启动...")
    print("📢  本脚本将以完美排版将筛选出的 19 条真实提醒发送到企业微信并记录日志。")
    print("==================================================")

    with app.app_context():
        # 1. 扫描合同到期
        print("\n🔍 [1/2] 扫描即将到期的育儿嫂正式合同...")
        expirings = check_nanny_contracts_expiring()
        print(f"👉 发现 {len(expirings)} 条，开始发送...")
        
        for idx, item in enumerate(expirings, 1):
            title = "📅 正式合同即将到期提醒"
            desc = (
                f'<div class="gray">到期时间：{item["end_date"]}</div>\n'
                f'<div class="normal">客户 【{item["customer_name"]}】 与服务人员 【{item["employee_name"]}】 的正式合同即将到期。</div>\n'
                f'<div class="highlight">该合同为非自动续签合同，请提前联系客户和服务人员沟通续期或下户事宜。</div>'
            )
            
            frontend_base_url = app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
            jump_url = f"{frontend_base_url}/contract/detail/{item['contract_id']}"
            
            print(f"   [{idx}] 正在派发任务: 客户 {item['customer_name']} 的合同提醒")
            
            # 真实触发 Celery 任务进行发送并记录日志
            send_wechat_notification_task.delay(
                touser=None, # touser=None 会自动回退到 .env 中的默认运营微信号
                title=title,
                description=desc,
                jump_url=jump_url,
                msg_type="contract_expiring"
            )
            # 稍微缓冲一下，防止高频并发
            time.sleep(0.5)

        # 2. 扫描月嫂预产期
        print("\n🔍 [2/2] 扫描临近预产期的月嫂合同...")
        deliveries = check_maternity_nurse_delivery()
        print(f"👉 发现 {len(deliveries)} 条，开始发送...")
        
        for idx, item in enumerate(deliveries, 1):
            title = "👶 月嫂合同预产期临近提醒"
            desc = (
                f'<div class="gray">预计预产期：{item["provisional_start_date"]}</div>\n'
                f'<div class="normal">客户 【{item["customer_name"]}】 的合同预计即将生产。</div>\n'
                f'<div class="normal">服务人员：{item["employee_name"]}</div>\n'
                f'<div class="highlight">服务人员尚未实际上户，请及时跟进客户的生产情况与阿姨的准备状态，并记录上户时间。</div>'
            )
            
            frontend_base_url = app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
            jump_url = f"{frontend_base_url}/contract/detail/{item['contract_id']}"
            
            print(f"   [{idx}] 正在派发任务: 客户 {item['customer_name']} 的预产期提醒")
            
            send_wechat_notification_task.delay(
                touser=None,
                title=title,
                description=desc,
                jump_url=jump_url,
                msg_type="maternity_due"
            )
            time.sleep(0.5)

        print("\n==================================================")
        print("🎉 所有 19 条消息已成功以全新完美排版派发至 Celery 异步队列。")
        print("💡 请稍后刷新消息管理页面或查看您的企业微信接收情况！")
        print("==================================================")

if __name__ == '__main__':
    main()
