
from backend.app import app
from backend.models import DynamicFormData, DynamicForm
import json

def inspect_form_data(form_token):
    with app.app_context():
        # Find the form definition first
        form_def = DynamicForm.query.filter_by(form_token=form_token).first()
        if not form_def:
            print(f"Form definition not found for token: {form_token}")
            return

        # Find a record for this form
        record = DynamicFormData.query.filter_by(form_id=form_def.id).first()
        if record:
            print(f"--- Form: {form_token} ({form_def.name}) ---")
            schema = form_def.jinshuju_schema
            
            if not schema:
                print("Schema is empty")
                return

            print(f"Schema type: {type(schema)}")
            if isinstance(schema, dict) and "fields" in schema:
                fields = schema["fields"]
                print(f"Fields type: {type(fields)}")
                # If fields is a list (which is common for Jinshuju)
                if isinstance(fields, list):
                    for field_item in fields:
                        if not isinstance(field_item, dict):
                            continue
                        for key, value in field_item.items():
                            if isinstance(value, dict):
                                label = value.get("label", "")
                                print(f"{key}: {label}")
                # If fields is a dict
                elif isinstance(fields, dict):
                     for key, value in fields.items():
                        if isinstance(value, dict):
                            label = value.get("label", "")
                            print(f"{key}: {label}")
        else:
            print(f"No data found for form {form_token}")

if __name__ == "__main__":
    inspect_form_data("N0Il9H") # Entry Form
    inspect_form_data("wWVDjd") # Exit Summary
