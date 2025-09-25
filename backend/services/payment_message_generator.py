# backend/services/payment_message_generator.py

import json
import os
import decimal
from flask import current_app
from backend.models import db, CustomerBill, FinancialAdjustment, AdjustmentType, CompanyBankAccount

# 使用 render_template_string 来渲染从文件读取的模板字符串
from flask import render_template_string

D = decimal.Decimal

class PaymentMessageGenerator:
    """
    负责根据一个或多个账单ID，生成格式化的催款消息。
    """

    def __init__(self):
        self.NEGATIVE_TYPES = {
            AdjustmentType.CUSTOMER_DECREASE,
            AdjustmentType.CUSTOMER_DISCOUNT,
            AdjustmentType.EMPLOYEE_DECREASE,
            AdjustmentType.EMPLOYEE_COMMISSION
        }
        self.template_path = os.path.join(current_app.root_path, 'templates', 'payment_reminders')

    def _load_template(self, filename):
        """从文件系统加载模板。"""
        with open(os.path.join(self.template_path, filename), 'r', encoding='utf-8') as f:
            return f.read()

    def generate_for_bills(self, bill_ids: list[int]) -> str:
        """公共主方法：为给定的账单ID列表生成催款消息。"""
        if not bill_ids:
            return ""

        bills = CustomerBill.query.filter(CustomerBill.id.in_(bill_ids)).all()
        if not bills:
            return "未找到指定的账单。"

        bills_by_customer = {}
        for bill in bills:
            customer_name = bill.contract.customer_name
            if customer_name not in bills_by_customer:
                bills_by_customer[customer_name] = []
            bills_by_customer[customer_name].append(bill)

        all_messages = []
        for customer_name, customer_bills in bills_by_customer.items():
            all_messages.append(self._generate_for_single_customer(customer_name, customer_bills))

        return "\n\n".join(all_messages)

    def _generate_for_single_customer(self, customer_name: str, bills: list[CustomerBill]) -> str:
        """为单个客户的多张账单生成合并的消息。"""
        bill_fragments = []
        grand_total_due = D('0.00')

        for bill in sorted(bills, key=lambda b: b.cycle_start_date):
            context = self._build_context_for_bill(bill)
            bill_fragments.append(self._render_bill_fragment(context))
            grand_total_due += bill.total_due

        company_account = CompanyBankAccount.query.filter_by(is_default=True, is_active=True).first()

        return self._render_consolidated_wrapper(customer_name, bill_fragments, grand_total_due, company_account)

    def _build_context_for_bill(self, bill: CustomerBill) -> dict:
        """为单个账单构建用于渲染的上下文(V3.5 - 修复零值过滤bug)。"""
        calculation_details = bill.calculation_details or {}
        calculation_log = calculation_details.get('calculation_log', {})
        adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=bill.id).all()

        final_line_items = []

        # 1. 处理核心计算项
        core_items_map = {
            '基础劳务费': calculation_log.get('基础劳务费'),
            '加班费': calculation_log.get('加班费'),
            '本次交管理费': calculation_log.get('本次交管理费')
        }
        for name, desc in core_items_map.items():
            if desc:
                try:
                    if '=' in desc:
                        result_val_str = desc.split('=')[-1].strip()
                        if D(result_val_str) == 0:
                            continue
                    final_line_items.append({"name": name, "description": desc})
                except (ValueError, IndexError, decimal.InvalidOperation):
                    final_line_items.append({"name": name, "description": desc})

        # 2. 处理财务调整项
        for adj in adjustments:
            if adj.amount == 0:
                continue

            name = self._get_adjustment_name(adj)
            description = self._get_adjustment_description(adj)
            final_line_items.append({"name": name, "description": description})
        
        return {
            "customer_name": bill.contract.customer_name,
            "employee_name": bill.contract.user.username if bill.contract.user else bill.contract.service_personnel.name,
            "bill_date_range": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} ~ {bill.cycle_end_date.strftime('%Y-%m-%d')}",
            "line_items": final_line_items,
            "total_due": bill.total_due
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

    def _render_bill_fragment(self, context: dict) -> str:
        """使用Jinja2模板渲染单个账单片段。"""
        template_str = self._load_template('bill_fragment.txt')
        return render_template_string(template_str, **context)

    def _render_consolidated_wrapper(self, customer_name, bill_fragments, grand_total_due, company_account) -> str:
        """使用Jinja2模板渲染最终合并消息。"""
        template_str = self._load_template('consolidated_wrapper.txt')
        context = {
            "customer_name": customer_name,
            "bill_fragments": bill_fragments,
            "grand_total_amount": f"{grand_total_due:.2f}",
            "company_account": company_account
        }
        return render_template_string(template_str, **context)

# 预设的中文标签，将来可以移到更合适的位置
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
    AdjustmentType.COMPANY_PAID_SALARY: "公司代付工资"
}
