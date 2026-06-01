# -*- coding: utf-8 -*-
import sys
import os

# 将项目路径添加至环境变量
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from backend.app import app
from backend.services.reminder_service import (
    check_nanny_trial_contracts,
    check_nanny_contracts_expiring,
    check_maternity_nurse_delivery
)

def main():
    print("==================================================")
    print("🚀  微信通知推送 [Dry-Run] 扫描审计脚本已启动...")
    print("⚠️  本次运行为 [Dry-Run] 模式，仅做数据库匹配与内容展示，不会向企业微信发送任何数据。")
    print("==================================================")

    # 1. 使用全局 app 实例
    with app.app_context():
        # 2. 检查 1: 试工到期提醒
        print("\n🔍 [1/3] 正在扫描即将到期的育儿嫂试工合同...")
        trials = check_nanny_trial_contracts()
        print(f"👉 扫描结果：找到 {len(trials)} 条待确认的试工到期合同。")
        for idx, item in enumerate(trials, 1):
            print(f"   [{idx}] 合同ID: {item['contract_id']} | 客户: {item['customer_name']} | 阿姨: {item['employee_name']} | 结束时间: {item['end_date']} | 日薪: {item['daily_rate']}")

        # 3. 检查 2: 正式合同到期提醒
        print("\n🔍 [2/3] 正在扫描即将到期的非自动续签育儿嫂正式合同...")
        expirings = check_nanny_contracts_expiring()
        print(f"👉 扫描结果：找到 {len(expirings)} 条即将到期的非自动续签合同。")
        for idx, item in enumerate(expirings, 1):
            print(f"   [{idx}] 合同ID: {item['contract_id']} | 客户: {item['customer_name']} | 阿姨: {item['employee_name']} | 到期时间: {item['end_date']}")

        # 4. 检查 3: 月嫂预产期临近提醒
        print("\n🔍 [3/3] 正在扫描临近预产期的月嫂合同...")
        deliveries = check_maternity_nurse_delivery()
        print(f"👉 扫描结果：找到 {len(deliveries)} 条预产期临近的月嫂合同。")
        for idx, item in enumerate(deliveries, 1):
            print(f"   [{idx}] 合同ID: {item['contract_id']} | 客户: {item['customer_name']} | 阿姨: {item['employee_name']} | 预产期: {item['provisional_start_date']}")

        # 5. 汇总
        total_messages = len(trials) + len(expirings) + len(deliveries)
        print("\n==================================================")
        print(f"📊 [Dry-Run 汇总]")
        print(f"   待发送消息总数: {total_messages} 条")
        print("   - 试工到期通知: {} 条".format(len(trials)))
        print("   - 合同到期通知: {} 条".format(len(expirings)))
        print("   - 预产期临近通知: {} 条".format(len(deliveries)))
        print("==================================================")
        print("💡 Dry-Run 执行完成，无任何真实推送被触发，数据库状态保持纯净。")

if __name__ == '__main__':
    main()
