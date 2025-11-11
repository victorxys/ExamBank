# backend/services/payment_message_generator.py

import os
import decimal
from flask import current_app
from sqlalchemy import func
from backend.models import db, CustomerBill, FinancialAdjustment, AdjustmentType, CompanyBankAccount, PaymentRecord, EmployeePayroll, PayoutRecord

# 使用 render_template_string 来渲染从文件读取的模板字符串
from flask import render_template_string

D = decimal.Decimal

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
    AdjustmentType.COMPANY_PAID_SALARY: "保证金代付员工工资"
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

        return {
            "company_summary": final_company_summary,
            "employee_summary": final_employee_summary
        }

    def _generate_for_single_customer(self, customer_name: str, bills: list[CustomerBill]) -> tuple[str, str]:
        """为单个客户的多张账单生成公司和员工两部分的消息。"""
        company_fragments = []
        employee_fragments = []
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
                customer_name, employee_fragments, grand_total_employee, None, 'employee'
            )

        return company_summary, employee_summary

    def _build_context_for_bill(self, bill: CustomerBill) -> dict:
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

        # 7. 确定员工姓名
        employee_name = ""
        if bill.is_substitute_bill and bill.source_substitute_record:
            sub_record = bill.source_substitute_record
            employee_name = sub_record.substitute_user.username if sub_record.substitute_user else sub_record.substitute_personnel.name
        elif bill.contract:
            employee_name = bill.contract.service_personnel.name if bill.contract.service_personnel else "未知员工"

        return {
            "customer_name": bill.contract.customer_name,
            "employee_name": employee_name,
            "bill_date_range": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} ~ {bill.cycle_end_date.strftime('%Y-%m-%d')}",
            "company_line_items": company_line_items,
            "employee_line_items": employee_line_items,
            "company_pending_amount": company_pending,
            "employee_pending_amount": employee_pending,
            "payments": customer_payments,
            "total_paid": customer_total_paid,
            "employee_payouts": employee_payouts,
        }

    def _get_adjustment_name(self, adj: FinancialAdjustment) -> str:
        """根据智能命名规则确定调整项的名称，并移除系统标记。"""
        generic_types = [AdjustmentType.CUSTOMER_INCREASE, AdjustmentType.CUSTOMER_DECREASE, AdjustmentType.EMPLOYEE_INCREASE, AdjustmentType.EMPLOYEE_DECREASE]
        
        clean_description = (adj.description or "").replace("[系统添加]", "").strip()

        if adj.adjustment_type in generic_types:
            if clean_description:
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

    def _render_consolidated_wrapper(self, customer_name, fragments, total_due, account_info, part: str) -> str:
        """渲染最终合并消息（公司或员工部分）。"""
        template_str = self._load_template(f'consolidated_wrapper_{part}.txt')
        
        # 对总金额进行四舍五入，保留到整数位
        rounded_total_due = total_due.quantize(D('1'), rounding=decimal.ROUND_HALF_UP)

        context = {
            "customer_name": customer_name,
            "bill_fragments": fragments,
            "grand_total_amount": f"{rounded_total_due}",
            "company_account": account_info
        }
        return render_template_string(template_str, **context)
