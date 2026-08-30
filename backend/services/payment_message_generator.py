# backend/services/payment_message_generator.py

import os
import decimal
from datetime import datetime
from flask import current_app
from sqlalchemy import func
from backend.models import db, CustomerBill, FinancialAdjustment, AdjustmentType, CompanyBankAccount, PaymentRecord, EmployeePayroll, PayoutRecord, ServicePersonnel, AttendanceRecord, BaseContract
from backend.services.payroll_miniapp_link_service import (
    build_payroll_miniapp_link_payload,
    extract_https_urls,
    format_customer_miniapp_link_block,
)

# 使用 render_template_string 来渲染从文件读取的模板字符串
from flask import render_template_string

D = decimal.Decimal
THREE_PLACES = D("0.001")
TWO_PLACES = D("0.01")


def _as_date(value):
    if isinstance(value, datetime):
        return value.date()
    return value


def _decimal(value, default="0"):
    try:
        return D(str(value if value is not None else default))
    except (decimal.InvalidOperation, TypeError, ValueError):
        return D(default)


def _fixed(value, places=3):
    quantizer = THREE_PLACES if places == 3 else TWO_PLACES
    return f"{_decimal(value).quantize(quantizer, rounding=decimal.ROUND_HALF_UP):.{places}f}"


def _readable(value, places=3):
    text = _fixed(value, places)
    return text.rstrip("0").rstrip(".") or "0"


def _duration_display(hours):
    total_minutes = int(
        (_decimal(hours) * D(60)).to_integral_value(
            rounding=decimal.ROUND_HALF_UP
        )
    )
    days, remaining_minutes = divmod(total_minutes, 24 * 60)
    whole_hours, minutes = divmod(remaining_minutes, 60)
    parts = []
    if days:
        parts.append(f"{days}天")
    if whole_hours:
        parts.append(f"{whole_hours}小时")
    if minutes:
        parts.append(f"{minutes}分钟")
    return "".join(parts) or "0小时"


def _calculation_days_display(days):
    return _fixed(abs(_decimal(days)), 3)

# 预设的中文标签
ADJUSTMENT_TYPE_LABELS = {
    AdjustmentType.CUSTOMER_INCREASE: "客户增款",
    AdjustmentType.CUSTOMER_DECREASE: "客户减款",
    AdjustmentType.CUSTOMER_DISCOUNT: "优惠",
    AdjustmentType.EMPLOYEE_INCREASE: "员工增款",
    AdjustmentType.EMPLOYEE_DECREASE: "员工减款",
    AdjustmentType.EMPLOYEE_CLIENT_PAYMENT: "客户直付",
    AdjustmentType.EMPLOYEE_COMMISSION: "员工佣金",
    AdjustmentType.EMPLOYEE_COMMISSION_OFFSET: "佣金冲账",
    AdjustmentType.DEFERRED_FEE: "上期顺延费用",
    AdjustmentType.INTRODUCTION_FEE: "介绍费",
    AdjustmentType.DEPOSIT: "保证金",
    AdjustmentType.COMPANY_PAID_SALARY: "保证金代付员工工资",
    # 月嫂末期「保证金代付管理费」类型为 CUSTOMER_INCREASE，展示名按 description 特殊处理
}

