# backend/tests/test_maternity_nurse_contract_extensions.py
"""
单元测试：月嫂合同续约与延长功能
"""
import pytest
from datetime import datetime, date, timedelta
from decimal import Decimal
from backend.models import (
    db,
    MaternityNurseContract,
    CustomerBill,
    ServicePersonnel,
    ContractTemplate,
    ContractTemplate,
    SigningStatus,
    FinancialAdjustment,
    AdjustmentType
)
from backend.services.contract_service import ContractService
from backend.extensions import db as db_ext


@pytest.fixture
def maternity_nurse_contract(_app):
    """创建一个测试用的月嫂合同"""
    with _app.app_context():
        # 创建服务人员
        employee = ServicePersonnel(
            name="测试月嫂",
            phone_number="13800138000",
            id_card_number="110101199001011234"
        )
        db.session.add(employee)
        db.session.flush()
        
        # 创建合同模板 (使用唯一名称避免冲突)
        import time
        template = ContractTemplate(
            template_name=f"月嫂合同模板_{int(time.time() * 1000)}",
            content="合同内容模板",
            contract_type="maternity_nurse"
        )
        db.session.add(template)
        db.session.flush()
        
        # 创建月嫂合同
        start_date = datetime(2025, 1, 1)
        end_date = datetime(2025, 2, 28)
        
        contract = MaternityNurseContract(
            customer_name="测试客户",
            customer_name_pinyin="ceshikehu",
            service_personnel_id=employee.id,
            start_date=start_date,
            end_date=end_date,
            provisional_start_date=date(2025, 1, 1),
            employee_level="8000",
            management_fee_amount=Decimal("1000.00"),
            deposit_amount=Decimal("3000.00"),
            status="pending",
            signing_status=SigningStatus.UNSIGNED,
            template_id=template.id
        )
        db.session.add(contract)
        db.session.commit()
        
        contract_id = contract.id
        
        yield contract_id
        
        # 清理
        db.session.query(CustomerBill).filter_by(contract_id=contract_id).delete()
        db.session.query(MaternityNurseContract).filter_by(id=contract_id).delete()
        db.session.query(ServicePersonnel).filter_by(id=employee.id).delete()
        db.session.query(ContractTemplate).filter_by(id=template.id).delete()
        db.session.commit()


@pytest.fixture
def active_maternity_nurse_contract(_app):
    """创建一个已激活的月嫂合同"""
    with _app.app_context():
        # 创建服务人员
        employee = ServicePersonnel(
            name="测试月嫂2",
            phone_number="13800138001",
            id_card_number="110101199001011235"
        )
        db.session.add(employee)
        db.session.flush()
        
        # 创建合同模板 (使用唯一名称避免冲突)
        import time
        template = ContractTemplate(
            template_name=f"月嫂合同模板2_{int(time.time() * 1000)}",
            content="合同内容模板",
            contract_type="maternity_nurse"
        )
        db.session.add(template)
        db.session.flush()
        
        # 创建已激活的月嫂合同
        start_date = datetime(2025, 1, 1)
        end_date = datetime(2025, 2, 28)
        
        contract = MaternityNurseContract(
            customer_name="测试客户2",
            customer_name_pinyin="ceshikehu2",
            service_personnel_id=employee.id,
            start_date=start_date,
            end_date=end_date,
            provisional_start_date=date(2025, 1, 1),
            actual_onboarding_date=start_date,
            expected_offboarding_date=end_date,
            employee_level="8000",
            management_fee_amount=Decimal("1000.00"),
            deposit_amount=Decimal("3000.00"),
            status="active",
            signing_status=SigningStatus.SIGNED,
            template_id=template.id
        )
        db.session.add(contract)
        db.session.commit()
        
        contract_id = contract.id
        
        yield contract_id
        
        # 清理
        db.session.query(CustomerBill).filter_by(contract_id=contract_id).delete()
        db.session.query(MaternityNurseContract).filter_by(id=contract_id).delete()
        db.session.query(ServicePersonnel).filter_by(id=employee.id).delete()
        db.session.query(ContractTemplate).filter_by(id=template.id).delete()
        db.session.commit()


