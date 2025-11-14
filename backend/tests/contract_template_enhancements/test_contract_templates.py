import pytest
from datetime import datetime, timedelta
from backend.models import db, ContractTemplate
from flask import url_for
import uuid
import time # Added for updated_at test

# Assuming client fixture is available from conftest.py
# Assuming auth_headers fixture is available from conftest.py

@pytest.fixture
def auth_headers(client):
    # This fixture should be provided by your conftest.py
    # For testing purposes, let's assume a simple admin user login
    # You might need to adjust this based on your actual authentication setup
    # Example:
    # client.post('/api/auth/login', json={'username': 'admin', 'password': 'password'})
    # return {'Authorization': 'Bearer <your_token>'}
    # For now, returning a placeholder.
    return {"Authorization": "Bearer test_token"} # Replace with actual token if needed

@pytest.fixture
def create_test_templates(app):
    with app.app_context():
        # Clear existing templates to ensure a clean state for tests
        db.session.query(ContractTemplate).delete()
        db.session.commit()

        template1 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Template A",
            contract_type="nanny",
            content="Content for Template A v1",
            version=1,
            created_at=datetime.utcnow() - timedelta(days=2),
            updated_at=datetime.utcnow() - timedelta(days=2)
        )
        template2 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Template B",
            contract_type="maternity_nurse",
            content="Content for Template B v1",
            version=1,
            created_at=datetime.utcnow() - timedelta(days=3),
            updated_at=datetime.utcnow() - timedelta(days=3)
        )
        template3 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Template A",
            contract_type="nanny",
            content="Content for Template A v2",
            version=2,
            created_at=datetime.utcnow() - timedelta(days=1),
            updated_at=datetime.utcnow() - timedelta(days=1)
        )
        template4 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Template C",
            contract_type="nanny_trial",
            content="Content for Template C v1",
            version=1,
            created_at=datetime.utcnow() - timedelta(days=4),
            updated_at=datetime.utcnow() - timedelta(days=4)
        )

        db.session.add_all([template1, template2, template3, template4])
        db.session.commit()
        return [template1, template2, template3, template4]

