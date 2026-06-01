# -*- coding: utf-8 -*-
from datetime import datetime, date, timedelta
import logging
from sqlalchemy import or_, and_
from backend.models import (
    db, BaseContract, NannyTrialContract, NannyContract, MaternityNurseContract,
    TrialOutcome
)
from backend.utils.wechat_notifier import send_wechat_notification

logger = logging.getLogger(__name__)

def check_nanny_trial_contracts(advance_days=1):
    """
    育儿嫂试工合同到期预警。
    条件：试工结果待定（TrialOutcome.PENDING），状态为活动中，结束时间接近或已逾期。
    """
    logger.info(f"开始扫描即将到期的育儿嫂试工合同 (提前 {advance_days} 天)...")
    try:
        # 扫描截至到“今天+提前天数”到期，或者已经逾期的试工合同
        limit_date = datetime.now() + timedelta(days=advance_days)
        trial_contracts = NannyTrialContract.query.filter(
            BaseContract.status.in_(['active', 'trial_active']),
            NannyTrialContract.trial_outcome == TrialOutcome.PENDING,
            BaseContract.end_date <= limit_date
        ).all()
        
        results = []
        for contract in trial_contracts:
            results.append({
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": contract.service_personnel.name if contract.service_personnel else "服务人员",
                "end_date": contract.end_date.strftime("%Y-%m-%d"),
                "daily_rate": str(contract.employee_level or 0)
            })
        logger.info(f"找到 {len(results)} 个待确认的试工合同。")
        return results
    except Exception as e:
        logger.error(f"扫描育儿嫂试工合同失败: {e}", exc_info=True)
        return []

def check_nanny_contracts_expiring(advance_days=30):
    """
    育儿嫂正式合同到期预警（非自动续签）。
    条件：非自动续签（is_auto_renew为False或None），状态为活动中，X天内到期。
    """
    logger.info(f"开始扫描即将到期的非自动续签育儿嫂合同 (提前 {advance_days} 天)...")
    try:
        limit_date = datetime.now() + timedelta(days=advance_days)
        now_date = datetime.now()
        
        # 查找 nanny 类型的正式合同，且 is_auto_renew != True，并在指定的 X 天内到期的
        contracts = NannyContract.query.filter(
            BaseContract.status == 'active',
            BaseContract.type == 'nanny',
            or_(BaseContract.is_auto_renew == False, BaseContract.is_auto_renew.is_(None)),
            BaseContract.end_date > now_date,
            BaseContract.end_date <= limit_date
        ).all()
        
        results = []
        for contract in contracts:
            results.append({
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": contract.service_personnel.name if contract.service_personnel else "服务人员",
                "end_date": contract.end_date.strftime("%Y-%m-%d")
            })
        logger.info(f"找到 {len(results)} 个即将到期的非自动续签合同。")
        return results
    except Exception as e:
        logger.error(f"扫描即将到期正式合同失败: {e}", exc_info=True)
        return []

def check_maternity_nurse_delivery(advance_days=7):
    """
    月嫂合同预产期临近预警。
    条件：实际上户日期为空（尚未上户），状态为活动中，预产期在 X 天之内。
    """
    logger.info(f"开始扫描即将进入预产期的月嫂合同 (提前 {advance_days} 天)...")
    try:
        # 预产期是 Date 类型，所以需要跟 date 相比
        limit_date = date.today() + timedelta(days=advance_days)
        
        contracts = MaternityNurseContract.query.filter(
            BaseContract.status == 'active',
            BaseContract.type == 'maternity_nurse',
            BaseContract.actual_onboarding_date.is_(None),
            BaseContract.provisional_start_date.isnot(None),
            BaseContract.provisional_start_date >= date.today(),
            BaseContract.provisional_start_date <= limit_date
        ).all()
        
        results = []
        for contract in contracts:
            results.append({
                "contract_id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": contract.service_personnel.name if contract.service_personnel else "服务人员",
                "provisional_start_date": contract.provisional_start_date.strftime("%Y-%m-%d")
            })
        logger.info(f"找到 {len(results)} 个临近预产期的月嫂合同。")
        return results
    except Exception as e:
        logger.error(f"扫描月嫂合同失败: {e}", exc_info=True)
        return []
