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

def check_nanny_trial_contracts():
    """
    育儿嫂试工合同到期预警。
    条件：试工结果待定（TrialOutcome.PENDING），状态为活动中，结束时间接近或已逾期。
    """
    logger.info("开始扫描到期的育儿嫂试工合同...")
    try:
        # 扫描截至到“今天/明天到期，或者已经逾期”的试工合同
        limit_date = datetime.now() + timedelta(days=1)
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

def check_nanny_contracts_expiring():
    """
    育儿嫂正式合同到期预警（非自动续签）。
    条件：非自动续签（is_auto_renew为False或None），状态为活动中，30天内到期。
    """
    logger.info("开始扫描即将到期的非自动续签育儿嫂合同...")
    try:
        limit_date = datetime.now() + timedelta(days=30)
        now_date = datetime.now()
        
        # 查找 nanny 类型的正式合同，且 is_auto_renew != True，并在30天内到期的
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

def check_maternity_nurse_delivery():
    """
    月嫂合同预产期临近预警。
    条件：实际上户日期为空（尚未上户），状态为活动中，预产期在7天之内。
    """
    logger.info("开始扫描即将进入预产期的月嫂合同...")
    try:
        # 预产期是 Date 类型，所以需要跟 date 相比
        limit_date = date.today() + timedelta(days=7)
        
        contracts = MaternityNurseContract.query.filter(
            BaseContract.status == 'active',
            BaseContract.type == 'maternity_nurse',
            BaseContract.actual_onboarding_date.is_(None),
            BaseContract.provisional_start_date.isnot(None),
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

def run_daily_reminders_check():
    """
    执行日常所有的定时扫描任务，组装卡片并向微信推送。
    """
    logger.info("====== 开始执行每日系统消息扫描 ======")
    
    # 1. 试工到期提醒
    trials = check_nanny_trial_contracts()
    for contract in trials:
        try:
            from backend.tasks import send_wechat_notification_task
            
            # 使用 backend.tasks 异步推送以自动保存消息日志
            from backend.app import app
            frontend_base_url = app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
            jump_url = f"{frontend_base_url}/contracts/{contract['contract_id']}"
            
            title = "🚨 试工到期结果确认提醒"
            desc = f"""<div class="gray">到期时间：{contract['end_date']}</div>
                    <div class="normal">阿姨 <b>{contract['employee_name']}</b> 在客户 <b>{contract['customer_name']}</b> 家的试工合同已到期。</div>
                    <div class="normal">试工日薪：{contract['daily_rate']} 元</div>
                    <div class="highlight">请及时沟通并确认试工结果（成功/失败/延长）。</div>"""
                    
            send_wechat_notification_task.delay(
                touser=None,
                title=title,
                description=desc,
                jump_url=jump_url,
                msg_type="TRIAL_EXPIRING"
            )
        except Exception as pe:
            logger.error(f"排队试工到期通知任务失败: {pe}")

    # 2. 正式合同到期提醒
    expirings = check_nanny_contracts_expiring()
    for contract in expirings:
        try:
            from backend.tasks import send_wechat_notification_task
            from backend.app import app
            frontend_base_url = app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
            jump_url = f"{frontend_base_url}/contracts/{contract['contract_id']}"
            
            title = "📅 正式合同即将到期提醒"
            desc = f"""<div class="gray">到期时间：{contract['end_date']}</div>
                    <div class="normal">客户 <b>{contract['customer_name']}</b> 与服务人员 <b>{contract['employee_name']}</b> 的正式合同即将到期。</div>
                    <div class="highlight">该合同为<b>非自动续签</b>合同，请提前联系客户和服务人员沟通续期或下户事宜。</div>"""
                    
            send_wechat_notification_task.delay(
                touser=None,
                title=title,
                description=desc,
                jump_url=jump_url,
                msg_type="CONTRACT_EXPIRING"
            )
        except Exception as pe:
            logger.error(f"排队合同到期通知任务失败: {pe}")

    # 3. 预产期临近提醒
    deliveries = check_maternity_nurse_delivery()
    for contract in deliveries:
        try:
            from backend.tasks import send_wechat_notification_task
            from backend.app import app
            frontend_base_url = app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
            jump_url = f"{frontend_base_url}/contracts/{contract['contract_id']}"
            
            title = "👶 月嫂合同预产期临近提醒"
            desc = f"""<div class="gray">预计预产期：{contract['provisional_start_date']}</div>
                    <div class="normal">客户 <b>{contract['customer_name']}</b> 的合同预计即将生产。</div>
                    <div class="normal">服务人员：{contract['employee_name']}</div>
                    <div class="highlight">服务人员尚未实际上户，请及时跟进客户的生产情况与阿姨的准备状态，并记录上户时间。</div>"""
                    
            send_wechat_notification_task.delay(
                touser=None,
                title=title,
                description=desc,
                jump_url=jump_url,
                msg_type="PREGNANCY_ALERT"
            )
        except Exception as pe:
            logger.error(f"排队预产期通知任务失败: {pe}")

    logger.info("====== 每日系统消息扫描执行完毕 ======")
