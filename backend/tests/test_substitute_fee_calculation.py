#!/usr/bin/env python
# -*- coding: utf-8 -*-

import pytest
from datetime import datetime, date
from decimal import Decimal
from unittest.mock import Mock

from backend.app import app
from backend.services.billing_engine import calculate_substitute_management_fee

# 设定一个默认费率用于测试，这与旧逻辑中的硬编码值0.1保持一致
DEFAULT_TEST_RATE = Decimal("0.1")

@pytest.fixture
def mock_contract():
    """模拟一个主合同对象."""
    contract = Mock()
    contract.id = "main_contract_123"
    contract.end_date = date(2025, 10, 31)
    contract.termination_date = None
    # 明确将 is_monthly_auto_renew 设为 False，除非在特定测试中覆盖
    type(contract).is_monthly_auto_renew = False
    type(contract).status = 'finished'
    return contract

@pytest.fixture
def mock_substitute_record():
    """模拟一个替班记录对象."""
    record = Mock()
    record.substitute_salary = Decimal("5200")
    # 为所有测试设置默认费率
    record.substitute_management_fee_rate = DEFAULT_TEST_RATE
    return record


def test_substitution_fully_after_contract_end(mock_contract, mock_substitute_record):
    """测试场景1: 替班周期完全在合同期之后，应根据费率产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5, 0, 0, 0)
    mock_substitute_record.end_date = datetime(2025, 11, 15, 0, 0, 0) # 10天

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)
    
    # 期望费用: 5200 / 30 * 0.1 * 10 = 173.33
    assert total_fee == Decimal("173.33")

def test_substitution_partially_after_contract_end(mock_contract, mock_substitute_record):
    """测试场景2: 替班周期部分在合同期之后，应只为超出部分计费。"""
    mock_substitute_record.start_date = datetime(2025, 10, 25, 0, 0, 0)
    mock_substitute_record.end_date = datetime(2025, 11, 5, 0, 0, 0)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)
    
    # 合同结束于 10-31，所以只有 11-01 到 11-05 (5天) 计费
    # 期望费用: 5200 / 30 * 0.1 * 5 = 86.67
    assert total_fee == Decimal("86.67")

def test_substitution_fully_within_contract_period(mock_contract, mock_substitute_record):
    """测试场景3: 替班周期完全在合同期之内，不应产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 10, 1)
    mock_substitute_record.end_date = datetime(2025, 10, 15)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")

def test_substitution_ends_on_contract_end_date(mock_contract, mock_substitute_record):
    """测试场景4: 替班结束日期与合同结束日期为同一天，不应产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 10, 20)
    mock_substitute_record.end_date = datetime(2025, 10, 31)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")

def test_termination_scenario(mock_contract, mock_substitute_record):
    """测试场景5: 模拟合同提前终止，应为超出终止日期的部分计费。"""
    termination_date = date(2025, 10, 20)
    mock_substitute_record.start_date = datetime(2025, 10, 15)
    mock_substitute_record.end_date = datetime(2025, 10, 25)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(
            mock_substitute_record, mock_contract, contract_termination_date=termination_date
        )
    
    # 合同终止于 10-20，所以只有 10-21 到 10-25 (5天) 计费
    # 期望费用: 5200 / 30 * 0.1 * 5 = 86.67
    assert total_fee == Decimal("86.67")


def test_fee_with_zero_rate(mock_contract, mock_substitute_record):
    """【新】测试场景6: 费率为0，即使在合同期外也不产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)
    mock_substitute_record.substitute_management_fee_rate = Decimal("0")

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")


def test_fee_with_none_rate(mock_contract, mock_substitute_record):
    """【新】测试场景7: 费率为None，不产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)
    mock_substitute_record.substitute_management_fee_rate = None

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")

@pytest.mark.parametrize("rate, expected_fee", [
    ("0.05", "86.67"),   # 5% 费率
    ("0.15", "260.00"),  # 15% 费率
    ("0.25", "433.33"),  # 25% 费率
    ("1.00", "1733.33") # 100% 费率
])
def test_fee_with_different_rates(mock_contract, mock_substitute_record, rate, expected_fee):
    """【新】测试场景8: 使用不同的费率进行计算。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5, 0, 0, 0)
    mock_substitute_record.end_date = datetime(2025, 11, 15, 0, 0, 0) # 10天
    mock_substitute_record.substitute_management_fee_rate = Decimal(rate)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)
    
    # 5200 / 30 * rate * 10
    assert total_fee == Decimal(expected_fee)


def test_auto_renewing_nanny_contract_no_fee(mock_substitute_record):
    """【旧】测试场景9: 对于未终止的自动续签合同，即使替班在名义结束后，也不收费。"""
    mock_contract = Mock()
    mock_contract.end_date = date(2025, 10, 31)
    type(mock_contract).is_monthly_auto_renew = True
    type(mock_contract).status = 'active'
    mock_contract.termination_date = None

    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)
    # 即使费率非0，因为合同状态是有效的，也不该收费
    mock_substitute_record.substitute_management_fee_rate = Decimal("0.1")

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")
