from flask import current_app
from backend.extensions import db
from backend.models import BaseContract, CustomerBill, EmployeePayroll, FinancialAdjustment,AdjustmentType
from sqlalchemy.orm import joinedload, noload
import decimal
from datetime import date

D = decimal.Decimal

class BillMergeService:
    """
    处理非月签合同续约时的账单合并。
    核心逻辑：将源合同的最后一期账单通过创建冲抵调整项的方式清零，
    并将所有款项转移至续约合同的第一期账单中。
    """

    def _get_entities(self, source_bill_id, target_contract_id):
        """获取所有相关的数据库实体。"""
        # 移除对 financial_adjustments 的 joinedload
        source_bill = CustomerBill.query.options(
            joinedload(CustomerBill.contract)
        ).get(source_bill_id)
        if not source_bill:
            raise ValueError("源客户账单未找到")

        # 同样，这里也不需要 joinedload
        source_payroll = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id == source_bill.contract_id,
            EmployeePayroll.year == source_bill.year,
            EmployeePayroll.month == source_bill.month
        ).first()
        if not source_payroll:
            raise ValueError("源员工工资单未找到")

        target_contract = BaseContract.query.get(target_contract_id)
        if not target_contract:
            raise ValueError("目标合同未找到")

        target_bill = CustomerBill.query.filter(
            CustomerBill.contract_id == target_contract_id
        ).order_by(CustomerBill.year.asc(), CustomerBill.month.asc()).first()
        if not target_bill:
            raise ValueError("目标合同的首期客户账单未找到")

        target_payroll = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id == target_contract_id,
            EmployeePayroll.year == target_bill.year,
            EmployeePayroll.month == target_bill.month
        ).first()
        if not target_payroll:
            raise ValueError("目标合同的首期员工工资单未找到")

        if source_bill.is_merged:
            raise ValueError("源账单已被合并，不能重复操作。")

        return source_bill, source_payroll, target_bill, target_payroll

    def _calculate_preview(self, source_bill, source_payroll):
        """计算预览数据，这是一个纯计算函数，不修改数据库。"""

        adjustments_to_delete = []

        for adj in source_bill.financial_adjustments:
            if adj.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY:
                adjustments_to_delete.append(self._format_adj(adj, "客户账单"))

        for adj in source_payroll.financial_adjustments:
            if adj.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY:
                adjustments_to_delete.append(self._format_adj(adj, "员工工资单"))

        # 修正: 使用 total_due 属性
        customer_balance = source_bill.total_due - source_bill.total_paid
        for adj in source_bill.financial_adjustments:
            if adj.adjustment_type == AdjustmentType.COMPANY_PAID_SALARY:
                customer_balance -= adj.amount

        # 修正: 使用 total_due 属性
        # current_app.logger.debug(f"[MergeDebug] Source payroll total_due: {source_payroll}")
        payroll_balance = source_payroll.total_due - source_payroll.total_paid_out
        # for adj in source_payroll.financial_adjustments:
        #      if adj.adjustment_type == AdjustmentType.DEPOSIT_PAID_SALARY:
        #         payroll_balance -= adj.amount

        customer_adjustments = []
        if customer_balance != D(0):
            customer_adjustments.extend(self._get_balance_adjs_preview("customer",customer_balance))

        payroll_adjustments = []
        if payroll_balance != D(0):
            payroll_adjustments.extend(self._get_balance_adjs_preview("employee",payroll_balance))

        commission_adjustments = []
        for adj in source_payroll.financial_adjustments:
            if adj.adjustment_type == AdjustmentType.EMPLOYEE_COMMISSION:
                commission_adjustments.extend(self._get_commission_adjs_preview(adj))

        return {
            "customer_bill": {
                "balance": str(customer_balance.quantize(D("0.01"))),
                "actions": customer_adjustments
            },
            "employee_payroll": {
                "balance": str(payroll_balance.quantize(D("0.01"))),
                "actions": payroll_adjustments,
                "commission_actions": commission_adjustments
            },
            "to_be_deleted": adjustments_to_delete
        }

    def get_merge_preview(self, source_bill_id, target_contract_id):
        """获取账单合并的预览数据。"""
        source_bill, source_payroll, target_bill, _ = self._get_entities(source_bill_id,target_contract_id)

        preview_data = self._calculate_preview(source_bill, source_payroll)

        return {
            "source_info": self._format_bill_info(source_bill),
            "target_info": self._format_bill_info(target_bill),
            "preview": preview_data
        }

    def execute_merge(self, source_bill_id, target_contract_id):
        """执行账单合并操作。"""
        try:
            source_bill, source_payroll, target_bill, target_payroll = self._get_entities(source_bill_id, target_contract_id)

            # 1. 转移特殊的代付调整项
            self._transfer_special_adjustments(source_bill, source_payroll, target_bill,target_payroll)

            # 刷新会话以应用删除和创建
            db.session.flush()

            # 2. 对剩余的款项进行差额冲抵
            self._balance_bill(source_bill, target_bill)
            self._balance_payroll(source_payroll, target_payroll, source_bill, target_bill)

            # 【核心新增】在平衡工资单后，删除源工资单中的“保证金支付工资”调整项
            self._delete_deposit_paid_salary_adjustment(source_payroll)

            # 3. 转移员工返佣 (此逻辑保持不变)
            self._transfer_commissions(source_payroll, target_payroll, source_bill.id,target_bill.id)

            # 4. 标记源账单为已合并
            source_bill.is_merged = True

            db.session.commit()

            current_app.logger.info(f"账单合并成功: 源账单ID {source_bill.id} -> 目标合同ID {target_contract_id}")
            # return {"message": "账单合并成功"}
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"账单合并操作失败: {e}", exc_info=True)
            raise
        
        # --- 【核心新增】在合并成功后，触发对目标账单的重算 ---
        try:
            current_app.logger.info(f"合并完成，开始触发目标账单 {target_bill.id} 的重算...")
            from backend.services.billing_engine import BillingEngine
            engine = BillingEngine()
            engine.calculate_for_month(
                year=target_bill.year,
                month=target_bill.month,
                contract_id=target_bill.contract_id,
                force_recalculate=True,
                cycle_start_date_override=target_bill.cycle_start_date
            )
            # 第二次提交：保存重算结果
            db.session.commit()
            current_app.logger.info(f"目标账单 {target_bill.id} 重算成功。")
        except Exception as recalc_error:
            # 如果重算失败，只记录错误，不影响合并成功的结果
            current_app.logger.error(f"合并后自动重算目标账单 {target_bill.id} 失败: {recalc_error}", exc_info=True)

        return {"message": "账单合并成功，目标账单已自动更新。"}

    def _balance_bill(self, source_bill, target_bill):
        """计算客户账单余额，并创建冲抵/转移调整项。"""
        # 按照你的要求，直接使用 total_due 字段
        balance = D(0)
        for adj in source_bill.financial_adjustments.all():
            # 根据 adjustment_type 的效果来累加或累减
            if adj.adjustment_type in [AdjustmentType.CUSTOMER_INCREASE,AdjustmentType.INTRODUCTION_FEE, AdjustmentType.DEPOSIT, AdjustmentType.DEFERRED_FEE]:
                balance += adj.amount
            elif adj.adjustment_type in [AdjustmentType.CUSTOMER_DECREASE,AdjustmentType.CUSTOMER_DISCOUNT]:
                balance -= adj.amount

        # 如果冲抵后余额恰好为0，也要确保 total_due 字段被更新
        if balance.is_zero():
            source_bill.total_due = D(0)
            return

        op_adj_type = AdjustmentType.CUSTOMER_DECREASE if balance > 0 else AdjustmentType.CUSTOMER_INCREASE
        mirror_adj_type = AdjustmentType.CUSTOMER_INCREASE if balance > 0 else AdjustmentType.CUSTOMER_DECREASE
        amount = abs(balance)
        current_app.logger.debug(f"[MergeDebug] Creating adjustments: {op_adj_type} of {amount} on source bill {source_bill.id}, {mirror_adj_type} of {amount} on target bill {target_bill.id}")
        self._create_adjustment(
            customer_bill_id=source_bill.id,
            contract_id=source_bill.contract_id,
            adj_type=op_adj_type,
            amount=amount,
            description=f"[冲抵]客户待付/待退费用转移至续约合同",
            details={"linked_bill_id": str(target_bill.id)}
        )
        self._create_adjustment(
            customer_bill_id=target_bill.id,
            contract_id=target_bill.contract_id,
            adj_type=mirror_adj_type,
            amount=amount,
            description=f"[转入]前合同合并转入客户待付/待退费用",
            details={"linked_bill_id": str(source_bill.id)}
        )

        source_bill.total_due = D(0)

    def _balance_payroll(self, source_payroll, target_payroll, source_bill, target_bill):
        """计算员工工资单余额，并创建冲抵/转移调整项。"""
        balance = D(0)
        for adj in source_payroll.financial_adjustments.all():
            # 【核心修正】将 DEPOSIT_PAID_SALARY 也视为增加应付的款项
            if adj.adjustment_type in [
                AdjustmentType.EMPLOYEE_INCREASE,
                AdjustmentType.EMPLOYEE_CLIENT_PAYMENT,
                AdjustmentType.DEPOSIT_PAID_SALARY
            ]:
                balance += adj.amount
            elif adj.adjustment_type in [
                AdjustmentType.EMPLOYEE_DECREASE,
                AdjustmentType.EMPLOYEE_COMMISSION
            ]:
                balance -= adj.amount

        if balance.is_zero():
            source_payroll.total_due = D(0)
            return

        op_adj_type = AdjustmentType.EMPLOYEE_DECREASE if balance > 0 else AdjustmentType.EMPLOYEE_INCREASE
        mirror_adj_type = AdjustmentType.EMPLOYEE_INCREASE if balance > 0 else AdjustmentType.EMPLOYEE_DECREASE
        amount = abs(balance)

        self._create_adjustment(
            employee_payroll_id=source_payroll.id,
            contract_id=source_payroll.contract_id,
            adj_type=op_adj_type,
            amount=amount,
            description=f"[冲抵]员工待付工资转移至续约合同",
            details={"linked_bill_id": str(target_bill.id)}
        )
        self._create_adjustment(
            employee_payroll_id=target_payroll.id,
            contract_id=target_payroll.contract_id,
            adj_type=mirror_adj_type,
            amount=amount,
            description=f"[转入]前合同合并转入员工待付工资",
            details={"linked_bill_id": str(source_bill.id)}
        )

        source_payroll.total_due = D(0)

    def _transfer_commissions(self, source_payroll, target_payroll, source_bill_id,target_bill_id):
        """处理员工返佣的转移。"""
        commissions = FinancialAdjustment.query.filter_by(
            employee_payroll_id=source_payroll.id,
            adjustment_type=AdjustmentType.EMPLOYEE_COMMISSION
        ).all()

        for comm in commissions:
            # 修正: 将 UUID 转为字符串
            self._create_adjustment(
                employee_payroll_id=source_payroll.id,
                contract_id=source_payroll.contract_id,
                adj_type=AdjustmentType.EMPLOYEE_COMMISSION_OFFSET,
                amount=comm.amount,
                description=f"返佣转移冲抵: {comm.description}",
                details={"linked_bill_id": str(target_bill_id)}
            )
            # 修正: 将 UUID 转为字符串
            self._create_adjustment(
                employee_payroll_id=target_payroll.id,
                contract_id=target_payroll.contract_id,
                adj_type=AdjustmentType.EMPLOYEE_COMMISSION,
                amount=comm.amount,
                description=f"返佣转移接收: {comm.description}",
                details={"linked_bill_id": str(source_bill_id)}
            )

    def _create_adjustment(self, adj_type, amount, description, contract_id, date_=None, details=None,customer_bill_id=None, employee_payroll_id=None):
        """创建一个财务调整项的辅助函数。"""
        if amount <= 0: return
        adj = FinancialAdjustment(
            adjustment_type=adj_type,
            amount=amount,
            description=description,
            contract_id=contract_id,
            customer_bill_id=customer_bill_id,
            employee_payroll_id=employee_payroll_id,
            date=date_ or date.today(),  # 使用传入的日期，如果未提供则默认为今天
            status='BILLED',
            is_settled=False,
            details=details or {}
        )
        db.session.add(adj)
        return adj

    # --- Preview Helper Methods ---
    def _format_adj(self, adj, scope):
        return {
            "description": adj.description,
            "amount": str(adj.amount.quantize(D("0.01"))),
            "type": adj.adjustment_type.value,
            "scope": scope
        }

    def _format_bill_info(self, bill):
        from backend.api.utils import get_contract_type_details
        if not bill: return {}

        contract = bill.contract
        if not contract: return {"bill_id": str(bill.id)}

        employee = contract.service_personnel
        employee_name = "未知员工"
        if employee:
            employee_name = getattr(employee, 'username', getattr(employee, 'name', '未知员工'))

        return {
            "bill_id": str(bill.id),
            "contract_id": str(contract.id), # <-- 新增：合同ID
            "contract_name": f"{contract.customer_name}的{get_contract_type_details(contract.type )}合同",
            "customer_name": contract.customer_name,
            "employee_name": employee_name, # <-- 新增：员工姓名
            "period": f"{bill.year}-{bill.month:02d}",
            "start_date": contract.start_date.strftime('%Y-%m-%d') if contract.start_date else None,
            "end_date": contract.end_date.strftime('%Y-%m-%d') if contract.end_date else None,
        }

    def _get_balance_adjs_preview(self, scope, balance):
        """生成用于预览的冲抵/转移调整项描述。"""
        if balance == D(0): return []

        amount_str = str(abs(balance).quantize(D("0.01")))

        if scope == "customer":
            op_desc = "应收冲抵" if balance > 0 else "应退冲抵"
            mirror_desc = "应收转移" if balance > 0 else "应退转移"
        else: # employee
            op_desc = "应付冲抵" if balance > 0 else "预付冲抵"
            mirror_desc = "应付转移" if balance > 0 else "预付转移"

        return [
            {"location": "源账单", "description": op_desc, "amount": f"-{amount_str}"},
            {"location": "目标账单", "description": mirror_desc, "amount": f"+{amount_str}"}
        ]

    def _get_commission_adjs_preview(self, commission_adj):
        """生成用于预览的返佣转移描述。"""
        amount_str = str(commission_adj.amount.quantize(D("0.01")))
        return [
            {"location": "源工资单", "description": f"返佣冲抵: {commission_adj.description}","amount": f"-{amount_str}"},
            {"location": "目标工资单", "description": f"返佣转移: {commission_adj.description}","amount": f"+{amount_str}"}
        ]
    
    def _transfer_special_adjustments(self, source_bill, source_payroll, target_bill, target_payroll):
        """
        查找、转移并删除特殊的系统生成调整项。
        【修正】此函数现在只处理客户账单的公司代付工资。
        """
        # 查找并转移“公司代付工资”
        company_paid_adj = FinancialAdjustment.query.filter_by(
            customer_bill_id=source_bill.id,
            adjustment_type=AdjustmentType.COMPANY_PAID_SALARY
        ).first()
        if company_paid_adj:
            # self._create_adjustment(
            #     customer_bill_id=target_bill.id,
            #     contract_id=target_bill.contract_id,
            #     adj_type=company_paid_adj.adjustment_type,
            #     amount=company_paid_adj.amount,
            #     description=f"从原账单转移: {company_paid_adj.description}",
            #     date_=target_bill.cycle_start_date.date(),
            #     details={"linked_bill_id": str(source_bill.id)}
            # )
            db.session.delete(company_paid_adj)

    def _delete_deposit_paid_salary_adjustment(self, source_payroll):
        """
        删除源工资单中的“保证金支付工资”调整项。
        """
        deposit_paid_adj = FinancialAdjustment.query.filter_by(
            employee_payroll_id=source_payroll.id,
            adjustment_type=AdjustmentType.DEPOSIT_PAID_SALARY
        ).first()
        if deposit_paid_adj:
            db.session.delete(deposit_paid_adj)