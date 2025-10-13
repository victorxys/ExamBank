import re
from datetime import datetime
from decimal import Decimal
from flask import current_app
from backend.models import db, BankTransaction, BankTransactionStatus, CustomerBill, PaymentRecord, PaymentStatus, User, BaseContract,PayerAlias,FinancialActivityLog,TransactionDirection
from sqlalchemy import and_, or_
import traceback
import decimal
D = decimal.Decimal
class BankStatementService:
    """
    处理银行对账单的解析、存储和匹配服务。
    """
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
            elif len(unpaid_bills) > 1:
                categorized_results["manual_allocation"].append({
                    **self._format_txn(txn),
                    "unpaid_bills": [self._format_bill(b, txn.id) for b in unpaid_bills]
                })
            else: # len(unpaid_bills) == 0
                categorized_results["unmatched"].append(self._format_txn(txn))

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

    def ignore_transaction(self, transaction_id: str, operator_id: str) -> dict:
        bank_txn = BankTransaction.query.get(transaction_id)
        if not bank_txn:
            return {"error": "Bank transaction not found"}

        if bank_txn.status not in [BankTransactionStatus.UNMATCHED, BankTransactionStatus.PARTIALLY_ALLOCATED]:
            return {"error": f"Transaction status is '{bank_txn.status.value}', cannot be ignored."}

        try:
            bank_txn.status = BankTransactionStatus.IGNORED
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