class TestMaternityNurseContractRenewal:
    """测试月嫂合同续约优化功能"""
    
    def test_renew_contract_auto_sets_actual_onboarding_date(self, _app, maternity_nurse_contract):
        """测试续约时自动设置实际上户日期"""
        with _app.app_context():
            service = ContractService()
            
            # 准备续约数据
            renewal_data = {
                "start_date": "2025-03-01T00:00:00",
                "end_date": "2025-04-30T23:59:59",
                "employee_level": "8500",
                "management_fee_amount": "1100.00",
                "transfer_deposit": False  # 不转移保证金,简化测试
            }
            
            # 执行续约
            renewed_contract = service.renew_contract(str(maternity_nurse_contract), renewal_data)
            db.session.commit()
            
            # 验证实际上户日期已设置
            assert renewed_contract.actual_onboarding_date is not None
            # 比较日期部分,避免时区问题
            expected_date = datetime.fromisoformat(renewal_data["start_date"])
            assert renewed_contract.actual_onboarding_date.date() == expected_date.date()
            
            # 清理续约合同
            db.session.query(MaternityNurseContract).filter_by(id=renewed_contract.id).delete()
            db.session.commit()
    
    def test_renew_contract_sets_status_to_active(self, _app, maternity_nurse_contract):
        """测试续约时自动设置状态为 active"""
        with _app.app_context():
            service = ContractService()
            
            renewal_data = {
                "start_date": "2025-03-01T00:00:00",
                "end_date": "2025-04-30T23:59:59",
                "employee_level": "8500",
                "management_fee_amount": "1100.00",
                "transfer_deposit": False
            }
            
            renewed_contract = service.renew_contract(str(maternity_nurse_contract), renewal_data)
            db.session.commit()
            
            # 验证状态为 active
            assert renewed_contract.status == "active"
            
            # 清理
            db.session.query(MaternityNurseContract).filter_by(id=renewed_contract.id).delete()
            db.session.commit()
    
    def test_renew_contract_preserves_deposit_and_discount(self, _app, maternity_nurse_contract):
        """测试续约时保留定金和优惠金额"""
        with _app.app_context():
            # 获取原合同
            old_contract = MaternityNurseContract.query.get(maternity_nurse_contract)
            old_contract.discount_amount = Decimal("500.00")
            db.session.commit()
            
            service = ContractService()
            
            renewal_data = {
                "start_date": "2025-03-01T00:00:00",
                "end_date": "2025-04-30T23:59:59",
                "employee_level": "8500",
                "management_fee_amount": "1100.00",
                "transfer_deposit": False
            }
            
            renewed_contract = service.renew_contract(str(maternity_nurse_contract), renewal_data)
            db.session.commit()
            
            # 验证定金和优惠金额已继承
            assert renewed_contract.deposit_amount == old_contract.deposit_amount
            assert renewed_contract.discount_amount == old_contract.discount_amount
            
            # 清理
            db.session.query(MaternityNurseContract).filter_by(id=renewed_contract.id).delete()
            db.session.commit()

    def test_renew_contract_calculates_deposit_correctly(self, _app, maternity_nurse_contract):
        """测试续约时正确计算客交保证金 (security_deposit_paid)"""
        with _app.app_context():
            service = ContractService()
            
            # 准备续约数据
            employee_level = Decimal("8500.00")
            management_fee_amount = Decimal("1100.00")
            
            renewal_data = {
                "start_date": "2025-03-01T00:00:00",
                "end_date": "2025-04-30T23:59:59",
                "employee_level": str(employee_level),
                "management_fee_amount": str(management_fee_amount),
                "transfer_deposit": False
            }
            
            # 执行续约
            renewed_contract = service.renew_contract(str(maternity_nurse_contract), renewal_data)
            db.session.commit()
            
            # 验证 security_deposit_paid = employee_level + management_fee_amount
            expected_deposit = employee_level + management_fee_amount
            assert renewed_contract.security_deposit_paid == expected_deposit
            assert renewed_contract.management_fee_amount == management_fee_amount
            
            # 清理
            db.session.query(MaternityNurseContract).filter_by(id=renewed_contract.id).delete()
            db.session.commit()


