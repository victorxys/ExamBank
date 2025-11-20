import pytest
import json
import uuid
from backend.models import DynamicForm, DynamicFormData, ServicePersonnel, User
from flask_jwt_extended import create_access_token

def test_get_form_data_with_association(client, db_session):
    """
    Tests the GET /api/form-data/<uuid:data_id> endpoint, specifically verifying
    that the 'record_association' logic correctly resolves and embeds associated
    record data.
    """
    # 1. Arrange: Use existing user for authentication
    test_user = db_session.query(User).filter_by(phone_number='15810903753').one()
    assert test_user is not None, "The test user with phone number 15810903753 was not found in the database."

    # Create a ServicePersonnel record to be the target of the association
    associated_personnel = ServicePersonnel(
        name='Associated Person',
        phone_number=f'12345678901-{uuid.uuid4()}',
        id_card_number=f'123456789012345678-{uuid.uuid4()}'
    )
    db_session.add(associated_personnel)
    db_session.flush() # Flush to get the ID

    # Define a form schema with a record_association question
    form_schema = {
        "pages": [{
            "name": "page1",
            "elements": [{
                "type": "record_association",
                "name": "associated_personnel_question",
                "title": "Select Associated Personnel",
                "association_config": {
                    "target_model": "ServicePersonnel"
                }
            }]
        }]
    }

    # Create the DynamicForm
    dynamic_form = DynamicForm(
        name="Test Association Form",
        form_token=f"test_association_form_{uuid.uuid4()}",
        surveyjs_schema=form_schema
    )
    db_session.add(dynamic_form)
    db_session.flush() # Flush to get the ID

    # Create the DynamicFormData, linking to the form and the associated personnel
    form_data_payload = {
        "associated_personnel_question": str(associated_personnel.id),
        "other_data": "some value"
    }
    
    form_data = DynamicFormData(
        form_id=dynamic_form.id,
        user_id=test_user.id,
        data=form_data_payload
    )
    db_session.add(form_data)
    db_session.flush() # Flush to get the ID

    # Generate a JWT token for the test user
    access_token = create_access_token(identity=str(test_user.id))
    headers = {
        'Authorization': f'Bearer {access_token}'
    }

    # 2. Act: Make a GET request to the endpoint
    response = client.get(f'/api/form-data/{form_data.id}', headers=headers)

    # 3. Assert: Check the response
    assert response.status_code == 200
    
    response_json = response.get_json()
    
    # Check that the base data is correct
    assert response_json['id'] == str(form_data.id)
    assert response_json['data']['other_data'] == 'some value'
    
    # Check that the association was resolved correctly
    assert 'resolved_associations' in response_json
    resolved = response_json['resolved_associations']
    
    assert 'associated_personnel_question' in resolved
    associated_data = resolved['associated_personnel_question']
    
    assert associated_data['id'] == str(associated_personnel.id)
    assert associated_data['name'] == 'Associated Person'


def test_submit_form_data_creates_service_personnel_and_links(client, db_session):
    """
    Tests the POST /api/form-data/submit/<uuid:form_id> endpoint, verifying
    that sync_mapping correctly creates a new ServicePersonnel record and links it.
    """
    # 1. Arrange
    test_user = db_session.query(User).filter_by(phone_number='15810903753').one()
    assert test_user is not None, "The test user with phone number 15810903753 was not found in the database."

    # Define sync_mapping for ServicePersonnel
    sync_mapping = {
        "ServicePersonnel": {
            "model": "ServicePersonnel",
            "lookup_field": "phone_number",
            "mappings": [
                {"form_field": "employee_name", "target_field": "name"},
                {"form_field": "employee_phone", "target_field": "phone_number"},
                {"form_field": "employee_id_card", "target_field": "id_card_number"}
            ]
        }
    }

    # Create a DynamicForm with this sync_mapping
    dynamic_form = DynamicForm(
        name="Employee Registration",
        form_token=f"employee_reg_form_{uuid.uuid4()}",
        surveyjs_schema={"pages": [{"elements": []}]}, # Minimal schema
        sync_mapping=sync_mapping
    )
    db_session.add(dynamic_form)
    db_session.flush() # Use flush to get ID

    # Generate JWT token for the user
    access_token = create_access_token(identity=str(test_user.id))
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # Prepare form data payload
    form_data_payload = {
        "data": {
            "employee_name": "Jane Doe",
            "employee_phone": f"13987654321-{uuid.uuid4()}",
            "employee_id_card": f"987654321098765432-{uuid.uuid4()}",
            "other_form_field": "some value"
        }
    }

    # 2. Act
    response = client.post(
        f'/api/form-data/submit/{dynamic_form.id}',
        headers=headers,
        data=json.dumps(form_data_payload)
    )

    # 3. Assert
    assert response.status_code == 201
    response_json = response.get_json()
    assert 'id' in response_json
    new_form_data_id = uuid.UUID(response_json['id'])

    # Fetch the created DynamicFormData from DB
    created_form_data = db_session.query(DynamicFormData).get(new_form_data_id)
    assert created_form_data is not None
    assert created_form_data.form_id == dynamic_form.id
    assert created_form_data.user_id == test_user.id
    assert created_form_data.data == form_data_payload['data']
    assert created_form_data.service_personnel_id is not None

    # Fetch the created ServicePersonnel from DB
    created_personnel = db_session.query(ServicePersonnel).get(created_form_data.service_personnel_id)
    assert created_personnel is not None
    assert created_personnel.name == "Jane Doe"
    assert created_personnel.phone_number == form_data_payload['data']['employee_phone']
    assert created_personnel.id_card_number == form_data_payload['data']['employee_id_card']

    # Verify only one ServicePersonnel record was created with this phone number
    all_personnel = db_session.query(ServicePersonnel).filter_by(phone_number=form_data_payload['data']['employee_phone']).all()
    assert len(all_personnel) == 1


