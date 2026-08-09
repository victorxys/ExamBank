import pytest
from backend.api import attendance_form_api
from backend.models import (
    db,
    AttendanceForm,
    BaseContract,
    ServicePersonnel,
    TrialOutcome,
    User,
)
from backend.api.miniapp_api import _prepare_attendance_display_payload
from backend.services.attendance_sync_service import (
    AUTO_OVERTIME_PROJECTION_KEY,
    _split_overtime_days_by_holiday,
    normalize_auto_overtime_form_data,
    strip_client_derived_auto_overtime,
)
from backend.services.dify_beautify_service import enforce_beautify_payload_contract
from backend.services.payment_message_generator import (
    PaymentMessageGenerator,
    _duration_display,
)
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace
import uuid


def test_bill_beautify_attendance_preserves_hours_and_three_decimal_days(monkeypatch):
    bill = SimpleNamespace(
        actual_work_days=Decimal("26.000"),
        calculation_details={
            "base_work_days": "26.000",
            "overtime_days": "4.917",
        },
        cycle_start_date=datetime(2026, 7, 1),
        cycle_end_date=datetime(2026, 7, 31),
    )
    attendance = SimpleNamespace(
        total_days_worked=Decimal("26.00"),
        overtime_days=Decimal("4.917"),
        attendance_details={
            "rest_days": 2 / 24,
            "overtime_days": 118 / 24,
            "raw_data": {
                "rest_records": [
                    {"date": "2026-07-28", "hours": 2, "minutes": 0}
                ],
                "overtime_records": [
                    {"date": "2026-07-27", "hours": 24, "minutes": 0},
                    {
                        "date": "2026-07-28",
                        "hours": 94,
                        "minutes": 0,
                        "daysOffset": 3,
                    },
                ],
            },
        },
    )
    generator = PaymentMessageGenerator.__new__(PaymentMessageGenerator)
    monkeypatch.setattr(generator, "_attendance_for_bill", lambda _bill: attendance)

    metrics = generator._attendance_metrics(bill)

    assert metrics["worked_days"] == Decimal("26.000")
    assert metrics["rest_hours"].quantize(Decimal("0.01")) == Decimal("2.00")
    assert metrics["rest_days"].quantize(Decimal("0.001")) == Decimal("0.083")
    assert metrics["overtime_hours"].quantize(Decimal("0.01")) == Decimal("118.00")
    assert metrics["overtime_days"] == Decimal("4.917")
    assert _duration_display(metrics["overtime_hours"]) == "4天22小时"
    assert _duration_display(Decimal("168")) == "7天"
    assert _duration_display(Decimal("26.5")) == "1天2小时30分钟"


def _bill_beautify_payload():
    return {
        "schema_version": "bill_beautify_v2",
        "company_bills": [],
        "employee_bills": [
            {
                "employee_name": "刘燕风",
                "service_start": "2026-07-01",
                "service_end": "2026-07-31",
                "attendance": {
                    "worked_days_display": "26",
                    "rest": {
                        "duration_display": "2小时",
                        "total_hours": "2.00",
                        "calculation_days": "0.083",
                        "calculation_days_display": "0.083",
                        "show_calculation_days": True,
                    },
                    "overtime": {
                        "duration_display": "4天22小时",
                        "total_hours": "118.00",
                        "calculation_days": "4.917",
                        "calculation_days_display": "4.917",
                        "show_calculation_days": True,
                    },
                },
                "payable_days": "30.917",
                "payable_days_display": "30.917",
                "salary_base_display": "10100",
                "formula_total_display": "12010.00",
                "pending_amount_display": "12010.00",
                "bank_account": {
                    "holder": "刘燕风",
                    "account": "TEST-ACCOUNT",
                    "bank": "测试银行",
                },
                "miniapp_url": "https://wxmpurl.cn/test-link",
            }
        ],
    }


