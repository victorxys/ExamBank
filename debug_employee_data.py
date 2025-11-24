
from backend.app import app
from backend.models import ServicePersonnel, DynamicFormData, DynamicForm
import json

def inspect_employee_data(employee_id):
    with app.app_context():
        employee = ServicePersonnel.query.get(employee_id)
        if not employee:
            print(f"Employee {employee_id} not found")
            return

        print(f"Checking data for: {employee.name} ({employee.phone_number})")
        
        # Entry Form Token
        ENTRY_FORM_TOKEN = "N0Il9H"
        form_def = DynamicForm.query.filter_by(form_token=ENTRY_FORM_TOKEN).first()
        
        if form_def:
            print(f"--- Dumping Schema for Form {ENTRY_FORM_TOKEN} ---")
            schema = form_def.jinshuju_schema
            with open("schema_dump.txt", "w") as f:
                if isinstance(schema, dict) and "fields" in schema:
                    for field in schema["fields"]:
                        for k, v in field.items():
                            if isinstance(v, dict) and "label" in v:
                                f.write(f"{k}: {v['label']}\n")
            print("Schema dumped to schema_dump.txt")
            return # Stop here
            
            # Search by phone in field_2
            # record = DynamicFormData.query.filter(
            #    DynamicFormData.form_id == form_def.id,
            #    DynamicFormData.data['field_2'].astext == employee.phone_number
            # ).order_by(DynamicFormData.created_at.desc()).first()
            
            if record:
                data = record.data
                print(f"--- Entry Form Data ({ENTRY_FORM_TOKEN}) ---")
                print(f"field_5 (Value): {data.get('field_5')}")
                # Check schema for field_5 label
                field_5_def = next((f for f in form_def.jinshuju_schema.get('fields', []) if f.get('field_5')), None)
                if field_5_def:
                     print(f"field_5 (Label): {field_5_def['field_5'].get('label')}")

                print(f"field_14 (Join Date?): {data.get('field_14')}")
                print(f"field_12 (Height?): {data.get('field_12')}")
                print(f"field_13 (Weight?): {data.get('field_13')}")
                
                print(f"field_33 (Zodiac): {data.get('field_33')}")
                print(f"field_16 (Education): {data.get('field_16')}")
                print(f"field_31 (Height - Old): {data.get('field_31')}")
                print(f"field_32 (Weight - Old): {data.get('field_32')}")
                
                # Print all keys to see if we missed anything
                # print("\nAll Data Keys:")
                # for k, v in data.items():
                #     print(f"{k}: {v}")
            else:
                print(f"No entry form record found for phone {employee.phone_number}")
        else:
            print(f"Form definition {ENTRY_FORM_TOKEN} not found")

if __name__ == "__main__":
    inspect_employee_data("444d36dd-209a-4f97-a326-e5adc2222d18")
