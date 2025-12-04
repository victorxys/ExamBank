import pytest
from backend.models import db, AttendanceForm, BaseContract, ServicePersonnel, User
from datetime import date, datetime
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