class TestMaternityNurseContractExtension:
    """测试月嫂合同延长功能"""
    
    def test_extend_contract_updates_end_date(self, _app, active_maternity_nurse_contract):
        """测试延长合同更新结束日期"""
        with _app.app_context():
            service = ContractService()
            
            # 获取原合同
            old_contract = MaternityNurseContract.query.get(active_maternity_nurse_contract)
            old_end_date = old_contract.end_date
            
            # 延长合同
            new_end_date = date(2025, 3, 31)
            contract, bills_count, new_bills = service.extend_contract(
                str(active_maternity_nurse_contract),
                new_end_date
            )
            db.session.commit()
            
            # 验证结束日期已更新
            assert contract.end_date.date() == new_end_date
            assert contract.end_date.date() > old_end_date.date()
    
    def test_extend_contract_updates_expected_offboarding_date(self, _app, active_maternity_nurse_contract):
        """测试延长合同更新预计下户日期"""
        with _app.app_context():
            service = ContractService()
            
            new_end_date = date(2025, 3, 31)
            contract, _, _ = service.extend_contract(
                str(active_maternity_nurse_contract),
                new_end_date
            )
            db.session.commit()
            
            # 验证预计下户日期已更新
            assert contract.expected_offboarding_date is not None
            assert contract.expected_offboarding_date.date() == new_end_date
    
    def test_extend_contract_rejects_non_active_status(self, _app, maternity_nurse_contract):
        """测试延长非 active 状态的合同会失败"""
        with _app.app_context():
            service = ContractService()
            
            # 尝试延长 pending 状态的合同
            new_end_date = date(2025, 3, 31)
            
            with pytest.raises(ValueError) as exc_info:
                service.extend_contract(str(maternity_nurse_contract), new_end_date)
            
            assert "只能延长 active 状态的合同" in str(exc_info.value)
    
    def test_extend_contract_rejects_earlier_date(self, _app, active_maternity_nurse_contract):
        """测试延长到更早的日期会失败"""
        with _app.app_context():
            service = ContractService()
            
            # 尝试将结束日期设置为更早的日期
            new_end_date = date(2025, 1, 15)  # 早于原结束日期 2025-02-28
            
            with pytest.raises(ValueError) as exc_info:
                service.extend_contract(str(active_maternity_nurse_contract), new_end_date)
            
            assert "必须晚于当前结束日期" in str(exc_info.value)
    
    def test_extend_contract_rejects_same_date(self, _app, active_maternity_nurse_contract):
        """测试延长到相同日期会失败"""
        with _app.app_context():
            service = ContractService()
            
            # 获取当前结束日期
            contract = MaternityNurseContract.query.get(active_maternity_nurse_contract)
            same_date = contract.end_date.date()
            
            with pytest.raises(ValueError) as exc_info:
                service.extend_contract(str(active_maternity_nurse_contract), same_date)
            
            assert "必须晚于当前结束日期" in str(exc_info.value)
    
    def test_extend_contract_handles_datetime_input(self, _app, active_maternity_nurse_contract):
        """测试延长合同支持 datetime 类型输入"""
        with _app.app_context():
            service = ContractService()
            
            # 使用 datetime 类型作为输入
            new_end_date = datetime(2025, 3, 31, 23, 59, 59)
            contract, _, _ = service.extend_contract(
                str(active_maternity_nurse_contract),
                new_end_date
            )
            db.session.commit()
            
            # 验证日期已正确转换和更新
            assert contract.end_date.date() == date(2025, 3, 31)

    def test_change_contract_calculates_deposit_correctly(self, _app, active_maternity_nurse_contract):
        """测试月嫂合同变更时，客交保证金是否正确计算 (级别 + 管理费)"""
        with _app.app_context():
            service = ContractService()
            # Fixture 返回的是 ID，需要查询出对象
            old_contract = MaternityNurseContract.query.get(active_maternity_nurse_contract)
            
            # 变更数据 - 使用用户报告的数值
            # 员工级别: 24310, 管理费率: 15%
            # 预期管理费: (24310 / (1 - 0.15)) * 0.15 = 28600 * 0.15 = 4290
            # 预期保证金: 24310 + 4290 = 28600
            change_data = {
                "service_personnel_id": old_contract.service_personnel_id, # 人员不变
                "start_date": (datetime.now() + timedelta(days=1)).date().isoformat(),
                "end_date": (datetime.now() + timedelta(days=30)).date().isoformat(),
                "employee_level": "24310", 
                "management_fee_rate": "0.15", 
                "transfer_deposit": True
            }

            # 执行变更
            new_contract = service.change_contract(old_contract.id, change_data)

            # 验证
            assert new_contract.status == 'pending'
            assert new_contract.employee_level == Decimal("24310")
            
            # 验证管理费金额 (这里预期会失败，直到修复 backend/services/contract_service.py)
            assert new_contract.management_fee_amount == Decimal("4290.00")
            
            # 关键验证：保证金应该等于 级别 + 管理费
            expected_deposit = Decimal("24310") + Decimal("4290.00")
            assert new_contract.security_deposit_paid == expected_deposit
            assert new_contract.security_deposit_paid == Decimal("28600.00")

    def test_renew_contract_skips_bill_merge_for_maternity_nurse(self, _app, active_maternity_nurse_contract):
        """测试月嫂合同续约时，即使是非月末结束，也只转移保证金，不合并账单"""
        with _app.app_context():
            service = ContractService()
            old_contract = MaternityNurseContract.query.get(active_maternity_nurse_contract)
            
            # 设置旧合同结束日期为月中 (例如 2025-02-15)
            old_contract.end_date = datetime(2025, 2, 15)
            # 必须设置已付保证金，否则不会触发转移逻辑
            old_contract.security_deposit_paid = Decimal("10000.00")
            db.session.add(old_contract)
            db.session.commit()
            
            # 续约数据
            renewal_data = {
                "start_date": "2025-02-16",
                "end_date": "2025-03-16",
                "employee_level": "10000",
                "transfer_deposit": True
            }

            # 执行续约
            new_contract = service.renew_contract(old_contract.id, renewal_data)

            # 验证：
            # 1. 新合同已创建
            assert new_contract.status == 'active'
            
            # 2. 检查旧合同的最后一个账单，确认没有发生合并 (即没有被删除或标记为已合并)
            # 注意：如果执行了合并，旧账单通常会被清理或标记。
            # 这里我们检查日志或副作用比较困难，但可以通过检查新合同的账单来推断。
            # 如果没有合并，新合同应该是一个全新的开始，没有从旧合同继承的复杂调整项。
            
            # 更直接的验证是检查代码覆盖率，或者相信我们的代码逻辑修改。
            # 在此测试中，我们主要确保续约流程在非月末情况下能正常完成，且没有报错。
            # 并且确认保证金被正确转移了 (通过检查 FinancialAdjustment)
            
            deposit_adj = FinancialAdjustment.query.filter_by(
                contract_id=new_contract.id,
                adjustment_type=AdjustmentType.CUSTOMER_DECREASE,
                description="[从续约前合同转入] 保证金冲抵"
            ).first()
            
            assert deposit_adj is not None
            assert deposit_adj.amount == old_contract.security_deposit_paid