def test_update_form_data_updates_service_personnel_and_links(client, db_session):
    """
    Tests the PATCH /api/form-data/<uuid:data_id> endpoint, verifying
    that sync_mapping correctly updates an existing ServicePersonnel record and maintains the link.
    """
    # 1. Arrange
    test_user = db_session.query(User).filter_by(phone_number='15810903753').one()
    assert test_user is not None, "The test user with phone number 15810903753 was not found in the database."

    # Create initial ServicePersonnel
    initial_personnel = ServicePersonnel(
        name='Original Name',
        phone_number=f'13911112222-{uuid.uuid4()}',
        id_card_number=f'111111111111111111-{uuid.uuid4()}'
    )
    db_session.add(initial_personnel)
    db_session.flush() # Flush to get ID

    # Define sync_mapping
    sync_mapping = {
        "ServicePersonnel": {
            "model": "ServicePersonnel",
            "lookup_field": "phone_number",
            "mappings": [
                {"form_field": "employee_name", "target_field": "name"},
                {"form_field": "employee_phone", "target_field": "phone_number"},
                {"form_field": "employee_id_card", "target_field": "id_card_number"}
            ]
        }
    }

    # Create a DynamicForm with this sync_mapping
    dynamic_form = DynamicForm(
        name="Employee Update Form",
        form_token=f"employee_update_form_{uuid.uuid4()}",
        surveyjs_schema={"pages": [{"elements": []}]}, # Minimal schema
        sync_mapping=sync_mapping
    )
    db_session.add(dynamic_form)
    db_session.flush() # Flush to get ID

    # Create initial DynamicFormData linked to the personnel
    initial_form_data = DynamicFormData(
        form_id=dynamic_form.id,
        user_id=test_user.id,
        data={
            "employee_name": "Original Name",
            "employee_phone": initial_personnel.phone_number,
            "employee_id_card": initial_personnel.id_card_number,
            "some_other_field": "initial value"
        },
        service_personnel_id=initial_personnel.id
    )
    db_session.add(initial_form_data)
    db_session.flush() # Use flush to get IDs

    # Generate JWT token for the user
    access_token = create_access_token(identity=str(test_user.id))
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }

    # Prepare updated form data payload
    updated_id_card = f"222222222222222222-{uuid.uuid4()}"
    updated_form_data_payload = {
        "data": {
            "employee_name": "Updated Name",
            "employee_phone": initial_personnel.phone_number, # Same phone number for lookup
            "employee_id_card": updated_id_card, # Updated ID card
            "some_other_field": "updated value"
        }
    }

    # 2. Act
    response = client.patch(
        f'/api/form-data/{initial_form_data.id}',
        headers=headers,
        data=json.dumps(updated_form_data_payload)
    )

    # 3. Assert
    assert response.status_code == 200
    response_json = response.get_json()
    assert 'id' in response_json
    assert uuid.UUID(response_json['id']) == initial_form_data.id

    # Fetch the updated DynamicFormData from DB
    updated_form_data = db_session.query(DynamicFormData).get(initial_form_data.id)
    assert updated_form_data is not None
    assert updated_form_data.data == updated_form_data_payload['data']
    assert updated_form_data.service_personnel_id == initial_personnel.id # Should remain linked to the same personnel

    # Fetch the ServicePersonnel from DB
    updated_personnel = db_session.query(ServicePersonnel).get(initial_personnel.id)
    assert updated_personnel is not None
    assert updated_personnel.name == "Updated Name"
    assert updated_personnel.phone_number == initial_personnel.phone_number
    assert updated_personnel.id_card_number == updated_id_card

    # Verify no new ServicePersonnel records were created
    all_personnel = db_session.query(ServicePersonnel).filter_by(phone_number=initial_personnel.phone_number).all()
    assert len(all_personnel) == 1