def test_bill_beautify_falls_back_when_model_rounds_days_and_drops_link():
    parsed = {
        "company_beautified": "",
        "employee_beautified": (
            "刘燕风“劳务费”\n"
            "服务周期: 2026-07-01 ~ 2026-07-31\n"
            "出勤26天，加班5天\n"
            "💰 本次您需支付员工款项: 12010.00元"
        ),
    }

    result = enforce_beautify_payload_contract(parsed, _bill_beautify_payload())

    assert (
        "出勤26天，加班4天22小时（4.917天），休息2小时（0.083天）"
        in result["employee_beautified"]
    )
    assert "费用共30.917天×(10100元÷ 26天) =12010.00元" in result["employee_beautified"]
    assert "12010.00元" in result["employee_beautified"]
    assert "https://wxmpurl.cn/test-link" in result["employee_beautified"]


def test_bill_beautify_keeps_complete_model_result():
    complete = (
        "刘燕风“劳务费”\n"
        "服务周期: 2026-07-01 ~ 2026-07-31\n"
        "出勤26天，加班4天22小时（4.917天），休息2小时（0.083天）\n"
        "费用共30.917天×(10100元÷ 26天) =12010.00元\n"
        "💰 本次您需支付员工款项: 12010.00元\n"
        "\n"
        "户名：刘燕风\n"
        "帐号：TEST-ACCOUNT\n"
        "银行：测试银行\n"
        "\n"
        "客户小程序工资单（点击打开）:\n"
        "https://wxmpurl.cn/test-link"
    )
    parsed = {"company_beautified": "", "employee_beautified": complete}

    result = enforce_beautify_payload_contract(parsed, _bill_beautify_payload())

    assert result["employee_beautified"] == complete


def test_bill_beautify_removes_model_invented_zero_calculation_line():
    complete_with_zero_line = (
        "刘燕风“劳务费”\n"
        "服务周期: 2026-07-01 ~ 2026-07-31\n"
        "出勤26天，加班4天22小时（4.917天），休息2小时（0.083天）\n"
        "费用共30.917天×(10100元÷ 26天) =12010.00元\n"
        "加班费: 级别(10100.00) / 26 * 加班天数(0.000) = 0.00\n"
        "💰 本次您需支付员工款项: 12010.00元\n"
        "户名：刘燕风\n"
        "帐号：TEST-ACCOUNT\n"
        "银行：测试银行\n"
        "https://wxmpurl.cn/test-link"
    )

    result = enforce_beautify_payload_contract(
        {
            "company_beautified": "",
            "employee_beautified": complete_with_zero_line,
        },
        _bill_beautify_payload(),
    )

    assert "加班费:" not in result["employee_beautified"]
    assert "本次您需支付员工款项: 12010.00元" in result["employee_beautified"]


def test_bill_beautify_rejects_nonzero_legacy_calculation_detail():
    verbose = (
        "刘燕风“劳务费”\n"
        "服务周期: 2026-07-01 ~ 2026-07-31\n"
        "出勤26天，加班4天22小时（4.917天），休息2小时（0.083天）\n"
        "基础劳务费: 级别(10100.00) / 26 * 基本劳务天数(26.000) = 10100.00\n"
        "费用共30.917天×(10100元÷ 26天) =12010.00元\n"
        "💰 本次您需支付员工款项: 12010.00元\n\n"
        "户名：刘燕风\n"
        "帐号：TEST-ACCOUNT\n"
        "银行：测试银行\n\n"
        "客户小程序工资单（点击打开）:\n"
        "https://wxmpurl.cn/test-link"
    )

    result = enforce_beautify_payload_contract(
        {"company_beautified": "", "employee_beautified": verbose},
        _bill_beautify_payload(),
    )

    assert "基础劳务费:" not in result["employee_beautified"]
    assert "费用共30.917天×(10100元÷ 26天) =12010.00元" in result["employee_beautified"]


def test_bill_beautify_omits_zero_segments_and_fraction_for_whole_days():
    payload = _bill_beautify_payload()
    item = payload["employee_bills"][0]
    item["attendance"]["overtime"] = {
        "duration_display": "5天",
        "total_hours": "120.00",
        "calculation_days": "5.000",
        "calculation_days_display": "5",
        "show_calculation_days": False,
    }
    item["attendance"]["rest"] = {
        "duration_display": "0小时",
        "total_hours": "0.00",
        "calculation_days": "0.000",
        "calculation_days_display": "0",
        "show_calculation_days": False,
    }
    item["payable_days"] = "31.000"
    item["payable_days_display"] = "31"

    result = enforce_beautify_payload_contract(
        {"company_beautified": "", "employee_beautified": ""},
        payload,
    )

    assert "出勤26天，加班5天" in result["employee_beautified"]
    assert "加班5天（5天）" not in result["employee_beautified"]
    assert "休息" not in result["employee_beautified"]
    assert "费用共31天×" in result["employee_beautified"]


