from datetime import datetime
from decimal import Decimal
from flask import current_app
from backend.models import db, BankTransaction, BankTransactionStatus, CustomerBill, PaymentRecord, PayoutRecord, PaymentStatus, User, BaseContract,PayerAlias,PayeeAlias,FinancialActivityLog,TransactionDirection, ServicePersonnel, EmployeePayroll, FinancialAdjustment, PayoutStatus, AdjustmentType, PermanentIgnoreList
from sqlalchemy import or_, func
import traceback
import decimal
D = decimal.Decimal
from backend.services.billing_engine import _update_payroll_payout_status, _update_bill_payment_status
from backend.api.utils import get_billing_details_internal, _log_activity

class BankStatementService:
    """
    处理银行对账单的解析、存储和匹配服务。
    """
    def get_payable_details(self, item_id: str, item_type: str) -> dict | None:
        """Gets the full billing details for a given payable item."""
        bill_id = None
        if item_type == 'EmployeePayroll':
            payroll = db.session.get(EmployeePayroll, item_id)
            if payroll:
                # Find the corresponding customer bill
                customer_bill = CustomerBill.query.filter(
                    CustomerBill.contract_id == payroll.contract_id,
                    CustomerBill.cycle_start_date == payroll.cycle_start_date,
                    CustomerBill.is_substitute_bill == payroll.is_substitute_payroll
                ).first()
                if customer_bill:
                    bill_id = customer_bill.id
        elif item_type == 'FinancialAdjustment':
            adjustment = db.session.get(FinancialAdjustment, item_id)
            if adjustment:
                if adjustment.customer_bill_id:
                    bill_id = adjustment.customer_bill_id
                elif adjustment.employee_payroll_id:
                    payroll = db.session.get(EmployeePayroll, adjustment.employee_payroll_id)
                    if payroll:
                        customer_bill = CustomerBill.query.filter(
                            CustomerBill.contract_id == payroll.contract_id,
                            CustomerBill.cycle_start_date == payroll.cycle_start_date,
                            CustomerBill.is_substitute_bill == payroll.is_substitute_payroll
                        ).first()
                        if customer_bill:
                            bill_id = customer_bill.id

        if bill_id:
            return get_billing_details_internal(bill_id=str(bill_id))
        
        return None
    def serialize_transaction(self, txn: BankTransaction) -> dict:
        """
        Serializes a BankTransaction object into a dictionary, including the polymorphic associated object.
        """
        base_data = {
            'id': str(txn.id),
            'transaction_id': txn.transaction_id,
            'transaction_time': txn.transaction_time.isoformat(),
            'payer_name': txn.payer_name,
            'amount': str(txn.amount),
            'summary': txn.summary,
            'status': txn.status.value,
            'direction': txn.direction.value,
            'allocated_amount': str(txn.allocated_amount),
            'ignore_remark': txn.ignore_remark,
            'updated_at': txn.updated_at.isoformat() if txn.updated_at else None, # <-- FIX: Add updated_at
            'associated_object': None # Default to None
        }

        if txn.associated_object_type and txn.associated_object_id:
            associated_object_data = None
            try:
                if txn.associated_object_type == 'Contract':
                    obj = db.session.get(BaseContract, txn.associated_object_id)
                    if obj:
                        associated_object_data = {
                            'type': 'Contract',
                            'id': str(obj.id),
                            'display_name': f"合同: {obj.customer_name}",
                            'link': f'/contracts/{obj.id}' # Example link
                        }
                elif txn.associated_object_type == 'User':
                    obj = db.session.get(User, txn.associated_object_id)
                    if obj:
                        associated_object_data = {
                            'type': 'User',
                            'id': str(obj.id),
                            'display_name': f"员工: {obj.username}",
                            'link': f'/users/{obj.id}' # Example link
                        }
                elif txn.associated_object_type == 'ServicePersonnel':
                    obj = db.session.get(ServicePersonnel, txn.associated_object_id)
                    if obj:
                        associated_object_data = {
                            'type': 'ServicePersonnel',
                            'id': str(obj.id),
                            'display_name': f"服务人员: {obj.name}",
                            'link': f'/service_personnel/{obj.id}' # Example link
                        }
                base_data['associated_object'] = associated_object_data
            except Exception as e:
                current_app.logger.error(f"Error fetching associated object for transaction {txn.id}: {e}")

        allocations = []
        if txn.status in [BankTransactionStatus.MATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            if txn.direction == TransactionDirection.CREDIT:
                for record in txn.payment_records:
                    bill = record.customer_bill
                    if bill and bill.contract:
                        allocations.append({
                            'type': 'CustomerBill',
                            'display_name': f"账单: {bill.contract.customer_name} - {bill.cycle}",
                            'total_due': str(bill.total_due),
                            'amount_remaining': str(bill.total_due - bill.total_paid),
                            'allocated_amount_from_this_txn': str(record.amount)
                        })
            elif txn.direction == TransactionDirection.DEBIT:
                # Correct logic for PayoutRecords (EmployeePayroll)
                payout_records = PayoutRecord.query.filter(
                    PayoutRecord.notes.like(f"%[银行流水分配: {txn.transaction_id}]%")
                ).all()
                for record in payout_records:
                    payroll = record.employee_payroll
                    if payroll:
                        employee = payroll.contract.service_personnel
                        employee_name = employee.name if hasattr(employee, 'name') else employee.username
                        allocations.append({
                            'type': 'EmployeePayroll',
                            'display_name': f"工资: {employee_name} ({payroll.year}-{payroll.month})",
                            'total_due': str(payroll.total_due),
                            'amount_remaining': str(payroll.total_due - payroll.total_paid_out),
                            'allocated_amount_from_this_txn': str(record.amount)
                        })

                # Correct, restored logic for FinancialAdjustments (refunds)
                adjustments = FinancialAdjustment.query.filter(
                    FinancialAdjustment.settlement_details.op('->')('payments').op('@>')(f'[{{\"bank_transaction_id\": \"{txn.transaction_id}\"}}]')
                ).all()
                for adj in adjustments:
                    payment_info = next((p for p in adj.settlement_details['payments'] if p['bank_transaction_id'] == txn.transaction_id), None)
                    if payment_info:
                        allocations.append({
                            'type': 'FinancialAdjustment',
                            'display_name': f"退款: {adj.description}",
                            'total_due': str(adj.amount),
                            'amount_remaining': "0.00",  # Refunds are settled in full
                            'allocated_amount_from_this_txn': str(payment_info.get('amount'))
                        })

        base_data['allocations'] = allocations

        return base_data

    def get_payable_items(self, year: int, month: int) -> dict:
        """
        获取指定年月的所有待支付项目。
        """
        payable_items = {
            'payrolls': [],
            'adjustments': []
        }

        # 查询指定年月未支付或部分支付的工资单
        unpaid_payrolls = EmployeePayroll.query.filter(
            EmployeePayroll.year == year,
            EmployeePayroll.month == month,
            EmployeePayroll.payout_status.in_([PayoutStatus.UNPAID, PayoutStatus.PARTIALLY_PAID])
        ).order_by(EmployeePayroll.cycle_start_date.desc()).all()

        for payroll in unpaid_payrolls:
            payable_items['payrolls'].append({
                'target_id': str(payroll.id),
                'target_type': 'EmployeePayroll',
                'display_name': f"工资单: {payroll.contract.customer_name} - {payroll.year}/{payroll.month}",
                'amount_due': str(payroll.total_due - payroll.total_paid_out),
                'date': payroll.cycle_end_date.isoformat(),
                'contract_id': str(payroll.contract_id) # <-- FIX: Add contract_id
            })

        # 查询指定年月待退款的财务调整项
        pending_refunds = FinancialAdjustment.query.filter(
            db.extract('year', FinancialAdjustment.date) == year,
            db.extract('month', FinancialAdjustment.date) == month,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.is_settled == False
        ).order_by(FinancialAdjustment.date.desc()).all()

        for refund in pending_refunds:
            payable_items['adjustments'].append({
                'target_id': str(refund.id),
                'target_type': 'FinancialAdjustment',
                'display_name': f"退款: {refund.description}",
                'amount_due': str(refund.amount),
                'date': refund.date.isoformat(),
                'contract_id': str(refund.contract_id) if refund.contract_id else None # <-- FIX: Add contract_id
            })

        return payable_items

    def allocate_outbound_transaction(self, bank_transaction_id: str, allocations: list, operator_id: str) -> dict:
        bank_txn = BankTransaction.query.get(bank_transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.direction != TransactionDirection.DEBIT:
            return {"error": "This method is for debit transactions only."}

        if bank_txn.status not in [BankTransactionStatus.UNMATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be allocated."}

        total_allocation_amount = sum(Decimal(alloc['amount']) for alloc in allocations if Decimal(alloc.get('amount')or 0) > 0)

        if total_allocation_amount > (bank_txn.amount - bank_txn.allocated_amount):
            return {"error": "Total allocated amount exceeds transaction's remaining amount."}

        try:
            user = User.query.get(operator_id)
            if not user:
                raise Exception(f"Operator with id {operator_id} not found.")

            is_first_allocation = (bank_txn.status == BankTransactionStatus.UNMATCHED)

            for i, alloc in enumerate(allocations):
                target_type = alloc['target_type']
                target_id = alloc['target_id']
                amount_to_allocate = Decimal(alloc.get('amount') or 0)

                if amount_to_allocate <= 0:
                    continue

                target_contract_id = None

                if target_type == 'EmployeePayroll':
                    target_obj = EmployeePayroll.query.get(target_id)
                    if not target_obj:
                        raise Exception(f"EmployeePayroll with id {target_id} not found.")
                    
                    # Create a PayoutRecord to log this payment event
                    payout_record = PayoutRecord(
                        employee_payroll_id=target_obj.id,
                        amount=amount_to_allocate,
                        payout_date=bank_txn.transaction_time.date(),
                        method="银行转账",
                        notes=f"[银行流水分配: {bank_txn.transaction_id}] {bank_txn.summary or ''}".strip(),
                        payer="公司代付",
                        created_by_user_id=operator_id
                    )
                    db.session.add(payout_record)

                    # Update the total paid amount and status on the payroll
                    target_obj.total_paid_out += amount_to_allocate
                    if target_obj.total_paid_out >= target_obj.total_due:
                        target_obj.payout_status = PayoutStatus.PAID
                    else:
                        target_obj.payout_status = PayoutStatus.PARTIALLY_PAID
                    
                    target_contract_id = target_obj.contract_id

                elif target_type == 'FinancialAdjustment':
                    target_obj = FinancialAdjustment.query.get(target_id)
                    if not target_obj:
                        raise Exception(f"FinancialAdjustment with id {target_id} not found.")
                    target_obj.is_settled = True
                    target_obj.settlement_date = bank_txn.transaction_time.date()
                    target_obj.status = 'PAID'
                    target_contract_id = target_obj.contract_id

                    # Store transaction info in settlement_details JSON field
                    if not target_obj.settlement_details:
                        target_obj.settlement_details = {}
                    if 'payments' not in target_obj.settlement_details:
                        target_obj.settlement_details['payments'] = []
                    target_obj.settlement_details['payments'].append({
                        'bank_transaction_id': bank_txn.transaction_id,
                        'amount': str(amount_to_allocate),
                        'paid_at': bank_txn.transaction_time.isoformat()
                    })
                else:
                    raise Exception(f"Unsupported target type: {target_type}")

                # 在首次分配的第一个项目上，设置多态关联和支付别名
                if i == 0:
                    bank_txn.associated_object_type = target_type
                    bank_txn.associated_object_id = target_id

                    if is_first_allocation and target_contract_id:
                        # 尝试创建别名，如果已存在则忽略
                        existing_alias = PayerAlias.query.filter_by(payer_name=bank_txn.payer_name).first()
                        if not existing_alias:
                            try:
                                new_alias = PayerAlias(
                                    payer_name=bank_txn.payer_name,
                                    contract_id=target_contract_id,
                                    created_by_user_id=operator_id
                                )
                                db.session.add(new_alias)
                            except Exception as alias_e:
                                print(f"Could not create alias, possibly already exists. Error: {alias_e}")


            # 更新银行流水状态
            bank_txn.allocated_amount += total_allocation_amount
            if bank_txn.allocated_amount >= bank_txn.amount:
                bank_txn.status = BankTransactionStatus.MATCHED
            else:
                bank_txn.status = BankTransactionStatus.PARTIALLY_ALLOCATED

            db.session.commit()
            return {"success": True, "message": "Outbound allocation successful."}

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Outbound allocation failed for txn {bank_transaction_id}: {e}", exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}
        
    def _find_oldest_payable_item_for_payee(self, payee_info: dict) -> dict | None:
        """
        为指定的收款人查找最老的一笔未结清款项（工资单或退款）。
        """
        if not payee_info or 'type' not in payee_info or 'id' not in payee_info:
            return None

        payee_type = payee_info['type']
        payee_id = payee_info['id']
        
        oldest_payroll = None
        oldest_refund = None

        # 根据收款人类型查找关联合同
        contract_ids = []
        if payee_type == 'user':
            # 查找与该用户关联的服务人员
            service_personnel = ServicePersonnel.query.filter_by(user_id=payee_id).first()
            if service_personnel:
                contracts = BaseContract.query.filter_by(service_personnel_id=service_personnel. id).all()
                contract_ids = [c.id for c in contracts]
        elif payee_type == 'service_personnel':
            contracts = BaseContract.query.filter_by(service_personnel_id=payee_id).all()
            contract_ids = [c.id for c in contracts]
        elif payee_type == 'customer':
            # 注意：客户可能由姓名标识，而不是ID
            contracts = BaseContract.query.filter_by(customer_name=payee_id).all()
            contract_ids = [c.id for c in contracts]

        if not contract_ids:
            return None

        # 查找最老的未付工资单
        oldest_payroll = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id.in_(contract_ids),
            EmployeePayroll.payout_status.in_([PayoutStatus.UNPAID, PayoutStatus.PARTIALLY_PAID])
        ).order_by(EmployeePayroll.cycle_start_date.asc()).first()

        # 查找最老的未付退款
        oldest_refund = FinancialAdjustment.query.filter(
            FinancialAdjustment.contract_id.in_(contract_ids),
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.is_settled == False
        ).order_by(FinancialAdjustment.date.asc()).first()

        # 比较哪个更老
        oldest_item = None
        if oldest_payroll and oldest_refund:
            if oldest_payroll.cycle_start_date <= oldest_refund.date:
                oldest_item = oldest_payroll
            else:
                oldest_item = oldest_refund
        elif oldest_payroll:
            oldest_item = oldest_payroll
        elif oldest_refund:
            oldest_item = oldest_refund
        
        if not oldest_item:
            return None

        # 格式化返回
        if isinstance(oldest_item, EmployeePayroll):
            employee = oldest_item.contract.service_personnel
            employee_name = employee.name if hasattr(employee, 'name') else employee.username
            return {
                'target_id': str(oldest_item.id),
                'target_type': 'EmployeePayroll',
                'display_name': f"工资单: {employee_name} - {oldest_item.year}/{oldest_item.month}",
                'amount_due': str(oldest_item.total_due - oldest_item.total_paid_out),
                'date': oldest_item.cycle_end_date.isoformat(),
                'is_cross_month_suggestion': True
            }
        elif isinstance(oldest_item, FinancialAdjustment):
            return {
                'target_id': str(oldest_item.id),
                'target_type': 'FinancialAdjustment',
                'display_name': f"退款: {oldest_item.description}",
                'amount_due': str(oldest_item.amount),
                'date': oldest_item.date.isoformat(),
                'is_cross_month_suggestion': True
            }
        
        return None

    def get_and_categorize_outbound_transactions(self, year: int, month: int) -> dict:
        base_query = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.DEBIT,
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        )

        txns_to_process = base_query.filter(BankTransaction.status.in_([
            BankTransactionStatus.UNMATCHED,
            BankTransactionStatus.PARTIALLY_ALLOCATED
        ])).order_by(BankTransaction.payer_name).all()

        confirmed_txns = base_query.filter(BankTransaction.status.in_([
            BankTransactionStatus.MATCHED,
            BankTransactionStatus.PARTIALLY_ALLOCATED
        ])).all()
        ignored_txns = base_query.filter(BankTransaction.status == BankTransactionStatus.IGNORED).all()

        categorized_results = {
            "pending_confirmation": [],
            "manual_allocation": [],
            "unmatched": [],
            "confirmed": [self.serialize_transaction(txn) for txn in confirmed_txns],
            "processed": [], # Placeholder, logic can be added if needed
            "ignored": [self.serialize_transaction(txn) for txn in ignored_txns]
        }

        payable_items_this_month = self.get_payable_items(year, month)
        all_payables = payable_items_this_month['payrolls'] + payable_items_this_month['adjustments']

        for txn in txns_to_process:
            payee_found = False
            payee_info = {}
            matched_by = 'name'
            payer_name_lower = func.lower(txn.payer_name)

            # 1. 身份识别 (不区分大小写)
            # Step 1: Check the CORRECT alias table for outbound payments
            payee_alias = PayeeAlias.query.filter(func.lower(PayeeAlias.alias_name) == payer_name_lower).first()
            if payee_alias:
                payee_found = True
                matched_by = 'alias'
                if payee_alias.target_user:
                    payee_info = {'id': str(payee_alias.target_user_id), 'type': 'user', 'name': payee_alias.target_user.username}
                elif payee_alias.target_service_personnel:
                    payee_info = {'id': str(payee_alias.target_service_personnel_id), 'type': 'service_personnel', 'name': payee_alias.target_service_personnel.name}
            
            # Step 2: Fallback to direct name matching if no alias found
            if not payee_found:
                user = User.query.filter(func.lower(User.username) == payer_name_lower).first()
                if user:
                    payee_found = True
                    payee_info = {'id': str(user.id), 'type': 'user', 'name': user.username}
                else:
                    sp = ServicePersonnel.query.filter(func.lower(ServicePersonnel.name) == payer_name_lower).first()
                    if sp:
                        payee_found = True
                        payee_info = {'id': str(sp.id), 'type': 'service_personnel', 'name': sp.name}

            if not payee_found:
                # Step 3: Fallback to customer name for refunds
                customer_contract = BaseContract.query.filter(func.lower(BaseContract.customer_name) == payer_name_lower).first()
                if customer_contract:
                    payee_found = True
                    payee_info = {'id': customer_contract.customer_name, 'type': 'customer', 'name': customer_contract.customer_name}

            # 2. 分类
            if not payee_found:
                categorized_results["unmatched"].append(self.serialize_transaction(txn))
                continue

            # 如果找到了收款人，检查是否有精确匹配的待付款项
            matching_payables = [p for p in all_payables if D(p['amount_due']) == txn.amount and payee_info['name'] in p['display_name']]
            
            if len(matching_payables) == 1 and txn.status == BankTransactionStatus.UNMATCHED:
                categorized_results["pending_confirmation"].append({
                    **self.serialize_transaction(txn),
                    "matched_item": matching_payables[0],
                    "matched_by": matched_by,
                    "payee_info": payee_info
                })
            else:
                # 如果在当月找不到精确匹配的，则为该收款人查找最老的一笔欠款作为建议
                oldest_payable_suggestion = None
                if len(matching_payables) == 0:
                    oldest_payable_suggestion = self._find_oldest_payable_item_for_payee(payee_info)

                categorized_results["manual_allocation"].append({
                    **self.serialize_transaction(txn),
                    "matched_by": matched_by,
                    "payee_info": payee_info,
                    "oldest_payable_suggestion": oldest_payable_suggestion
                })

        return categorized_results

    
    


    def search_payable_items(self, search_term: str) -> dict:
        print(f"--- DEBUG: Starting search_payable_items with term: '{search_term}' ---")
        results = []
        pinyin_search_term = search_term.replace(" ", "")
        print(f"--- DEBUG: Pinyin search term: '{pinyin_search_term}' ---")

        matching_contract_ids = set()

        # 1. 根据客户姓名或拼音查找合同
        contracts_by_customer = BaseContract.query.filter(
            or_(
                BaseContract.customer_name.ilike(f"%{search_term}%"),
                BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%")
            )
        ).all()
        customer_contract_ids = {c.id for c in contracts_by_customer}
        print(f"--- DEBUG: Found {len(customer_contract_ids)} contracts by customer name: {customer_contract_ids} ---")
        matching_contract_ids.update(customer_contract_ids)

        # 2. 根据员工姓名或拼音查找关联的合同
        matching_sp_ids = [sp.id for sp in ServicePersonnel.query.filter (or_(ServicePersonnel.name.ilike(f"%{search_term}%"), ServicePersonnel.name_pinyin.ilike(f"% {pinyin_search_term}%"))).all()]
        print(f"--- DEBUG: Found {len(matching_sp_ids)} matching service personnel IDs: {matching_sp_ids} ---")

        if matching_sp_ids:
            contracts_by_employee = BaseContract.query.filter(
                BaseContract.service_personnel_id.in_(matching_sp_ids)
            ).all()
            employee_contract_ids = {c.id for c in contracts_by_employee}
            print(f"--- DEBUG: Found {len(employee_contract_ids)} contracts via employees: {employee_contract_ids} ---")
            matching_contract_ids.update(employee_contract_ids)

        print(f"--- DEBUG: Final combined set of {len(matching_contract_ids)} contract IDs: {matching_contract_ids} ---")

        if not matching_contract_ids:
            print("--- DEBUG: No matching contract IDs found, returning empty results. ---")
            return {'results': []}

        # 3. 根据收集到的合同ID，查找待支付项
        final_contract_id_list = list(matching_contract_ids)

        # 查找待付工资单
        payrolls = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id.in_(final_contract_id_list),
            EmployeePayroll.payout_status.in_([PayoutStatus.UNPAID, PayoutStatus.PARTIALLY_PAID])
        ).limit(10).all()
        print(f"--- DEBUG: Found {len(payrolls)} matching unpaid payrolls. ---")

        for payroll in payrolls:
            employee = payroll.contract.service_personnel
            if employee:
                employee_name = employee.name if employee else "未知员工"
                results.append({
                    'type': 'EmployeePayroll',
                    'id': str(payroll.id),
                    'display': f"工资单: {employee_name} (客户: {payroll.contract.customer_name} )",
                    'name': employee_name,
                    'amount_due': str(payroll.total_due - payroll.total_paid_out)
                })

        # 查找待退款
        refunds = FinancialAdjustment.query.filter(
            FinancialAdjustment.contract_id.in_(final_contract_id_list),
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.is_settled == False
        ).limit(10).all()
        print(f"--- DEBUG: Found {len(refunds)} matching pending refunds. ---")

        for refund in refunds:
            if refund.contract:
                results.append({
                    'type': 'FinancialAdjustment',
                    'id': str(refund.id),
                    'display': f"退款: {refund.contract.customer_name} - {refund.description}",
                    'name': refund.contract.customer_name,
                    'amount_due': str(refund.amount)
                })

        print(f"--- DEBUG: Returning a total of {len(results)} items. ---")
        return {'results': results}

    def _format_payable_item(self, item, bank_transaction_id=None):
        paid_by_this_txn = D('0')
        if bank_transaction_id:
            if isinstance(item, EmployeePayroll):
                payout_record = PayoutRecord.query.filter(
                    PayoutRecord.employee_payroll_id == item.id,
                    PayoutRecord.notes.like(f"%[银行流水分配: {bank_transaction_id}]%")
                ).first()
                if payout_record:
                    paid_by_this_txn = payout_record.amount
            elif isinstance(item, FinancialAdjustment):
                # Assuming similar logic for adjustments if they can be partially paid by a txn
                pass

        if isinstance(item, EmployeePayroll):
            employee = item.contract.service_personnel
            employee_name = employee.name if employee else "未知员工"
            return {
                'id': str(item.id),
                'target_id': str(item.id),
                'target_type': 'EmployeePayroll',
                'display_name': f"工资: {employee_name} ({item.year}-{item.month})",
                'cycle': f"{item.cycle_start_date.strftime('%Y-%m-%d')} to {item.cycle_end_date.strftime('%Y-%m-%d')}",
                'year': item.year,
                'month': item.month,
                'total_due': str(item.total_due),
                'total_paid': str(item.total_paid_out),
                'amount_remaining': str(item.total_due - item.total_paid_out),
                'contract_id': str(item.contract_id),
                'paid_by_this_txn': str(paid_by_this_txn)
            }
        elif isinstance(item, FinancialAdjustment):
            return {
                'id': str(item.id),
                'target_id': str(item.id),
                'target_type': 'FinancialAdjustment',
                'display_name': f"退款: {item.description}",
                'cycle': item.date.strftime('%Y-%m-%d'),
                'year': item.date.year,
                'month': item.date.month,
                'total_due': str(item.amount),
                'total_paid': str(item.paid_amount) if item.is_settled and item.paid_amount else ('0.00'),
                'amount_remaining': '0.00' if item.is_settled else str(item.amount),
                'contract_id': str(item.contract_id),
                'paid_by_this_txn': str(paid_by_this_txn)
            }
        return None

    def get_payable_items_for_payee(self, payee_type: str, payee_id: str, year: int, month: int, bank_transaction_id: str = None) -> dict:
        current_app.logger.info(f"[DEBUG] Entering get_payable_items_for_payee for {payee_type}:{payee_id} @ {year}-{month}")

        contract_ids = []
        if payee_type == 'user':
            # 查找与该用户关联的服务人员
            service_personnel = ServicePersonnel.query.filter_by(user_id=payee_id).first()
            if service_personnel:
                contracts = BaseContract.query.filter_by(service_personnel_id=service_personnel. id).all()
                contract_ids = [c.id for c in contracts]
        elif payee_type == 'service_personnel':
            contracts = BaseContract.query.filter_by(service_personnel_id=payee_id).all()
            contract_ids = [c.id for c in contracts]
        elif payee_type == 'customer':
            contracts = BaseContract.query.filter_by(customer_name=payee_id).all()
            contract_ids = [c.id for c in contracts]

        if not contract_ids:
            return {"items": [], "closest_item_period": None, "relevant_contract_id": None}

        # 1. Find items for the current month
        payrolls = EmployeePayroll.query.filter(
            EmployeePayroll.contract_id.in_(contract_ids),
            EmployeePayroll.year == year,
            EmployeePayroll.month == month,
        ).all()

        refunds = FinancialAdjustment.query.filter(
            FinancialAdjustment.contract_id.in_(contract_ids),
            db.extract('year', FinancialAdjustment.date) == year,
            db.extract('month', FinancialAdjustment.date) == month,
            FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
            FinancialAdjustment.is_settled == False
        ).all()

        items_in_month = payrolls + refunds

        # 2. If items found, format and return them
        if items_in_month:
            formatted_items = [self._format_payable_item(item, bank_transaction_id) for item in items_in_month if self._format_payable_item(item) is not None]
            return {"items": formatted_items, "closest_item_period": None, "relevant_contract_id": None}

        # 3. If no items in month, find closest item or relevant contract
        else:
            all_payrolls = EmployeePayroll.query.filter(
                EmployeePayroll.contract_id.in_(contract_ids),
                EmployeePayroll.payout_status.in_([PayoutStatus.UNPAID, PayoutStatus.PARTIALLY_PAID])
            ).all()
            all_refunds = FinancialAdjustment.query.filter(
                FinancialAdjustment.contract_id.in_(contract_ids),
                FinancialAdjustment.adjustment_type == AdjustmentType.CUSTOMER_DECREASE,
                FinancialAdjustment.is_settled == False
            ).all()

            all_unpaid_items = all_payrolls + all_refunds

            if all_unpaid_items:
                target_date = datetime(year, month, 1)
                closest_item = min(all_unpaid_items, key=lambda x: abs(((x.year if hasattr(x, 'year') else x.date.year) - target_date.year) * 12 + ((x.month if hasattr(x, 'month') else x.date.month) - target_date.month)))
                
                closest_period = {
                    'year': closest_item.year if hasattr(closest_item, 'year') else closest_item.date.year,
                    'month': closest_item.month if hasattr(closest_item, 'month') else closest_item.date.month
                }
                return {"items": [], "closest_item_period": closest_period, "relevant_contract_id": None}
            
            # 4. If no unpaid items at all, find the latest contract
            else:
                latest_contract = BaseContract.query.filter(BaseContract.id.in_(contract_ids)).order_by(BaseContract.created_at.desc()).first()
                return {"items": [], "closest_item_period": None, "relevant_contract_id": str(latest_contract.id) if latest_contract else None}

    def get_and_categorize_transactions(self, year: int, month: int) -> dict:
        """
        获取指定年月的银行流水，并将其分为四类。
        【V4 修正版】正确处理一个付款人拥有多个合同的情况。
        """
        txns_to_process = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.CREDIT,
            BankTransaction.status.in_([
                BankTransactionStatus.UNMATCHED, 
                BankTransactionStatus.PARTIALLY_ALLOCATED
            ]),
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        ).order_by(BankTransaction.payer_name.asc()).all()

        confirmed_txns = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.CREDIT,
            BankTransaction.status.in_([
                BankTransactionStatus.MATCHED,
                BankTransactionStatus.PARTIALLY_ALLOCATED
            ]),
            BankTransaction.allocated_amount > 0,
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        ).order_by(BankTransaction.transaction_time.desc()).all()

        ignored_txns = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.CREDIT,
            BankTransaction.status == BankTransactionStatus.IGNORED,
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        ).order_by(BankTransaction.transaction_time.desc()).all()

        ignored_txns = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.CREDIT,
            BankTransaction.status == BankTransactionStatus.IGNORED,
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        ).order_by(BankTransaction.transaction_time.desc()).all()

        categorized_results = {
            "pending_confirmation": [],
            "manual_allocation": [],
            "unmatched": [],
            "confirmed": [],
            "ignored": []
        }

        for txn in confirmed_txns:
            payment_records = txn.payment_records.all()
            allocated_to_bills = []
            for pr in payment_records:
                if pr.customer_bill:
                    bill_info = self._format_bill(pr.customer_bill, txn.id)
                    bill_info['allocated_amount_from_this_txn'] = str(pr.amount)
                    allocated_to_bills.append(bill_info)
            
            if allocated_to_bills:
                categorized_results["confirmed"].append({
                    **self._format_txn(txn),
                    "allocated_to_bills": allocated_to_bills
                })

        for txn in txns_to_process:
            if txn.status == BankTransactionStatus.PARTIALLY_ALLOCATED:
                contract = self._find_contract_for_txn(txn)
                unpaid_bills = []
                customer_name = None
                if contract:
                    customer_name = contract.customer_name
                    unpaid_bills = CustomerBill.query.filter(
                        CustomerBill.contract_id == contract.id,
                        CustomerBill.total_due > CustomerBill.total_paid,
                    ).all()
                
                # 判断是否为代付
                matched_by = 'name'
                if customer_name and txn.payer_name != customer_name:
                    matched_by = 'alias'

                categorized_results["manual_allocation"].append({
                    **self._format_txn(txn),
                    "unpaid_bills": [self._format_bill(b, txn.id) for b in unpaid_bills],
                    "customer_name": customer_name,
                    "matched_by": matched_by
                })
                continue

            # --- NEW LOGIC for UNMATCHED transactions (V2) ---
            # 一个付款人可能对应多个客户（合同），所以必须查找所有可能性
            aliases = PayerAlias.query.filter_by(payer_name=txn.payer_name).all()
            
            # 收集所有可能的合同
            contracts = []
            matched_by = None # 'alias', 'name', or None
            
            if aliases:
                matched_by = 'alias'
                contract_ids = {alias.contract_id for alias in aliases}
                found_contracts = BaseContract.query.filter(BaseContract.id.in_(contract_ids)).all()
                contracts.extend(found_contracts)
            else:
                # 如果没有别名，回退到按客户名称直接匹配
                found_contracts = BaseContract.query.filter_by(customer_name=txn.payer_name).all()
                if found_contracts:
                    matched_by = 'name'
                    contracts.extend(found_contracts)

            if not contracts:
                categorized_results["unmatched"].append(self._format_txn(txn))
                continue

            contract_ids = [c.id for c in contracts]
            
            unpaid_bills = CustomerBill.query.filter(
                CustomerBill.contract_id.in_(contract_ids),
                CustomerBill.total_due > CustomerBill.total_paid,
                or_(
                    CustomerBill.payment_status == PaymentStatus.UNPAID,
                    CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
                )
            ).all()

            if len(unpaid_bills) == 1:
                categorized_results["pending_confirmation"].append({
                    **self._format_txn(txn),
                    "matched_bill": self._format_bill(unpaid_bills[0], txn.id),
                    "matched_by": matched_by
                })
            else: # Covers len(unpaid_bills) == 0 and len(unpaid_bills) > 1
                # 只要能识别出合同，就说明客户是已知的
                customer_name = contracts[0].customer_name
                categorized_results["manual_allocation"].append({
                    **self._format_txn(txn),
                    "unpaid_bills": [self._format_bill(b, txn.id) for b in unpaid_bills],
                    "customer_name": customer_name,  # 明确附加客户名称
                    "matched_by": matched_by # 附加匹配方式
                })

        for txn in ignored_txns:
            categorized_results["ignored"].append(self._format_txn(txn))

        return categorized_results
    def delete_payment_record_and_reverse_allocation(self, payment_record_id: str, operator_id: str) -> dict:
        """
        删除单个支付记录并反转相关的分配。
        这是一个事务性操作，确保数据一致性。
        """
        payment_record = PaymentRecord.query.get(payment_record_id)
        if not payment_record:
            return {"error": "Payment record not found"}

        try:
            user = User.query.get(operator_id)
            if not user:
                raise Exception(f"Operator with id {operator_id} not found.")

            bill = payment_record.customer_bill
            bank_txn = payment_record.bank_transaction
            amount_to_revert = payment_record.amount

            # 1. 回滚客户账单 (CustomerBill)
            if bill:
                bill.total_paid -= amount_to_revert
                if bill.total_paid <= 0:
                    bill.payment_status = PaymentStatus.UNPAID
                    bill.total_paid = Decimal('0') # 避免负数
                else:
                    bill.payment_status = PaymentStatus.PARTIALLY_PAID

            # 2. 回滚银行流水 (BankTransaction)
            if bank_txn:
                bank_txn.allocated_amount -= amount_to_revert
                if bank_txn.allocated_amount <= 0:
                    bank_txn.status = BankTransactionStatus.UNMATCHED
                    bank_txn.allocated_amount = Decimal('0') # 避免负数
                else:
                    bank_txn.status = BankTransactionStatus.PARTIALLY_ALLOCATED

            # 3. 记录财务活动日志
            log_entry = FinancialActivityLog(
                customer_bill_id=bill.id if bill else None,
                contract_id=bill.contract_id if bill else None,
                user_id=operator_id,
                action="删除收款记录",
                details={
                    "message": f"操作员 {user.username} 删除了对账单 {bill.id if bill else 'N/A'} 的一笔金额为 {amount_to_revert} 的收款记录。",
                    "payment_record_id": str(payment_record.id),
                    "reverted_from_bank_transaction_id": str(bank_txn.id) if bank_txn else None
                }
            )
            db.session.add(log_entry)

            # 4. 删除支付记录 (PaymentRecord)
            db.session.delete(payment_record)

            db.session.commit()
            return {"success": True, "message": "Payment record deleted and allocation reversed successfully."}

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Failed to delete payment record {payment_record_id}: {e}", exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}

    def cancel_allocation(self, bank_transaction_id: str, operator_id: str) -> dict:
        """
        撤销一笔银行流水的全部分配。
        这是一个事务性操作，现在同时支持 CREDIT 和 DEBIT 流水。
        """
        bank_txn = BankTransaction.query.get(bank_transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.status not in [BankTransactionStatus.MATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            return {"error": "Transaction is not in a matched state, cannot cancel."}

        try:
            user = User.query.get(operator_id)
            if not user:
                raise Exception(f"Operator with id {operator_id} not found.")

            if bank_txn.direction == TransactionDirection.CREDIT:
                # --- Logic for INBOUND payments (Credit) ---
                payments_to_delete = bank_txn.payment_records.all()
                for payment in payments_to_delete:
                    bill = payment.customer_bill
                    if bill:
                        bill.total_paid -= payment.amount
                        _update_bill_payment_status(bill)
                    
                    FinancialActivityLog.query.filter(
                        FinancialActivityLog.details.op('->>')('payment_record_id') == str(payment.id)
                    ).delete(synchronize_session=False)
                    db.session.delete(payment)

            elif bank_txn.direction == TransactionDirection.DEBIT:
                # --- NEW Logic for OUTBOUND payments (Debit) ---
                payouts_to_delete = PayoutRecord.query.filter(
                    PayoutRecord.notes.like(f"%[银行流水分配: {bank_txn.transaction_id}]%")
                ).all()

                for payout in payouts_to_delete:
                    payroll = payout.employee_payroll
                    if payroll:
                        payroll.total_paid_out -= payout.amount
                        _update_payroll_payout_status(payroll)
                    
                    # Also delete associated FinancialActivityLog if any
                    FinancialActivityLog.query.filter(
                        FinancialActivityLog.details.op('->>')('payout_record_id') == str(payout.id)
                    ).delete(synchronize_session=False)
                    db.session.delete(payout)

            # Reset the bank transaction status
            bank_txn.allocated_amount = Decimal('0')
            bank_txn.status = BankTransactionStatus.UNMATCHED
            bank_txn.associated_object_id = None
            bank_txn.associated_object_type = None

            _log_activity(None, None, "撤销了流水分配", details={
                "message": f"操作员 {user.username} 撤销了对银行流水 {bank_txn.transaction_id} 的所有分配。"
            }, contract=None) # We might not have a single contract context here

            db.session.commit()
            return {"success": True, "message": "Allocation cancelled successfully."}

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Cancellation failed for txn {bank_transaction_id}: {e}", exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}

    # --- Helper methods to format output ---
    def _format_txn(self, txn: BankTransaction) -> dict:
        return {
            "id": str(txn.id),
            "transaction_id": txn.transaction_id, 
            "transaction_time": txn.transaction_time.isoformat(),
            "amount": str(txn.amount),
            "allocated_amount": str(txn.allocated_amount),
            "payer_name": txn.payer_name,
            "summary": txn.summary,
            "status": txn.status.value,
            "updated_at": txn.updated_at.isoformat() if txn.updated_at else None,
            "ignore_remark": txn.ignore_remark,
        }
    
    def _find_contract_for_txn(self, txn: BankTransaction) -> BaseContract | None:
        """辅助函数：为一条流水找到关联合同"""
        # 优先通过别名精确查找
        alias = PayerAlias.query.filter_by(payer_name=txn.payer_name).first()
        if alias:
            contract = db.session.get(BaseContract, alias.contract_id)
            if contract:
                return contract
        
        # 如果是部分支付，通过支付记录反查
        if txn.status == BankTransactionStatus.PARTIALLY_ALLOCATED:
            first_payment = txn.payment_records.first()
            if first_payment and first_payment.customer_bill:
                return first_payment.customer_bill.contract
        
        # 最后按名字模糊匹配
        contract = BaseContract.query.filter_by(customer_name=txn.payer_name).first()
        return contract
    
    def _format_confirmed_txn(self, txn: BankTransaction) -> dict:
        """辅助函数：格式化已确认的流水"""
        payment_records = txn.payment_records.all()
        allocated_to_bills = []
        for pr in payment_records:
            if pr.customer_bill:
                bill_info = self._format_bill(pr.customer_bill, txn.id)
                # 我们之前在 _format_bill 中已经计算了 paid_by_this_txn
                # 但为了确保这里的金额是正确的，我们直接从支付记录里取
                bill_info['allocated_amount_from_this_txn'] = str(pr.amount)
                allocated_to_bills.append(bill_info)
        
        return {
            **self._format_txn(txn),
            "allocated_to_bills": allocated_to_bills
        }

    def _format_bill(self, bill: CustomerBill, bank_transaction_id: str = None) -> dict:
        """
        格式化账单信息，并可选地计算特定银行流水对该账单的已付金额。
        """
        paid_by_this_txn = D('0')
        if bank_transaction_id:
            # 查找所有与当前账单和当前银行流水都关联的支付记录
            payments = PaymentRecord.query.filter_by(
                customer_bill_id=bill.id,
                bank_transaction_id=bank_transaction_id
            ).all()
            if payments:
                paid_by_this_txn = sum(p.amount for p in payments)

        return {
            "id": str(bill.id),
            "contract_id": str(bill.contract_id),
            "customer_name": bill.contract.customer_name,
            "employee_name": bill.contract.service_personnel.name if bill.contract.service_personnel else "未知员工",
            "cycle": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} to {bill.cycle_end_date.strftime('%Y-%m-%d')}",
            "total_due": str(bill.total_due),
            "year": bill.year,
            "bill_month": bill.month,
            "total_paid": str(bill.total_paid),
            "amount_remaining": str(bill.total_due - bill.total_paid),
            "status": bill.payment_status.value,
            "paid_by_this_txn": str(paid_by_this_txn) # <--- 新增返回字段
        }

    def _parse_line(self, line: str) -> dict | None:
        """
        根据真实的银行流水格式解析单行文本。
        格式: 交易流水号\t...\t登记时间\t...\t交易金额\t...\t收(付)方名称\t摘要
        """
        parts = line.strip().split('\t')
        if len(parts) < 11: # 真实格式至少有11列
            current_app.logger.warning(f"Parse Warning: Line has only {len(parts)} parts, expected at least 11. Line: '{line}'")
            return None
        
        try:
            # 根据你提供的真实格式，提取我们需要的字段
            # 交易流水号: 第0列
            # 登记时间: 第2列
            # 交易金额: 第5列
            # 收(付)方名称: 第7列
            # 摘要: 第8列
            trans_id = parts[0].strip()
            time_str = parts[2].strip()
            transaction_method = parts[3].strip() # 交易方式在第3列，例如 "入账"
            amount_str = parts[5].strip()
            payer_name = parts[7].strip()
            summary = parts[8].strip()

            if not all([trans_id, time_str, amount_str, payer_name]):
                current_app.logger.warning(f"Parse Warning: Missing essential data in line. Line: '{line}'")
                return None

            transaction_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
            amount = Decimal(amount_str)
            direction = TransactionDirection.CREDIT if transaction_method == "入账" else TransactionDirection.DEBIT

            return {
                'transaction_id': trans_id,
                'transaction_time': transaction_time,
                'amount': amount,
                'payer_name': payer_name,
                'summary': summary,
                'direction': direction,
                'raw_text': line
            }
        except Exception as e:
            current_app.logger.error(f"FATAL PARSE ERROR on line: '{line}'")
            current_app.logger.error(f"Exception Type: {type(e).__name__}, Message: {e}")
            current_app.logger.error(traceback.format_exc())
            return None


    def parse_and_store_statement(self, statement_lines: list, operator_id: str):
        """
        解析银行对账单文本行数组，并将有效交易存入数据库。
        """
        current_app.logger.info(f"--- RECEIVED {len(statement_lines)} LINES ---")
        for i, line in enumerate(statement_lines):
            current_app.logger.info(f"Line {i}: {line}")
        current_app.logger.info("---------------------------------")
        if not statement_lines:
            return {'new_imports': 0, 'duplicates': 0, 'errors': 0, 'total_lines': 0}

        header = statement_lines[0]
        transactions = statement_lines[1:]
        
        new_imports = 0
        duplicates = 0
        errors = 0

        for line in transactions:
            if not line.strip():
                continue

            parsed_data = self._parse_line(line)
            if not parsed_data:
                errors += 1
                continue

            # 根据交易流水号检查是否重复
            existing_txn = BankTransaction.query.filter_by(transaction_id=parsed_data['transaction_id']).first()
            if existing_txn:
                duplicates += 1
                continue

            try:
                # 检查是否在永久忽略名单中
                ignore_rule = PermanentIgnoreList.query.filter_by(
                    payer_name=parsed_data['payer_name'],
                    direction=parsed_data['direction']
                ).first()

                status = BankTransactionStatus.UNMATCHED
                ignore_remark = None

                if ignore_rule:
                    status = BankTransactionStatus.IGNORED
                    ignore_remark = f"{ignore_rule.initial_remark or ''} (永久忽略)".strip()

                bank_txn = BankTransaction(
                    transaction_id=parsed_data['transaction_id'],
                    transaction_time=parsed_data['transaction_time'],
                    amount=parsed_data['amount'],
                    payer_name=parsed_data['payer_name'],
                    summary=parsed_data['summary'],
                    direction=parsed_data['direction'],
                    raw_text=parsed_data['raw_text'],
                    status=status,
                    ignore_remark=ignore_remark
                )
                db.session.add(bank_txn)
                new_imports += 1
            except Exception as e:
                errors += 1
                current_app.logger.error(f"Error creating BankTransaction object: {e}")

        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Database commit failed: {e}", exc_info=True)
            return {'new_imports': 0, 'duplicates': duplicates, 'errors': new_imports + errors, 'total_lines': len(transactions)}

        return {'new_imports': new_imports, 'duplicates': duplicates, 'errors': errors, 'total_lines': len(transactions)}


    def match_transactions(self, operator_id: str):
        """
        尝试将所有处于 UNMATCHED 状态的银行交易与客户账单进行匹配。

        :param operator_id: 执行此操作的用户的ID。
        """
        unmatched_txns = BankTransaction.query.filter_by(status=BankTransactionStatus.UNMATCHED).all()
        
        # 获取操作员用户，用于创建支付记录
        operator = User.query.get(operator_id)
        if not operator:
            print(f"Error: Operator with ID {operator_id} not found.")
            return

        for txn in unmatched_txns:
            # 1. 根据付款人姓名查找关联合同
            # 注意：这里的客户名称匹配可能需要更模糊的匹配逻辑
            contracts = BaseContract.query.filter(BaseContract.customer_name == txn.payer_name).all()
            if not contracts:
                txn.status = BankTransactionStatus.ERROR
                txn.summary = (txn.summary or "") + " [匹配错误：找不到同名客户的合同]"
                continue

            # 2. 查找这些合同下所有未付清的账单
            contract_ids = [c.id for c in contracts]
            bills_to_check = CustomerBill.query.filter(
                CustomerBill.contract_id.in_(contract_ids),
                CustomerBill.payment_status.in_([PaymentStatus.UNPAID, PaymentStatus.PARTIALLY_PAID])
            ).all()

            # 3. 根据金额进行精确匹配
            matching_bills = []
            for bill in bills_to_check:
                amount_due = bill.total_due - bill.total_paid
                if amount_due == txn.amount:
                    matching_bills.append(bill)

            # 4. 处理匹配结果
            if len(matching_bills) == 1:
                # 找到唯一匹配，创建支付记录
                bill = matching_bills[0]
                
                payment = PaymentRecord(
                    customer_bill_id=bill.id,
                    amount=txn.amount,
                    payment_date=txn.transaction_time.date(),
                    method="银行转账",  # 默认方式
                    notes=f"{txn.payer_name} 转账。流水号: {txn.transaction_id}",
                    created_by_user_id=operator.id
                )
                db.session.add(payment)

                # 更新账单状态
                bill.total_paid += txn.amount
                if bill.total_paid >= bill.total_due:
                    bill.payment_status = PaymentStatus.PAID
                else:
                    bill.payment_status = PaymentStatus.PARTIALLY_PAID

                # 更新银行流水状态
                txn.status = BankTransactionStatus.MATCHED
                txn.payment_record = payment
                print(f"Successfully matched transaction {txn.id} to bill {bill.id}")

            elif len(matching_bills) == 0:
                txn.status = BankTransactionStatus.ERROR
                txn.summary = (txn.summary or "") + f" [匹配错误：找不到金额为 {txn.amount} 的未付账单]"
            else:
                # 找到多个匹配项，需要人工处理
                txn.status = BankTransactionStatus.ERROR
                txn.summary = (txn.summary or "") + f" [匹配错误：找到多个金额为 {txn.amount} 的未付账单]"

        db.session.commit()
        print("Finished matching process.")

    def find_customer_and_unpaid_bills(self, bank_transaction_id: str, year: int, month: int) -> dict:
        """
        根据银行流水ID和指定的年月，查找关联的客户及该客户的未付清账单。
        """
        bank_txn = BankTransaction.query.get(bank_transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        payer_name = bank_txn.payer_name
        contracts = BaseContract.query.filter_by(customer_name=payer_name).all()

        if not contracts:
            return {"customer_found": False, "searched_payer_name": payer_name}

        contract_ids = [c.id for c in contracts]
        
        # --- 在查询中加入 year 和 month 的过滤条件 ---
        query = CustomerBill.query.filter(
            CustomerBill.contract_id.in_(contract_ids),
            CustomerBill.year == year,
            CustomerBill.month == month,
            CustomerBill.total_due > 0,
            or_(
                CustomerBill.payment_status == PaymentStatus.UNPAID,
                CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
            )
        )
        
        unpaid_bills = query.order_by(CustomerBill.cycle_start_date.desc()).all()
        # -----------------------------------------

        return {
            "customer_found": True,
            "customer_name": payer_name,
            "unpaid_bills": [
                {
                    "id": str(bill.id),
                    "employee_name": bill.contract.service_personnel.name if bill.contract and bill.contract.service_personnel else "未知员工",
                    "cycle": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} to {bill.cycle_end_date.strftime('%Y-%m-%d')}",
                    "bill_month": bill.month,
                    "total_due": str(bill.total_due),
                    "total_paid": str(bill.total_paid),
                    "amount_remaining": str(bill.total_due - bill.total_paid),
                    "status": bill.payment_status.value,
                }
                for bill in unpaid_bills
            ]
        }

    def allocate_transaction(self, bank_transaction_id: str, allocations: list, operator_id: str) -> dict:
        """
        将一笔银行流水按指定的分配方案进行分配，并记录财务活动日志。
        这是一个事务性操作。
        """
        bank_txn = BankTransaction.query.get(bank_transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.status not in [BankTransactionStatus.UNMATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
             return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be allocated."}

        total_allocation_amount = sum(Decimal(alloc['amount']) for alloc in allocations)

        if total_allocation_amount > bank_txn.amount:
            return {"error": "Total allocated amount exceeds transaction amount."}

        try:
            user = User.query.get(operator_id)
            if not user:
                raise Exception(f"Operator with id {operator_id} not found.")

            for alloc in allocations:
                bill_id = alloc['bill_id']
                amount_to_pay = Decimal(alloc['amount'])

                if amount_to_pay <= 0:
                    continue

                bill = CustomerBill.query.get(bill_id)
                if not bill:
                    raise Exception(f"CustomerBill with id {bill_id} not found.")

                # 1. 创建支付记录 (PaymentRecord)
                payment = PaymentRecord(
                    customer_bill_id=bill.id,
                    amount=amount_to_pay,
                    payment_date=bank_txn.transaction_time.date(),
                    method="银行转账",
                    notes=f"{bank_txn.payer_name}转账。流水号: {bank_txn.transaction_id}",
                    created_by_user_id=operator_id,
                    bank_transaction_id=bank_txn.id
                )
                db.session.add(payment)

                # 2. 更新客户账单 (CustomerBill)
                bill.total_paid += amount_to_pay
                _update_bill_payment_status(bill)

                # --- NEW: Auto-create alias if payer name mismatches customer name ---
                if bank_txn.payer_name != bill.contract.customer_name:
                    # 核心修正：使用 payer_name 和 contract_id 联合查询
                    existing_alias = PayerAlias.query.filter_by(
                        payer_name=bank_txn.payer_name,
                        contract_id=bill.contract_id
                    ).first()

                    if not existing_alias:
                        # 只有在这个精确的关联不存在时，才创建
                        try:
                            new_alias = PayerAlias(
                                payer_name=bank_txn.payer_name,
                                contract_id=bill.contract_id,
                                created_by_user_id=operator_id
                            )
                            db.session.add(new_alias)
                            current_app.logger.info(f"Automatically created alias: '{bank_txn.payer_name}' -> Contract {bill.contract_id}")
                        except Exception as alias_e:
                            current_app.logger.error(f"Could not auto-create alias. Error: {alias_e}")
                # --- END NEW ---
                
                # --- 【新增】创建财务活动日志 ---
                log_entry = FinancialActivityLog(
                    customer_bill_id=bill.id,
                    contract_id=bill.contract_id,
                    user_id=operator_id,
                    action="确认银行回款",
                    details={
                        "message": f"操作员 {user.username} 通过银行流水对账，确认了一笔金额为 {amount_to_pay} 的回款。",
                        "bank_transaction_id": str(bank_txn.id),
                        "payment_record_id": str(payment.id)
                    }
                )
                db.session.add(log_entry)
                # ---------------------------------

            # 3. 更新银行流水 (BankTransaction)
            bank_txn.allocated_amount += total_allocation_amount
            if bank_txn.allocated_amount >= bank_txn.amount:
                bank_txn.status = BankTransactionStatus.MATCHED
            else:
                bank_txn.status = BankTransactionStatus.PARTIALLY_ALLOCATED
            
            db.session.commit()
            return {"success": True, "message": "Allocation successful."}

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Allocation failed for txn {bank_transaction_id}: {e}", exc_info=True)
            return {"error": f"An unexpected error occurred: {str(e)}"}

    def ignore_transaction(self, transaction_id: str, operator_id: str, remark: str = None, is_permanent: bool = False) -> dict:
        # 1. 获取主操作流水
        bank_txn = BankTransaction.query.get(transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}
        if bank_txn.status not in [BankTransactionStatus.UNMATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be ignored."}
        try:
            # 2. 准备忽略原因和永久规则
            final_remark = remark
            if is_permanent:
                existing_rule = PermanentIgnoreList.query.filter_by(
                    payer_name=bank_txn.payer_name,
                    direction=bank_txn.direction
                ).first()
                if not existing_rule:
                    new_rule = PermanentIgnoreList(
                        payer_name=bank_txn.payer_name,
                        direction=bank_txn.direction,
                        initial_remark=remark,
                        created_by_user_id=operator_id
                    )
                db.session.add(new_rule)
            
                final_remark = f"{remark or ''} (永久忽略)".strip()
            # 3. 查找当月所有其他符合条件的流水
            txn_month = bank_txn.transaction_time.month
            txn_year = bank_txn.transaction_time.year
            other_txns_to_ignore = BankTransaction.query.filter(
                BankTransaction.id != transaction_id, # 排除当前操作的流水
                BankTransaction.payer_name == bank_txn.payer_name,
                BankTransaction.direction == bank_txn.direction,
                db.extract('year', BankTransaction.transaction_time) == txn_year,
                db.extract('month', BankTransaction.transaction_time) == txn_month,
                BankTransaction.status.in_([
                    BankTransactionStatus.UNMATCHED, 
                    BankTransactionStatus.PARTIALLY_ALLOCATED
                ])
            ).all()
            # 4. 忽略主操作流水
            bank_txn.status = BankTransactionStatus.IGNORED
            bank_txn.ignore_remark = final_remark
            
            # 5. 忽略所有其他找到的流水
            for txn in other_txns_to_ignore:
                txn.status = BankTransactionStatus.IGNORED
                txn.ignore_remark = final_remark
            total_ignored = len(other_txns_to_ignore) + 1
            current_app.logger.info(f"Ignoring {total_ignored} transactions for payer '{bank_txn.payer_name}' in {txn_year}-{txn_month}.")
            db.session.commit()
            return {"success": True, "message": f"{total_ignored} transaction(s) ignored."}
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Failed to ignore transaction {transaction_id}: {e}", exc_info=True)
            return {"error": "An unexpected error occurred."}  
                    
    def unignore_transaction(self, transaction_id: str, operator_id: str) -> dict:
        bank_txn = BankTransaction.query.get(transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.status != BankTransactionStatus.IGNORED:
            return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be un-ignored."}

        try:
            # 检查并删除永久忽略规则
            rule_to_delete = PermanentIgnoreList.query.filter_by(
                payer_name=bank_txn.payer_name,
                direction=bank_txn.direction
            ).first()

            message = "Transaction un-ignored."
            if rule_to_delete:
                db.session.delete(rule_to_delete)
                message = "Transaction un-ignored and permanent rule removed."

            # 重置流水状态
            if bank_txn.allocated_amount > 0:
                bank_txn.status = BankTransactionStatus.PARTIALLY_ALLOCATED
            else:
                bank_txn.status = BankTransactionStatus.UNMATCHED
            
            # 清空忽略备注
            bank_txn.ignore_remark = None

            db.session.commit()
            return {"success": True, "message": message}
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Failed to un-ignore transaction {transaction_id}: {e}", exc_info=True)
            return {"error": "An unexpected error occurred."}