def test_get_all_contract_templates_includes_expected_fields_and_sorted(client, auth_headers, create_test_templates):
    """
    测试获取所有合同模板列表，确认返回字段正确且排序符合预期。
    """
    response = client.get(url_for('contract_template_api.get_all_contract_templates'), headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()

    assert isinstance(data, list)
    assert len(data) == 4

    # Check fields and content exclusion
    for template_data in data:
        assert "id" in template_data
        assert "template_name" in template_data
        assert "contract_type" in template_data
        assert "version" in template_data
        assert "created_at" in template_data
        assert "updated_at" in template_data
        assert "content" not in template_data # Ensure content is not included

    # Check sorting: by template_name asc, then version desc
    # Expected order: Template A v2, Template A v1, Template B v1, Template C v1
    assert data[0]["template_name"] == "Template A"
    assert data[0]["version"] == 2
    assert data[1]["template_name"] == "Template A"
    assert data[1]["version"] == 1
    assert data[2]["template_name"] == "Template B"
    assert data[2]["version"] == 1
    assert data[3]["template_name"] == "Template C"
    assert data[3]["version"] == 1

def test_get_all_contract_templates_no_templates(client, auth_headers, app):
    """
    测试数据库中没有模板时，返回空列表。
    """
    with app.app_context():
        db.session.query(ContractTemplate).delete()
        db.session.commit()

    response = client.get(url_for('contract_template_api.get_all_contract_templates'), headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()
    assert isinstance(data, list)
    assert len(data) == 0

def test_get_all_contract_templates_unauthorized(client, app):
    """
    测试未授权访问时，返回401。
    """
    # No auth_headers passed
    response = client.get(url_for('contract_template_api.get_all_contract_templates'))
    assert response.status_code == 401
    assert "Missing Authorization Header" in response.get_json()["msg"]

from backend.models import BaseContract # Import BaseContract for testing usage

@pytest.fixture
def create_contract_referencing_template(app, create_test_templates):
    with app.app_context():
        template_in_use = create_test_templates[0] # Use an existing template
        contract = BaseContract(
            id=uuid.uuid4(),
            customer_name="Test Customer",
            contact_person="Contact",
            start_date=datetime.utcnow(),
            end_date=datetime.utcnow() + timedelta(days=30),
            type="nanny",
            template_id=template_in_use.id, # Reference the template
            template_content="Contract content referencing template"
        )
        db.session.add(contract)
        db.session.commit()
        return contract, template_in_use

def test_is_template_in_use_true(client, auth_headers, create_contract_referencing_template):
    """
    测试当模板被合同时，is_in_use 接口返回 True。
    """
    contract, template_in_use = create_contract_referencing_template
    response = client.get(url_for('contract_template_api.is_template_in_use', template_id=template_in_use.id), headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()
    assert data["is_in_use"] is True

def test_is_template_in_use_false(client, auth_headers, create_test_templates):
    """
    测试当模板未被合同时，is_in_use 接口返回 False。
    """
    template_not_in_use = ContractTemplate(
        id=uuid.uuid4(),
        template_name="Unused Template",
        contract_type="nanny",
        content="Content for unused template",
        version=1
    )
    with client.application.app_context():
        db.session.add(template_not_in_use)
        db.session.commit()

    response = client.get(url_for('contract_template_api.is_template_in_use', template_id=template_not_in_use.id), headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()
    assert data["is_in_use"] is False

def test_is_template_in_use_template_not_found(client, auth_headers):
    """
    测试当模板ID不存在时，is_in_use 接口返回 404。
    """
    non_existent_id = uuid.uuid4()
    response = client.get(url_for('contract_template_api.is_template_in_use', template_id=non_existent_id), headers=auth_headers)
    assert response.status_code == 404
    assert "合同模板未找到" in response.get_json()["error"]

def test_is_template_in_use_unauthorized(client):
    """
    测试未授权访问 is_in_use 接口时，返回 401。
    """
    # Assuming a valid template ID exists for the URL, though it won't be checked due to 401
    dummy_template_id = uuid.uuid4()
    response = client.get(url_for('contract_template_api.is_template_in_use', template_id=dummy_template_id))
    assert response.status_code == 401
    assert "Missing Authorization Header" in response.get_json()["msg"]

def test_save_new_version_contract_template_success(client, auth_headers, app):
    """
    测试成功将合同模板另存为新版本。
    """
    with app.app_context():
        # Create an initial template
        original_template = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Test Template for New Version",
            contract_type="nanny",
            content="Original content v1",
            version=1
        )
        db.session.add(original_template)
        db.session.commit()
        original_id = original_template.id

        # Create another version of the same template name to ensure max_version logic works
        template_v2 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Test Template for New Version",
            contract_type="nanny",
            content="Original content v2",
            version=2
        )
        db.session.add(template_v2)
        db.session.commit()

    response = client.post(url_for('contract_template_api.save_new_version_contract_template', template_id=original_id), headers=auth_headers)
    assert response.status_code == 201
    data = response.get_json()

    assert data["message"] == "合同模板另存为新版本成功"
    assert data["template_name"] == "Test Template for New Version"
    assert data["contract_type"] == "nanny"
    assert data["content"] == "Original content v1" # Content should be copied from original_template
    assert data["version"] == 3 # Should be max_version (2) + 1

    with app.app_context():
        # Verify new template exists in DB
        new_template_db = db.session.query(ContractTemplate).filter_by(id=uuid.UUID(data["id"])).first()
        assert new_template_db is not None
        assert new_template_db.version == 3
        assert new_template_db.template_name == "Test Template for New Version"
        assert new_template_db.content == "Original content v1"

        # Verify original template is unchanged
        original_template_db = db.session.query(ContractTemplate).filter_by(id=original_id).first()
        assert original_template_db.version == 1 # Original template's version should remain 1

def test_save_new_version_contract_template_not_found(client, auth_headers):
    """
    测试另存为新版本时，原始模板ID不存在，返回404。
    """
    non_existent_id = uuid.uuid4()
    response = client.post(url_for('contract_template_api.save_new_version_contract_template', template_id=non_existent_id), headers=auth_headers)
    assert response.status_code == 404
    assert "原始合同模板未找到" in response.get_json()["error"]

def test_save_new_version_contract_template_unauthorized(client):
    """
    测试未授权访问另存为新版本接口时，返回401。
    """
    dummy_template_id = uuid.uuid4()
    response = client.post(url_for('contract_template_api.save_new_version_contract_template', template_id=dummy_template_id))
    assert response.status_code == 401
    assert "Missing Authorization Header" in response.get_json()["msg"]

def test_get_template_diff_success(client, auth_headers, app):
    """
    测试成功获取合同模板与上一版本的内容差异。
    """
    with app.app_context():
        template_v1 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Diff Test Template",
            contract_type="nanny",
            content="Content for v1",
            version=1
        )
        template_v2 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Diff Test Template",
            contract_type="nanny",
            content="Content for v2",
            version=2
        )
        db.session.add_all([template_v1, template_v2])
        db.session.commit()

    response = client.get(url_for('contract_template_api.get_contract_template_diff', template_id=template_v2.id), headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()

    assert data["current_version"] == 2
    assert data["current_content"] == "Content for v2"
    assert data["previous_version"] == 1
    assert data["previous_content"] == "Content for v1"

def test_get_template_diff_version_one(client, auth_headers, app):
    """
    测试获取版本1模板的差异时，返回400。
    """
    with app.app_context():
        template_v1 = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Diff Test Template V1",
            contract_type="nanny",
            content="Content for v1",
            version=1
        )
        db.session.add(template_v1)
        db.session.commit()

    response = client.get(url_for('contract_template_api.get_contract_template_diff', template_id=template_v1.id), headers=auth_headers)
    assert response.status_code == 400
    assert "版本1没有上一版本可供对比" in response.get_json()["error"]

