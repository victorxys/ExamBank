import pytest
from backend.models import db, AttendanceForm, BaseContract, ServicePersonnel, User
from backend.api.miniapp_api import _prepare_attendance_display_payload
from backend.services.attendance_sync_service import (
    AUTO_OVERTIME_PROJECTION_KEY,
    _split_overtime_days_by_holiday,
    normalize_auto_overtime_form_data,
    strip_client_derived_auto_overtime,
)
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
import uuid

@pytest.fixture
def setup_data(_app):
    sp_id = None
    contract_id = None
    with _app.app_context():
        # 创建测试用户/员工 (使用随机手机号避免冲突)
        unique_phone = f"138{uuid.uuid4().int % 100000000:08d}"
        sp = ServicePersonnel(name="Test Employee", phone_number=unique_phone)
        db.session.add(sp)
        db.session.flush()
        sp_id = sp.id
        
        # 创建合同
        contract = BaseContract(
            type="nanny",
            customer_name="Test Customer",
            start_date=datetime(2025, 1, 1),
            end_date=datetime(2025, 12, 31),
            service_personnel_id=sp.id,
            status="active"
        )
        db.session.add(contract)
        db.session.commit()
        contract_id = contract.id
        
    yield sp_id, contract_id
    
    # 清理数据
    with _app.app_context():
        if contract_id:
            BaseContract.query.filter_by(id=contract_id).delete()
        if sp_id:
            # 需要先删除关联的 AttendanceForm 和 AttendanceRecord (如果有)
            AttendanceForm.query.filter_by(employee_id=sp_id).delete()
            AttendanceRecord.query.filter_by(employee_id=sp_id).delete()
            ServicePersonnel.query.filter_by(id=sp_id).delete()
        db.session.commit()

def test_get_attendance_form_by_token_create_new(client, setup_data):
    sp_id, contract_id = setup_data
    token = str(sp_id) 
    
    response = client.get(f'/api/attendance-forms/by-token/{token}')
    assert response.status_code == 200
    data = response.get_json()
    assert data['contract_id'] == str(contract_id)
    assert data['employee_id'] == str(sp_id)
    assert data['status'] == 'draft'

def test_update_attendance_form(client, setup_data):
    sp_id, contract_id = setup_data
    token = str(sp_id)
    
    # 先创建
    client.get(f'/api/attendance-forms/by-token/{token}')
    
    # 更新
    update_data = {
        "form_data": {
            "rest_records": [{"date": "2025-01-01", "hours": 24, "minutes": 0}]
        }
    }
    response = client.put(f'/api/attendance-forms/by-token/{token}', json=update_data)
    assert response.status_code == 200
    data = response.get_json()
    assert data['form_data']['rest_records'][0]['date'] == "2025-01-01"

def test_confirm_attendance_form(client, setup_data):
    sp_id, contract_id = setup_data
    token = str(sp_id)
    
    client.get(f'/api/attendance-forms/by-token/{token}')
    
    # 确认
    confirm_data = {"action": "confirm"}
    response = client.put(f'/api/attendance-forms/by-token/{token}', json=confirm_data)
    assert response.status_code == 200
    data = response.get_json()
    assert data['status'] == 'employee_confirmed'
    assert data['customer_signature_token'] is not None

def test_customer_sign_flow(client, setup_data):
    sp_id, contract_id = setup_data
    token = str(sp_id)
    
    # 1. 创建并确认
    client.get(f'/api/attendance-forms/by-token/{token}')
    client.put(f'/api/attendance-forms/by-token/{token}', json={"action": "confirm"})
    
    # 获取 form 以拿到 signature_token
    form = AttendanceForm.query.filter_by(employee_id=sp_id).first()
    sig_token = form.customer_signature_token
    
    # 2. 获取签署页
    response = client.get(f'/api/attendance-forms/sign/{sig_token}')
    assert response.status_code == 200
    
    # 3. 签署
    sign_data = {
        "signature_data": {"signed_by": "Customer", "ip": "127.0.0.1"}
    }
    response = client.post(f'/api/attendance-forms/sign/{sig_token}', json=sign_data)
    assert response.status_code == 200
    data = response.get_json()
    assert data['message'] == "签署成功"
    
    # 验证状态
    form = AttendanceForm.query.get(form.id)
    assert form.status == 'synced' # 应该自动同步
    assert form.synced_to_attendance is True
    assert form.attendance_record_id is not None


def test_employee_confirmed_payload_projects_auto_overtime_as_editable_days():
    payload = {
        "status": "employee_confirmed",
        "form_data": {
            "overtime_records": [{
                "date": "2025-07-27",
                "type": "overtime",
                "startTime": "00:00",
                "endTime": "24:00",
                "hours": 120,
                "minutes": 0,
                "daysOffset": 4,
                "is_auto": True,
            }],
        },
    }

    prepared = _prepare_attendance_display_payload(payload)
    projected = prepared["form_data"]["overtime_records"]

    assert [item["date"] for item in projected] == [
        "2025-07-27", "2025-07-28", "2025-07-29", "2025-07-30", "2025-07-31",
    ]
    assert all(item[AUTO_OVERTIME_PROJECTION_KEY] is True for item in projected)
    assert all(not item.get("is_auto") for item in projected)
    assert payload["form_data"]["overtime_records"][0]["is_auto"] is True


