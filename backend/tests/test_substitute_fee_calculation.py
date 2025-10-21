#!/usr/bin/env python
# -*- coding: utf-8 -*-

import pytest
from datetime import datetime, date
from decimal import Decimal
from unittest.mock import Mock

from backend.app import app
from backend.services.billing_engine import calculate_substitute_management_fee

@pytest.fixture
def mock_contract():
    """模拟一个主合同对象."""
    contract = Mock()
    contract.id = "main_contract_123"
    # 默认合同在2025-10-31结束
    contract.end_date = date(2025, 10, 31)
    # 显式设置 termination_date 为 None，防止测试中返回 Mock 对象
    contract.termination_date = None
    # 确保模拟对象具有 is_monthly_auto_renew 属性
    type(contract).is_monthly_auto_renew = False
    type(contract).status = 'finished'
    return contract

@pytest.fixture
def mock_substitute_record():
    """模拟一个替班记录对象."""
    record = Mock()
    record.substitute_salary = Decimal("5200")
    return record


def test_substitution_fully_after_contract_end(mock_contract, mock_substitute_record):
    """测试场景1: 替班周期完全在合同期之后，应产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("173.33")


def test_substitution_partially_after_contract_end(mock_contract, mock_substitute_record):
    """测试场景2: 替班周期部分在合同期之后，应只为超出部分产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 10, 25)
    mock_substitute_record.end_date = datetime(2025, 11, 5)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("86.67")


def test_substitution_fully_within_contract_period(mock_contract, mock_substitute_record):
    """测试场景3: T替班周期完全在合同期之内，不应产生费用。"""
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
    """测试场景5: 模拟合同提前终止，应为超出部分计费。"""
    termination_date = date(2025, 10, 20)
    mock_substitute_record.start_date = datetime(2025, 10, 15)
    mock_substitute_record.end_date = datetime(2025, 10, 25)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(
            mock_substitute_record, mock_contract, contract_termination_date=termination_date
        )

    assert total_fee == Decimal("86.67")


def test_no_substitute_salary(mock_contract, mock_substitute_record):
    """测试场景6: 如果替班薪资为0或None，不应产生费用。"""
    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)
    mock_substitute_record.substitute_salary = Decimal("0")

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")


def test_auto_renewing_nanny_contract_no_fee(mock_substitute_record):
    """测试场景7: 对于未终止的自动续签合同，即使替班在名义结束后，也不收费。"""
    mock_contract = Mock()
    mock_contract.end_date = date(2025, 10, 31)
    type(mock_contract).is_monthly_auto_renew = True
    type(mock_contract).status = 'active'
    mock_contract.termination_date = None

    mock_substitute_record.start_date = datetime(2025, 11, 5)
    mock_substitute_record.end_date = datetime(2025, 11, 15)

    with app.app_context():
        total_fee = calculate_substitute_management_fee(mock_substitute_record, mock_contract)

    assert total_fee == Decimal("0.00")