def test_get_template_diff_template_not_found(client, auth_headers):
    """
    测试获取不存在模板的差异时，返回404。
    """
    non_existent_id = uuid.uuid4()
    response = client.get(url_for('contract_template_api.get_contract_template_diff', template_id=non_existent_id), headers=auth_headers)
    assert response.status_code == 404
    assert "合同模板未找到" in response.get_json()["error"]

def test_get_template_diff_previous_version_not_found(client, auth_headers, app):
    """
    测试获取差异时，上一版本不存在，返回404。
    """
    with app.app_context():
        template_v2_only = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Diff Test Template V2 Only",
            contract_type="nanny",
            content="Content for v2 only",
            version=2
        )
        db.session.add(template_v2_only)
        db.session.commit()

    response = client.get(url_for('contract_template_api.get_contract_template_diff', template_id=template_v2_only.id), headers=auth_headers)
    assert response.status_code == 404
    assert "未找到上一版本模板" in response.get_json()["error"]

def test_get_template_diff_unauthorized(client):
    """
    测试未授权访问差异接口时，返回401。
    """
    dummy_template_id = uuid.uuid4()
    response = client.get(url_for('contract_template_api.get_contract_template_diff', template_id=dummy_template_id))
    assert response.status_code == 401
    assert "Missing Authorization Header" in response.get_json()["msg"]

def test_update_contract_template_updates_updated_at(client, auth_headers, app):
    """
    测试更新合同模板时，updated_at 字段会自动更新。
    """
    with app.app_context():
        template = ContractTemplate(
            id=uuid.uuid4(),
            template_name="Update Test Template",
            contract_type="nanny",
            content="Initial content",
            version=1
        )
        db.session.add(template)
        db.session.commit()
        initial_updated_at = template.updated_at

    # Wait a bit to ensure updated_at will be different
    time.sleep(0.1)

    update_data = {
        "content": "Updated content"
    }
    response = client.put(url_for('contract_template_api.update_contract_template', template_id=template.id), json=update_data, headers=auth_headers)
    assert response.status_code == 200
    data = response.get_json()

    # Verify updated_at in response is newer
    response_updated_at = datetime.fromisoformat(data["updated_at"])
    assert response_updated_at > initial_updated_at

    with app.app_context():
        # Retrieve from DB to confirm
        updated_template = db.session.query(ContractTemplate).filter_by(id=template.id).first()
        assert updated_template.updated_at > initial_updated_at
        assert updated_template.content == "Updated content"