def test_customer_signed_payload_uses_daily_auto_overtime_projection():
    payload = {
        "status": "customer_signed",
        "form_data": {
            "overtime_records": [{
                "date": "2025-07-27",
                "hours": 120,
                "minutes": 0,
                "daysOffset": 4,
                "is_auto": True,
            }],
        },
    }

    prepared = _prepare_attendance_display_payload(payload)

    assert [item["date"] for item in prepared["form_data"]["overtime_records"]] == [
        "2025-07-27", "2025-07-28", "2025-07-29", "2025-07-30", "2025-07-31",
    ]
    assert all(
        item[AUTO_OVERTIME_PROJECTION_KEY] is True
        for item in prepared["form_data"]["overtime_records"]
    )


def test_attendance_sign_payload_matches_employee_auto_overtime_projection():
    payload = {
        "status": "employee_confirmed",
        "form_data": {
            "rest_records": [{
                "date": "2025-07-28",
                "type": "rest",
                "startTime": "09:00",
                "endTime": "18:00",
                "hours": 9,
                "minutes": 0,
                "daysOffset": 0,
            }],
            "overtime_records": [
                {
                    "date": "2025-07-27",
                    "type": "overtime",
                    "startTime": "00:00",
                    "endTime": "24:00",
                    "hours": 24,
                    "minutes": 0,
                    "daysOffset": 0,
                    "is_auto": True,
                },
                {
                    "date": "2025-07-28",
                    "type": "overtime",
                    "startTime": "09:00",
                    "endTime": "24:00",
                    "hours": 87,
                    "minutes": 0,
                    "daysOffset": 3,
                    "is_auto": True,
                },
            ],
        },
    }

    display_payload = _prepare_attendance_display_payload(payload)
    projected = display_payload["form_data"]["overtime_records"]
    assert [(item["date"], item["hours"]) for item in projected] == [
        ("2025-07-27", 24),
        ("2025-07-28", 15),
        ("2025-07-29", 24),
        ("2025-07-30", 24),
        ("2025-07-31", 24),
    ]
    assert all(item.get(AUTO_OVERTIME_PROJECTION_KEY) is True for item in projected)
    assert all(item["date"] != "2025-07-26" for item in projected)


def test_recalculate_auto_overtime_on_partial_rest_day_without_shifting_date(monkeypatch):
    monkeypatch.setattr(
        "backend.services.attendance_sync_service._valid_days_for_cycle",
        lambda form, cycle_start, cycle_end: [
            date.fromordinal(cycle_start.toordinal() + offset)
            for offset in range((cycle_end - cycle_start).days + 1)
        ],
    )
    form = SimpleNamespace(
        employee_id=uuid.uuid4(),
        contract_id=uuid.uuid4(),
        contract=SimpleNamespace(type="nanny"),
        cycle_start_date=datetime(2025, 7, 1),
        cycle_end_date=datetime(2025, 7, 31),
        form_data={
            "onboarding_records": [{"date": "2025-01-01", "startTime": "00:00"}],
            "rest_records": [{
                "date": "2025-07-28",
                "type": "rest",
                "startTime": "09:00",
                "endTime": "18:00",
                "hours": 9,
                "minutes": 0,
                "daysOffset": 0,
            }],
            "overtime_records": [
                {
                    "date": "2025-07-27",
                    "hours": 24,
                    "minutes": 0,
                    "daysOffset": 0,
                    AUTO_OVERTIME_PROJECTION_KEY: True,
                },
                {
                    "date": "2025-07-26",
                    "hours": 22,
                    "minutes": 0,
                    "daysOffset": 0,
                    "is_auto": True,
                },
            ],
        },
    )

    form.form_data = strip_client_derived_auto_overtime(form.form_data)
    normalized, changed = normalize_auto_overtime_form_data(
        form,
        allow_create_missing_auto=True,
    )

    assert changed is True
    auto_records = [item for item in normalized["overtime_records"] if item.get("is_auto")]
    assert [(item["date"], item["daysOffset"]) for item in auto_records] == [
        ("2025-07-27", 0),
        ("2025-07-28", 3),
    ]
    assert auto_records[1]["startTime"] == "09:00"
    total_auto_hours = sum(
        Decimal(str(item["hours"])) + Decimal(str(item["minutes"])) / Decimal(60)
        for item in auto_records
    )
    assert total_auto_hours == Decimal(111)

    covered_dates = set()
    for item in auto_records:
        start = datetime.fromisoformat(item["date"]).date()
        covered_dates.update(
            date.fromordinal(start.toordinal() + offset).isoformat()
            for offset in range(item["daysOffset"] + 1)
        )
    assert covered_dates == {
        "2025-07-27", "2025-07-28", "2025-07-29", "2025-07-30", "2025-07-31",
    }
    assert "2025-07-26" not in covered_dates

    prepared = _prepare_attendance_display_payload({
        "status": "employee_confirmed",
        "form_data": normalized,
    })
    projected_by_date = {
        item["date"]: Decimal(str(item["hours"])) + Decimal(str(item["minutes"])) / Decimal(60)
        for item in prepared["form_data"]["overtime_records"]
    }
    assert projected_by_date == {
        "2025-07-27": Decimal(24),
        "2025-07-28": Decimal(15),
        "2025-07-29": Decimal(24),
        "2025-07-30": Decimal(24),
        "2025-07-31": Decimal(24),
    }

    normal_days, holiday_days = _split_overtime_days_by_holiday(
        normalized,
        date(2025, 7, 1),
        date(2025, 7, 31),
    )
    assert normal_days == Decimal("4.625")
    assert holiday_days == Decimal(0)
