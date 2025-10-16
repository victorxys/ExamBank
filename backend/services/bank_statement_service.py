import re
from datetime import datetime
from decimal import Decimal
from flask import current_app
from backend.models import db, BankTransaction, BankTransactionStatus, CustomerBill, PaymentRecord, PaymentStatus, User, BaseContract,PayerAlias,FinancialActivityLog,TransactionDirection, ServicePersonnel, EmployeePayroll, FinancialAdjustment, PayoutStatus, AdjustmentType
from sqlalchemy import and_, or_
import traceback
import decimal
D = decimal.Decimal
class BankStatementService:
    """
    处理银行对账单的解析、存储和匹配服务。
    """
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
                # Reverse lookup for FinancialAdjustments
                adjustments = FinancialAdjustment.query.filter(
                    FinancialAdjustment.settlement_details.op('->')('payments').op('@>')(f'[{{\"bank_transaction_id\": \"{txn.transaction_id}\"}}]')
                ).all()
                for adj in adjustments:
                    payment_info = next((p for p in adj.settlement_details['payments'] if p['bank_transaction_id']== txn.transaction_id), None)
                    if payment_info:
                        allocations.append({
                            'type': 'FinancialAdjustment',
                            'display_name': f"退款: {adj.description}",
                            'total_due': str(adj.amount),
                            'amount_remaining': "0.00", # Refunds are settled in full
                            'allocated_amount_from_this_txn': str(payment_info.get('amount'))
                        })

                # Reverse lookup for EmployeePayrolls
                payrolls = EmployeePayroll.query.filter(
                    EmployeePayroll.payout_details.op('->')('payments').op('@>')(f'[{{\"bank_transaction_id\": \"{txn.transaction_id}\"}}]')
                ).all()
                for payroll in payrolls:
                    payment_info = next((p for p in payroll.payout_details['payments'] if p['bank_transaction_id']== txn.transaction_id), None)
                    if payment_info:
                        employee = payroll.contract.service_personnel or payroll.contract.user
                        employee_name = employee.name if hasattr(employee, 'name') else employee.username
                        allocations.append({
                            'type': 'EmployeePayroll',
                            'display_name': f"工资: {employee_name} ({payroll.year}-{payroll.month})",
                            'total_due': str(payroll.total_due),
                            'amount_remaining': str(payroll.total_due - payroll.total_paid_out),
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
                    target_obj.total_paid_out += amount_to_allocate
                    target_obj.payout_status = PayoutStatus.PAID if target_obj.total_paid_out >= target_obj.total_due else PayoutStatus.PARTIALLY_PAID
                    target_contract_id = target_obj.contract_id

                    # Store transaction info in payout_details JSON field
                    if not target_obj.payout_details:
                        target_obj.payout_details = {}
                    if 'payments' not in target_obj.payout_details:
                        target_obj.payout_details['payments'] = []
                    target_obj.payout_details['payments'].append({
                        'bank_transaction_id': bank_txn.transaction_id,
                        'amount': str(amount_to_allocate),
                        'paid_at': bank_txn.transaction_time.isoformat()
                    })

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
        
    def get_and_categorize_outbound_transactions(self, year: int, month: int) -> dict:
        print("\n--- [DEBUG] Starting outbound categorization ---")
        print(f"--- [DEBUG] Period: {year}-{month}")

        # 1. Fetch transactions by status
        base_query = BankTransaction.query.filter(
            BankTransaction.direction == TransactionDirection.DEBIT,
            db.extract('year', BankTransaction.transaction_time) == year,
            db.extract('month', BankTransaction.transaction_time) == month
        )

        txns_to_process = base_query.filter(BankTransaction.status.in_([
            BankTransactionStatus.UNMATCHED,
            BankTransactionStatus.PARTIALLY_ALLOCATED
        ])).all()
        print(f"--- [DEBUG] Found {len(txns_to_process)} total transactions to process (UNMATCHED or PARTIALLY_ALLOCATED).")

        confirmed_txns = base_query.filter(BankTransaction.status == BankTransactionStatus.MATCHED).all()
        ignored_txns = base_query.filter(BankTransaction.status == BankTransactionStatus.IGNORED).all()

        # 2. Fetch all potential allocation targets for the period
        payable_items = self.get_payable_items(year, month)
        all_payables = payable_items['payrolls'] + payable_items['adjustments']
        print(f"--- [DEBUG] Found {len(all_payables)} payable items for the period.")

        # 3. Initialize results dictionary
        categorized_results = {
            "pending_confirmation": [],
            "manual_allocation": [],
            "unmatched": [],
            "confirmed": [self.serialize_transaction(txn) for txn in confirmed_txns],
            "ignored": [self.serialize_transaction(txn) for txn in ignored_txns]
        }

        # 4. Process all UNMATCHED and PARTIALLY_ALLOCATED transactions in a single loop
        print("--- [DEBUG] Starting processing loop...")
        for txn in txns_to_process:
            print(f"--- [DEBUG] Processing txn ID: {txn.id}, Status: {txn.status.value}")
            serialized_txn = self.serialize_transaction(txn)

            # FIX: Compare enum values directly for robustness
            if txn.status.value == BankTransactionStatus.PARTIALLY_ALLOCATED.value:
                print(f"--- [DEBUG] -> Matched Rule 1 (PARTIALLY_ALLOCATED).")

                contract_id = None
                if txn.associated_object_id:
                    if txn.associated_object_type == 'EmployeePayroll':
                        item = db.session.get(EmployeePayroll, txn.associated_object_id)
                        if item: contract_id = str(item.contract_id)
                    elif txn.associated_object_type == 'FinancialAdjustment':
                        item = db.session.get(FinancialAdjustment, txn.associated_object_id)
                        if item: contract_id = str(item.contract_id)

                related_payables = all_payables
                if contract_id:
                    print(f"--- [DEBUG] --> Filtering payables for contract_id: {contract_id}")
                    related_payables = [p for p in all_payables if p.get('contract_id') == contract_id]
                else:
                    print(f"--- [DEBUG] --> No contract_id found for partially allocated txn, showing all payables.")

                categorized_results["manual_allocation"].append({**serialized_txn, "payable_items":related_payables})
                categorized_results["unmatched"].append(serialized_txn)
                continue

            # Rule 2: If strictly UNMATCHED, apply the suggestion logic
            if txn.status.value == BankTransactionStatus.UNMATCHED.value:
                print(f"--- [DEBUG] -> Matched Rule 2 (UNMATCHED).")
                matching_payables = [p for p in all_payables if D(p['amount_due']) == txn.amount]

                if len(matching_payables) == 1:
                    print(f"--- [DEBUG] --> Found single exact match. Adding to 'pending_confirmation'.")
                    categorized_results["pending_confirmation"].append({
                        **serialized_txn,
                        "matched_item": matching_payables[0]
                    })
                else:
                    print(f"--- [DEBUG] --> No single exact match ({len(matching_payables)} found). Adding to 'unmatched'.")
                    categorized_results["unmatched"].append(serialized_txn)

        print("--- [DEBUG] Finished processing loop.")
        print(f"--- [DEBUG] Final counts: manual_allocation={len(categorized_results['manual_allocation'])}, unmatched={len(categorized_results['unmatched'])}")
        print("--- [DEBUG] Ending outbound categorization ---\n")
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
        matching_user_ids = [u.id for u in User.query.filter(or_(User.username.ilike(f"%{search_term}%"),User.name_pinyin.ilike(f"%{pinyin_search_term}%"))).all()]
        print(f"--- DEBUG: Found {len(matching_user_ids)} matching user IDs: {matching_user_ids} ---")

        matching_sp_ids = [sp.id for sp in ServicePersonnel.query.filter(or_(ServicePersonnel.name.ilike(f"%{search_term}%"), ServicePersonnel.name_pinyin.ilike(f"%{pinyin_search_term}%"))).all()]
        print(f"--- DEBUG: Found {len(matching_sp_ids)} matching service personnel IDs: {matching_sp_ids} ---")

        if matching_user_ids or matching_sp_ids:
            contracts_by_employee = BaseContract.query.filter(
                or_(
                    BaseContract.user_id.in_(matching_user_ids),
                    BaseContract.service_personnel_id.in_(matching_sp_ids)
                )
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
            employee = payroll.contract.service_personnel or payroll.contract.user
            if employee:
                employee_name = employee.name if hasattr(employee, 'name') else employee.username
                results.append({
                    'type': 'EmployeePayroll',
                    'id': str(payroll.id),
                    'display': f"工资单: {employee_name} (客户: {payroll.contract.customer_name})",
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
                if contract:
                    unpaid_bills = CustomerBill.query.filter(
                        CustomerBill.contract_id == contract.id,
                        CustomerBill.total_due > 0,
                        or_(
                            CustomerBill.payment_status == PaymentStatus.UNPAID,
                            CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
                        )
                    ).all()
                
                categorized_results["manual_allocation"].append({
                    **self._format_txn(txn),
                    "unpaid_bills": [self._format_bill(b, txn.id) for b in unpaid_bills]
                })
                continue

            # --- NEW LOGIC for UNMATCHED transactions ---
            alias = PayerAlias.query.filter_by(payer_name=txn.payer_name).first()
            contracts = []
            if alias:
                contract = db.session.get(BaseContract, alias.contract_id)
                if contract:
                    contracts.append(contract)
            else:
                contracts = BaseContract.query.filter_by(customer_name=txn.payer_name).all()

            if not contracts:
                categorized_results["unmatched"].append(self._format_txn(txn))
                continue

            contract_ids = [c.id for c in contracts]
            
            unpaid_bills = CustomerBill.query.filter(
                CustomerBill.contract_id.in_(contract_ids),
                CustomerBill.year == year,
                CustomerBill.month == month,
                CustomerBill.total_due > 0,
                or_(
                    CustomerBill.payment_status == PaymentStatus.UNPAID,
                    CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
                )
            ).all()

            if len(unpaid_bills) == 1:
                categorized_results["pending_confirmation"].append({
                    **self._format_txn(txn),
                    "matched_bill": self._format_bill(unpaid_bills[0], txn.id),
                    "matched_by": "alias" if alias else "name"
                })
            else: # Covers len(unpaid_bills) == 0 and len(unpaid_bills) > 1
                # 只要能识别出合同，就说明客户是已知的
                customer_name = contracts[0].customer_name
                categorized_results["manual_allocation"].append({
                    **self._format_txn(txn),
                    "unpaid_bills": [self._format_bill(b, txn.id) for b in unpaid_bills],
                    "customer_name": customer_name,  # 明确附加客户名称
                    "matched_by": "alias" if alias else "name" # 附加匹配方式
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
        这是一个事务性操作。
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

            payments_to_delete = bank_txn.payment_records.all()
            total_cancelled_amount = Decimal('0')

            for payment in payments_to_delete:
                bill = payment.customer_bill
                amount_to_revert = payment.amount
                total_cancelled_amount += amount_to_revert

                # 1. 回滚客户账单 (CustomerBill)
                if bill:
                    bill.total_paid -= amount_to_revert
                    if bill.total_paid <= 0:
                        bill.payment_status = PaymentStatus.UNPAID
                    else:
                        bill.payment_status = PaymentStatus.PARTIALLY_PAID
                    
                    # 2. 删除相关的财务活动日志
                    FinancialActivityLog.query.filter(
                        FinancialActivityLog.details.op('->>')('payment_record_id') == str(payment.id)
                    ).delete(synchronize_session=False)

                # 3. 删除支付记录 (PaymentRecord)
                db.session.delete(payment)

            # 4. 回滚银行流水 (BankTransaction)
            bank_txn.allocated_amount -= total_cancelled_amount
            bank_txn.status = BankTransactionStatus.UNMATCHED
            if bank_txn.allocated_amount < 0: # 安全检查
                bank_txn.allocated_amount = Decimal('0')

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
            "employee_name": bill.contract.service_personnel.name if bill.contract.service_personnel else (bill.contract.user.username if bill.contract.user else "未知员工"),
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
                bank_txn = BankTransaction(
                    transaction_id=parsed_data['transaction_id'],
                    transaction_time=parsed_data['transaction_time'],
                    amount=parsed_data['amount'],
                    payer_name=parsed_data['payer_name'],
                    summary=parsed_data['summary'],
                    direction=parsed_data['direction'],
                    raw_text=parsed_data['raw_text'],
                    status=BankTransactionStatus.UNMATCHED
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
                    "employee_name": bill.contract.service_personnel.name if bill.contract and bill.contract.service_personnel else (bill.contract.user.username if bill.contract and bill.contract.user else "未知员工"),
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
                if bill.total_paid >= bill.total_due:
                    bill.payment_status = PaymentStatus.PAID
                else:
                    bill.payment_status = PaymentStatus.PARTIALLY_PAID
                
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

    def ignore_transaction(self, transaction_id: str, operator_id: str, remark: str = None) -> dict:
        bank_txn = BankTransaction.query.get(transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.status not in [BankTransactionStatus.UNMATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be ignored."}

        try:
            bank_txn.status = BankTransactionStatus.IGNORED
            bank_txn.ignore_remark = remark
            db.session.commit()
            return {"success": True, "message": "Transaction ignored."}
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
            if bank_txn.allocated_amount > 0:
                bank_txn.status = BankTransactionStatus.PARTIALLY_ALLOCATED
            else:
                bank_txn.status = BankTransactionStatus.UNMATCHED
            db.session.commit()
            return {"success": True, "message": "Transaction un-ignored."}
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"Failed to un-ignore transaction {transaction_id}: {e}", exc_info=True)
            return {"error": "An unexpected error occurred."}