from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from flask import Flask

from backend.services import attendance_sync_service as attendance


class _Column:
    def __eq__(self, _other):
        return self

    def __le__(self, _other):
        return self

    def in_(self, _values):
        return self

    def asc(self):
        return self


class _Query:
    def __init__(self, records):
        self.records = records

    def get(self, record_id):
        return next((item for item in self.records if item.id == record_id), None)

    def filter(self, *_criteria):
        return self

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.records


def _install_history(monkeypatch, onboarding_records):
    contract = SimpleNamespace(
        id='contract', type='nanny', service_personnel_id='employee',
        family_id=None, customer_name='客户', customer_id=None,
        # 迁移合同的日期默认钟点不能被视为实际到达时间。
        start_date=datetime(2023, 10, 23, 8), actual_onboarding_date=None,
    )
    form = SimpleNamespace(
        id='form', contract=contract, contract_id=contract.id, employee_id='employee',
        cycle_start_date=datetime(2026, 11, 1), cycle_end_date=datetime(2026, 11, 30),
        customer_signature_token=None,
        form_data={
            'onboarding_records': onboarding_records,
            'offboarding_records': [{'date': '2026-11-06', 'endTime': '11:00'}],
        },
    )
    for model_name, records, columns in (
        ('BaseContract', [contract], ('service_personnel_id', 'status', 'customer_name')),
        ('AttendanceForm', [form], ('employee_id', 'contract_id', 'cycle_start_date')),
    ):
        attributes = {'query': _Query(records)}
        attributes.update({name: _Column() for name in columns})
        monkeypatch.setattr(attendance, model_name, type(model_name, (), attributes))
    return form


def test_missing_onboarding_exposes_date_for_supplement_without_guessing_time(monkeypatch):
    form = _install_history(monkeypatch, [])
    with Flask(__name__).app_context():
        info = attendance.get_onboarding_time_for_contract('employee', 'contract', form.cycle_start_date)
        errors = attendance.validate_offboarding_onboarding_reference(form)

    assert info['has_onboarding'] is False
    assert info['onboarding_date'] == '2023-10-23'
    assert info['contract_id'] == 'contract'
    assert info['onboarding_time'] is None
    assert '补填上户时间' in errors[0]


def test_completed_onboarding_after_placeholder_yields_eighteen_hours(monkeypatch):
    form = _install_history(monkeypatch, [
        {'date': '2023-10-23', 'startTime': ''},
        {'date': '2023-10-23', 'startTime': '17:00'},
    ])
    with Flask(__name__).app_context():
        info = attendance.get_onboarding_time_for_contract('employee', 'contract', form.cycle_start_date)
        assert attendance.validate_offboarding_onboarding_reference(form) == []

    assert info['onboarding_time'] == '17:00'
    combined_days = attendance.calculate_offboarding_work_days(info['onboarding_time'], '2026-11-06', '11:00')
    assert combined_days == Decimal('0.750')
    assert combined_days * 24 == 18


def test_sync_rejects_missing_reference_before_mutating_attendance(monkeypatch):
    form = _install_history(monkeypatch, [])

    def unexpected_normalize(*_args, **_kwargs):
        pytest.fail('缺失上户时间时不应进入同步写入流程')

    monkeypatch.setattr(attendance, 'normalize_auto_overtime_form_data', unexpected_normalize)
    with Flask(__name__).app_context(), pytest.raises(ValueError, match='补填上户时间'):
        attendance.sync_attendance_to_record(form.id)

    with pytest.raises(ValueError, match='无法计算'):
        attendance.calculate_offboarding_work_days(None, '2026-11-06', '11:00')