class PaymentMessageGenerator:
    """
    负责根据一个或多个账单ID，生成格式化的催款消息。
    V2: 生成两部分消息：给公司和给员工。
    """

    def __init__(self):
        self.template_path = os.path.join(current_app.root_path, 'templates', 'payment_reminders')
        self.NEGATIVE_TYPES = {
            AdjustmentType.CUSTOMER_DECREASE,
            AdjustmentType.CUSTOMER_DISCOUNT,
            AdjustmentType.EMPLOYEE_DECREASE,
            AdjustmentType.EMPLOYEE_COMMISSION
        }

    def _load_template(self, filename):
        with open(os.path.join(self.template_path, filename), 'r', encoding='utf-8') as f:
            return f.read()

    def generate_for_bills(self, bill_ids: list[int]) -> dict:
        """公共主方法：为给定的账单ID列表生成两部分催款消息。"""
        if not bill_ids:
            return {"company_summary": "", "employee_summary": ""}

        bills = CustomerBill.query.filter(CustomerBill.id.in_(bill_ids)).order_by(CustomerBill.cycle_start_date).all()
        if not bills:
            return {"company_summary": "未找到指定账单。", "employee_summary": ""}

        # 按客户分组账单
        bills_by_customer = {}
        for bill in bills:
            customer_name = bill.contract.customer_name
            if customer_name not in bills_by_customer:
                bills_by_customer[customer_name] = []
            bills_by_customer[customer_name].append(bill)

        # 为每个客户生成消息
        all_company_summaries = []
        all_employee_summaries = []
        for customer_name, customer_bills in bills_by_customer.items():
            company_summary, employee_summary = self._generate_for_single_customer(customer_name, customer_bills)
            if company_summary:
                all_company_summaries.append(company_summary)
            if employee_summary:
                all_employee_summaries.append(employee_summary)

        final_company_summary = "\n\n".join(all_company_summaries)
        final_employee_summary = "\n\n".join(all_employee_summaries)

        # 提交生成 share_token / 小程序链接过程中的 DB 变更
        try:
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.warning(
                "催款消息生成后提交小程序 share_token 失败", exc_info=True
            )

        return {
            "company_summary": final_company_summary,
            "employee_summary": final_employee_summary
        }

    def build_beautify_payload(
        self,
        bill_ids,
        company_account_id=None,
        source_employee_summary="",
    ) -> dict:
        """Build the authoritative payload used by the fixed backend renderer."""
        bills = (
            CustomerBill.query.filter(CustomerBill.id.in_(bill_ids))
            .order_by(CustomerBill.cycle_start_date)
            .all()
        )
        if not bills:
            raise ValueError("未找到需要美化的账单")

        selected_ids = {str(bill.id) for bill in bills}
        company_account = None
        if company_account_id:
            company_account = CompanyBankAccount.query.filter_by(
                id=company_account_id,
                is_active=True,
            ).first()
        if not company_account:
            company_account = CompanyBankAccount.query.filter_by(
                is_default=True,
                is_active=True,
            ).first()
        company_bills = [
            self._build_company_beautify_item(bill, company_account)
            for bill in bills
        ]

        employee_groups = {}
        for bill in bills:
            employee_id = self._employee_id_for_bill(bill)
            group_key = (
                str(employee_id or ""),
                bill.contract.customer_name,
                bill.year,
                bill.month,
            )
            employee_groups.setdefault(group_key, []).append(bill)

        fallback_urls = [
            url
            for url in extract_https_urls(source_employee_summary or "")
            if url.startswith("https://wxmpurl.cn/")
        ]
        employee_bills = []
        for index, group_bills in enumerate(employee_groups.values()):
            fallback_url = fallback_urls[index] if index < len(fallback_urls) else ""
            employee_bills.append(
                self._build_employee_beautify_item(
                    group_bills,
                    selected_ids,
                    fallback_miniapp_url=fallback_url,
                )
            )

        return {
            "schema_version": "bill_beautify_v2",
            "rules": {
                "values_are_authoritative": True,
                "do_not_calculate_or_round": True,
                "empty_side_must_be_empty_string": True,
                "employee_output_must_be_compact": True,
                "omit_zero_overtime_or_rest_segment": True,
                "payable_days_equals_worked_plus_overtime": True,
                "do_not_output_calculation_detail_lines": True,
            },
            "company_bills": [item for item in company_bills if item],
            "employee_bills": [item for item in employee_bills if item],
        }

    def _build_company_beautify_item(self, bill, account):
        context = self._build_context_for_bill(bill, include_miniapp_link=False)
        if not context["company_line_items"]:
            return None

        line_items = [
            {"name": item["name"], "calculation": item["description"]}
            for item in context["company_line_items"]
        ]
        management_names = {"管理费", "本次交管理费"}
        management_only = all(item["name"] in management_names for item in line_items)
        return {
            "bill_id": str(bill.id),
            "display_mode": "management_fee_only" if management_only else "settlement_detail",
            "customer_name": bill.contract.customer_name,
            "employee_name": context["employee_name"],
            "service_start": _as_date(bill.cycle_start_date).isoformat(),
            "service_end": _as_date(bill.cycle_end_date).isoformat(),
            "line_items": line_items,
            "paid_amount_display": _fixed(bill.total_paid, 2),
            "pending_amount_display": _fixed(context["company_pending_amount"], 2),
            "bank_account": {
                "holder": account.payee_name if account else "",
                "account": account.account_number if account else "",
                "bank": account.bank_name if account else "",
            },
        }

    @staticmethod
    def _employee_id_for_bill(bill):
        if bill.is_substitute_bill and bill.source_substitute_record:
            record = bill.source_substitute_record
            if record.substitute_personnel:
                return record.substitute_personnel.id
            if record.substitute_user:
                return record.substitute_user.id
        return bill.contract.service_personnel_id

    def _related_renewal_bills(self, selected_bills):
        """Return same-employee/customer bills in the selected renewal month."""
        related = {str(bill.id): bill for bill in selected_bills}
        queue = [bill.contract for bill in selected_bills if not bill.is_substitute_bill]
        seen_contracts = set()

        while queue:
            contract = queue.pop(0)
            contract_id = str(contract.id)
            if contract_id in seen_contracts:
                continue
            seen_contracts.add(contract_id)

            neighbours = []
            if contract.previous_contract_id:
                previous = BaseContract.query.get(contract.previous_contract_id)
                if previous:
                    neighbours.append(previous)
            neighbours.extend(BaseContract.query.filter_by(previous_contract_id=contract.id).all())

            for neighbour in neighbours:
                if (
                    str(neighbour.service_personnel_id) != str(contract.service_personnel_id)
                    or neighbour.customer_name != contract.customer_name
                ):
                    continue
                queue.append(neighbour)
                for selected in selected_bills:
                    matching = CustomerBill.query.filter_by(
                        contract_id=neighbour.id,
                        year=selected.year,
                        month=selected.month,
                        is_substitute_bill=False,
                    ).all()
                    for bill in matching:
                        related[str(bill.id)] = bill

        return sorted(related.values(), key=lambda bill: bill.cycle_start_date)

    @staticmethod
    def _attendance_for_bill(bill):
        cycle_start = _as_date(bill.cycle_start_date)
        cycle_end = _as_date(bill.cycle_end_date)
        return AttendanceRecord.query.filter(
            AttendanceRecord.contract_id == bill.contract_id,
            func.date(AttendanceRecord.cycle_start_date) == cycle_start,
            func.date(AttendanceRecord.cycle_end_date) == cycle_end,
        ).order_by(AttendanceRecord.updated_at.desc().nullslast()).first()

    def _attendance_metrics(self, bill):
        attendance = self._attendance_for_bill(bill)
        calc = bill.calculation_details or {}
        if not attendance:
            worked_days = _decimal(calc.get("base_work_days") or bill.actual_work_days)
            overtime_days = _decimal(calc.get("overtime_days"))
            return {
                "worked_days": worked_days,
                "rest_days": D(0),
                "rest_hours": D(0),
                "overtime_days": overtime_days,
                "overtime_hours": overtime_days * D(24),
            }

        details = attendance.attendance_details or {}
        rest_days = _decimal(details.get("rest_days"))
        precise_overtime_days = _decimal(
            details.get("overtime_days"),
            str(attendance.overtime_days or 0),
        )
        overtime_days = _decimal(
            calc.get("overtime_days"),
            str(precise_overtime_days),
        )
        return {
            "worked_days": _decimal(
                calc.get("base_work_days"), str(attendance.total_days_worked or 0)
            ),
            "rest_days": rest_days,
            "rest_hours": rest_days * D(24),
            "overtime_days": overtime_days,
            "overtime_hours": precise_overtime_days * D(24),
        }

    def _build_employee_beautify_item(
        self,
        selected_bills,
        selected_ids,
        fallback_miniapp_url="",
    ):
        related_bills = self._related_renewal_bills(selected_bills)
        metrics = {
            "worked_days": D(0),
            "rest_days": D(0),
            "rest_hours": D(0),
            "overtime_days": D(0),
            "overtime_hours": D(0),
        }
        source_periods = []
        for bill in related_bills:
            item_metrics = self._attendance_metrics(bill)
            for key in metrics:
                metrics[key] += item_metrics[key]
            source_periods.append({
                "bill_id": str(bill.id),
                "start": _as_date(bill.cycle_start_date).isoformat(),
                "end": _as_date(bill.cycle_end_date).isoformat(),
            })

        selected_payrolls = []
        for bill in selected_bills:
            if str(bill.id) not in selected_ids:
                continue
            payroll = EmployeePayroll.query.filter_by(
                contract_id=bill.contract_id,
                cycle_start_date=bill.cycle_start_date,
                is_substitute_payroll=bill.is_substitute_bill,
            ).first()
            if payroll:
                selected_payrolls.append(payroll)
        if not selected_payrolls:
            return None

        total_due = sum((_decimal(payroll.total_due) for payroll in selected_payrolls), D(0))
        total_paid = sum((
            _decimal(db.session.query(func.sum(PayoutRecord.amount)).filter(
                PayoutRecord.employee_payroll_id == payroll.id
            ).scalar())
            for payroll in selected_payrolls
        ), D(0))
        primary_bill = max(selected_bills, key=lambda bill: bill.cycle_end_date)
        primary_context = self._build_context_for_bill(
            primary_bill,
            include_miniapp_link=False,
        )
        primary_payroll = max(selected_payrolls, key=lambda payroll: payroll.cycle_end_date)
        primary_calculation = primary_payroll.calculation_details or {}
        salary_base = _decimal(
            primary_calculation.get("level")
            or getattr(primary_bill.contract, "employee_level", 0)
        )
        payable_days = metrics["worked_days"] + metrics["overtime_days"]
        miniapp_url = (fallback_miniapp_url or "").strip()
        if not miniapp_url:
            link_payload = build_payroll_miniapp_link_payload(
                primary_payroll,
                commit=False,
            )
            miniapp_url = (link_payload.get("miniapp_url") or "").strip()
        account = primary_context["employee_bank_account"]

        return {
            "selected_bill_ids": [str(bill.id) for bill in selected_bills],
            "customer_name": primary_bill.contract.customer_name,
            "employee_name": primary_context["employee_name"],
            "service_start": min(_as_date(bill.cycle_start_date) for bill in related_bills).isoformat(),
            "service_end": max(_as_date(bill.cycle_end_date) for bill in related_bills).isoformat(),
            "source_periods": source_periods,
            "attendance": {
                "worked_days": _fixed(metrics["worked_days"]),
                "worked_days_display": _readable(metrics["worked_days"]),
                "rest": {
                    "duration_display": _duration_display(metrics["rest_hours"]),
                    "total_hours": _fixed(metrics["rest_hours"], 2),
                    "calculation_days": _fixed(metrics["rest_days"]),
                    "calculation_days_display": _calculation_days_display(
                        metrics["rest_days"]
                    ),
                    "show_calculation_days": (
                        metrics["rest_hours"] % D(24) != 0
                    ),
                },
                "overtime": {
                    "duration_display": _duration_display(metrics["overtime_hours"]),
                    "total_hours": _fixed(metrics["overtime_hours"], 2),
                    "calculation_days": _fixed(metrics["overtime_days"]),
                    "calculation_days_display": _calculation_days_display(
                        metrics["overtime_days"]
                    ),
                    "show_calculation_days": (
                        metrics["overtime_hours"] % D(24) != 0
                    ),
                },
            },
            "payable_days": _fixed(payable_days),
            "payable_days_display": _readable(payable_days, 3),
            "salary_base_display": _readable(salary_base, 2),
            "formula_total_display": _fixed(total_due, 2),
            "total_due_display": _fixed(total_due, 2),
            "paid_amount_display": _fixed(total_paid, 2),
            "pending_amount_display": _fixed(total_due - total_paid, 2),
            "bank_account": {
                "holder": account.get("holder_name") or "",
                "account": account.get("account_number") or "",
                "bank": account.get("bank_name") or "",
            },
            "miniapp_url": miniapp_url,
        }

    def _generate_for_single_customer(self, customer_name: str, bills: list[CustomerBill]) -> tuple[str, str]:
        """为单个客户的多张账单生成公司和员工两部分的消息。"""
        company_fragments = []
        employee_fragments = []
        employee_accounts = []
        grand_total_company = D('0.00')
        grand_total_employee = D('0.00')

        for bill in bills:
            context = self._build_context_for_bill(bill)
            
            # 渲染公司部分
            if context['company_line_items']:
                company_fragments.append(self._render_bill_fragment(context, 'company'))
                grand_total_company += context['company_pending_amount']

            # 渲染员工部分
            if context['employee_line_items']:
                employee_fragments.append(self._render_bill_fragment(context, 'employee'))
                employee_accounts.append(context.get('employee_bank_account'))
                grand_total_employee += context['employee_pending_amount']

        # 组装公司部分最终消息
        company_summary = ""
        if company_fragments:
            company_account = CompanyBankAccount.query.filter_by(is_default=True, is_active=True).first()
            company_summary = self._render_consolidated_wrapper(
                customer_name, company_fragments, grand_total_company, company_account, 'company'
            )

        # 组装员工部分最终消息
        employee_summary = ""
        if employee_fragments:
            employee_summary = self._render_consolidated_wrapper(
                customer_name, employee_fragments, grand_total_employee, None, 'employee', employee_accounts
            )

        return company_summary, employee_summary

    def _build_context_for_bill(
        self,
        bill: CustomerBill,
        *,
        include_miniapp_link: bool = True,
    ) -> dict:
        """为单个账单构建上下文，区分为公司和员工的款项。"""
        # 0. 首先，找到关联的员工工资单
        payroll = EmployeePayroll.query.filter_by(
            contract_id=bill.contract_id,
            cycle_start_date=bill.cycle_start_date,
            is_substitute_payroll=bill.is_substitute_bill
        ).first()

        # 1. 获取与客户账单和员工工资单相关的所有财务调整项
        bill_adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all()
        payroll_adjustments = []
        if payroll:
            payroll_adjustments = FinancialAdjustment.query.filter_by(employee_payroll_id=payroll.id).all()
        
        # 合并并去重
        all_adjustments = {adj.id: adj for adj in bill_adjustments}
        all_adjustments.update({adj.id: adj for adj in payroll_adjustments})
        adjustments = list(all_adjustments.values())

        # 2. 初始化
        calculation_log = (bill.calculation_details or {}).get('calculation_log', {})
        company_line_items, employee_line_items = [], []
        company_total = D('0.00')
        employee_total = D('0.00')

        # 3. 处理计算日志项
        for name, desc in calculation_log.items():
            if not desc: continue
            
            try:
                value_part = None
                if '=' in desc:
                    value_part = desc.split('=')[-1]
                elif ':' in desc:
                    value_part = desc.split(':')[-1]

                if value_part:
                    amount = D(value_part.strip().replace('元',''))
                else:
                    amount = D(0)

                if amount == 0: continue
            except (ValueError, IndexError, decimal.InvalidOperation):
                amount = D(-1)

            item = {"name": name, "description": desc}
            if name in ['基础劳务费', '加班费']:
                employee_line_items.append(item)
                employee_total += amount
            elif name == '被替班扣款':
                employee_line_items.append(item)
                employee_total -= amount
            elif name in ['本次交管理费', '管理费']:
                company_line_items.append(item)
                company_total += amount

        # 4. 处理财务调整项 (区分公司和员工)
        internal_adjustment_types = {
            AdjustmentType.EMPLOYEE_COMMISSION,
            AdjustmentType.EMPLOYEE_COMMISSION_OFFSET,
        }
        employee_adjustment_types = {
            AdjustmentType.EMPLOYEE_INCREASE,
            AdjustmentType.EMPLOYEE_DECREASE,
            AdjustmentType.EMPLOYEE_CLIENT_PAYMENT,
        }
        for adj in adjustments:
            if adj.amount == 0: continue

            if adj.adjustment_type in internal_adjustment_types:
                continue

            if adj.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY:
                if bill.is_substitute_bill:
                    continue
                item = {
                    "name": "已由保证金支付工资",
                    "description": f"{abs(adj.amount):.2f}元"
                }
                employee_line_items.append(item)
                employee_total -= adj.amount
                continue
            
            item = {
                "name": self._get_adjustment_name(adj),
                "description": self._get_adjustment_description(adj)
            }

            if adj.adjustment_type in employee_adjustment_types:
                employee_line_items.append(item)
                if adj.adjustment_type in self.NEGATIVE_TYPES:
                    employee_total -= adj.amount
                else:
                    employee_total += adj.amount
            else:
                company_line_items.append(item)
                if adj.adjustment_type in self.NEGATIVE_TYPES:
                    company_total -= adj.amount
                else:
                    company_total += adj.amount

        # 5. 获取客户付款记录
        customer_payments = bill.payment_records.order_by(PaymentRecord.payment_date.asc()).all()
        customer_total_paid = bill.total_paid
        company_pending = company_total - customer_total_paid

        # 6. 获取员工工资发放记录
        employee_total_paid = D(0)
        employee_payouts = []
        if payroll:
            payout_sum = db.session.query(func.sum(PayoutRecord.amount)).filter(
                PayoutRecord.employee_payroll_id == payroll.id
            ).scalar()
            employee_total_paid = payout_sum or D(0)
            employee_payouts = payroll.payout_records.order_by(PayoutRecord.payout_date.asc()).all()
        
        if payroll:
            employee_total = payroll.total_due
        employee_pending = employee_total - employee_total_paid

        # 7. 确定员工姓名和工资卡信息
        employee_name = ""
        employee_record = None
        if bill.is_substitute_bill and bill.source_substitute_record:
            sub_record = bill.source_substitute_record
            if sub_record.substitute_user:
                employee_name = sub_record.substitute_user.username
            elif sub_record.substitute_personnel:
                employee_record = sub_record.substitute_personnel
                employee_name = employee_record.name
        elif bill.contract:
            employee_record = bill.contract.service_personnel
            employee_name = employee_record.name if employee_record else "未知员工"

        if not employee_record and payroll:
            employee_record = ServicePersonnel.query.get(payroll.employee_id)

        employee_bank_account = self._build_employee_bank_account(employee_name, employee_record)

        # 客户小程序工资单链接（与财务详情「复制链接」同源）
        customer_miniapp_url = ""
        customer_miniapp_link_block = ""
        if include_miniapp_link and payroll and not payroll.is_substitute_payroll:
            try:
                link_payload = build_payroll_miniapp_link_payload(
                    payroll, commit=False
                )
                customer_miniapp_url = (link_payload.get("miniapp_url") or "").strip()
                if customer_miniapp_url:
                    customer_miniapp_link_block = format_customer_miniapp_link_block(
                        customer_miniapp_url
                    )
                elif link_payload.get("miniapp_error"):
                    current_app.logger.info(
                        "催款消息未附带小程序链接 payroll_id=%s: %s",
                        payroll.id,
                        link_payload.get("miniapp_error"),
                    )
            except Exception as e:
                current_app.logger.warning(
                    "催款消息生成小程序链接失败 bill_id=%s: %s",
                    bill.id,
                    e,
                    exc_info=True,
                )

        return {
            "customer_name": bill.contract.customer_name,
            "employee_name": employee_name,
            "employee_bank_account": employee_bank_account,
            "bill_date_range": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} ~ {bill.cycle_end_date.strftime('%Y-%m-%d')}",
            "company_line_items": company_line_items,
            "employee_line_items": employee_line_items,
            "company_pending_amount": company_pending,
            "employee_pending_amount": employee_pending,
            "payments": customer_payments,
            "total_paid": customer_total_paid,
            "employee_payouts": employee_payouts,
            "customer_miniapp_url": customer_miniapp_url,
            "customer_miniapp_link_block": customer_miniapp_link_block,
        }

    def _build_employee_bank_account(self, employee_name: str, employee) -> dict:
        """构建员工工资卡展示信息。"""
        account = {
            "employee_name": employee_name or "未知员工",
            "holder_name": None,
            "bank_name": None,
            "account_number": None,
            "is_complete": False,
        }
        if not employee:
            return account

        account["holder_name"] = getattr(employee, "salary_card_holder_name", None)
        account["bank_name"] = getattr(employee, "salary_card_bank_name", None)
        account["account_number"] = getattr(employee, "salary_card_number", None)
        account["is_complete"] = bool(
            account["holder_name"] and account["bank_name"] and account["account_number"]
        )
        return account

    def _get_adjustment_name(self, adj: FinancialAdjustment) -> str:
        """根据智能命名规则确定调整项的名称，并移除系统标记。"""
        generic_types = [AdjustmentType.CUSTOMER_INCREASE, AdjustmentType.CUSTOMER_DECREASE, AdjustmentType.EMPLOYEE_INCREASE, AdjustmentType.EMPLOYEE_DECREASE]
        
        clean_description = (adj.description or "").replace("[系统添加]", "").replace("[系统]", "").strip()

        if adj.adjustment_type in generic_types:
            if clean_description:
                # 月嫂末期：保证金代付管理费
                if "保证金代付管理费" in clean_description:
                    return "保证金代付管理费"
                return clean_description
            else:
                return ADJUSTMENT_TYPE_LABELS.get(adj.adjustment_type, adj.adjustment_type.name)

        name = ADJUSTMENT_TYPE_LABELS.get(adj.adjustment_type, adj.adjustment_type.name)
        if clean_description:
            name = f"{name}({clean_description})"
            
        return name

    def _get_adjustment_description(self, adj: FinancialAdjustment) -> str:
        """根据类型确定金额的符号并格式化。"""
        amount = adj.amount
        if adj.adjustment_type in self.NEGATIVE_TYPES:
            return f"-{amount:.2f}元"
        else:
            return f"+{amount:.2f}元"

    def _render_bill_fragment(self, context: dict, part: str) -> str:
        """渲染单个账单的片段（公司或员工部分）。"""
        template_str = self._load_template(f'bill_fragment_{part}.txt')
        
        # 创建上下文副本，以便仅为渲染修改数据，而不影响后续计算
        render_context = context.copy()
        
        # 根据当前渲染的部分，对相应的小计金额进行四舍五入以供显示
        if part == 'company' and 'company_pending_amount' in render_context:
            amount = render_context['company_pending_amount']
            render_context['company_pending_amount'] = amount.quantize(D('1'), rounding=decimal.ROUND_HALF_UP)
        elif part == 'employee' and 'employee_pending_amount' in render_context:
            amount = render_context['employee_pending_amount']
            render_context['employee_pending_amount'] = amount.quantize(D('1'), rounding=decimal.ROUND_HALF_UP)
            
        return render_template_string(template_str, **render_context)

    def _render_consolidated_wrapper(self, customer_name, fragments, total_due, account_info, part: str, employee_accounts=None) -> str:
        """渲染最终合并消息（公司或员工部分）。"""
        template_str = self._load_template(f'consolidated_wrapper_{part}.txt')
        
        # 对总金额进行四舍五入，保留到整数位
        rounded_total_due = total_due.quantize(D('1'), rounding=decimal.ROUND_HALF_UP)

        unique_employee_accounts = []
        seen_accounts = set()
        for account in employee_accounts or []:
            if not account:
                continue
            key = (
                account.get("employee_name"),
                account.get("holder_name"),
                account.get("bank_name"),
                account.get("account_number"),
            )
            if key in seen_accounts:
                continue
            seen_accounts.add(key)
            unique_employee_accounts.append(account)

        context = {
            "customer_name": customer_name,
            "bill_fragments": fragments,
            "grand_total_amount": f"{rounded_total_due}",
            "company_account": account_info,
            "employee_accounts": unique_employee_accounts,
        }
        return render_template_string(template_str, **context)