def test_bill_beautify_management_fee_fallback_is_compact_and_complete():
    payload = {
        "schema_version": "bill_beautify_v2",
        "company_bills": [
            {
                "display_mode": "management_fee_only",
                "customer_name": "许静",
                "service_start": "2026-08-01",
                "service_end": "2026-08-31",
                "pending_amount_display": "800.00",
                "bank_account": {
                    "holder": "北京家福安家政服务有限公司",
                    "account": "TEST-COMPANY-ACCOUNT",
                    "bank": "测试公司银行",
                },
            }
        ],
        "employee_bills": [],
    }
    parsed = {
        "company_beautified": "许静“管理费”\n服务周期: 2026-08-01 ~ 2026-08-31",
        "employee_beautified": "",
    }

    result = enforce_beautify_payload_contract(parsed, payload)

    assert result["company_beautified"] == (
        "许静“管理费”\n"
        "服务周期: 2026-08-01 ~ 2026-08-31\n"
        "应付：800.00元\n\n"
        "户名：北京家福安家政服务有限公司\n"
        "帐号：TEST-COMPANY-ACCOUNT\n"
        "银行：测试公司银行"
    )


def test_trial_conversion_is_continuous_when_service_periods_overlap():
    trial_id = uuid.uuid4()
    trial = SimpleNamespace(
        id=trial_id,
        type="nanny_trial",
        trial_outcome=TrialOutcome.SUCCESS,
        start_date=datetime(2026, 6, 27),
        end_date=datetime(2026, 7, 4),
    )
    formal = SimpleNamespace(
        source_trial_contract_id=trial_id,
        start_date=datetime(2026, 6, 27),
        end_date=datetime(2026, 7, 31),
    )

    assert attendance_form_api.is_continuous_trial_conversion(trial, formal) is True


def test_trial_conversion_is_not_continuous_after_service_gap():
    trial_id = uuid.uuid4()
    trial = SimpleNamespace(
        id=trial_id,
        type="nanny_trial",
        trial_outcome=TrialOutcome.SUCCESS,
        start_date=datetime(2026, 6, 20),
        end_date=datetime(2026, 6, 27),
    )
    formal = SimpleNamespace(
        source_trial_contract_id=trial_id,
        start_date=datetime(2026, 7, 1),
        end_date=datetime(2026, 7, 31),
    )

    assert attendance_form_api.is_continuous_trial_conversion(trial, formal) is False


def test_confirmed_auto_overtime_change_resyncs_signed_attendance(monkeypatch):
    form = SimpleNamespace(
        id=uuid.uuid4(),
        status="synced",
        form_data={"overtime_records": []},
    )
    commits = []
    synced_form_ids = []

    monkeypatch.setattr(
        attendance_form_api,
        "normalize_auto_overtime_form_data",
        lambda current_form, allow_create_missing_auto: (
            {"overtime_records": [{"date": "2026-06-19", "is_auto": True}]},
            True,
        ),
    )
    monkeypatch.setattr(attendance_form_api, "flag_modified", lambda *args: None)
    monkeypatch.setattr(
        attendance_form_api,
        "current_app",
        SimpleNamespace(logger=SimpleNamespace(info=lambda *args: None)),
    )
    monkeypatch.setattr(attendance_form_api.db.session, "commit", lambda: commits.append(True))
    monkeypatch.setattr(
        attendance_form_api,
        "sync_attendance_to_record",
        lambda form_id: synced_form_ids.append(form_id),
    )

    changed = attendance_form_api.ensure_confirmed_auto_overtime(form)

    assert changed is True
    assert commits == [True]
    assert synced_form_ids == [form.id]


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
