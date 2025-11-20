import os
import json
import sys
import uuid
from datetime import datetime
from flask import Flask
from sqlalchemy.exc import IntegrityError

# Add project root to Python path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.extensions import db
from backend.models import DynamicForm, DynamicFormData
from dotenv import load_dotenv

# Load environment variables from backend/.env
dotenv_path = os.path.join(project_root, 'backend', '.env')
load_dotenv(dotenv_path=dotenv_path)

# Initialize Flask app for database context
app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)

JINSHUJU_EXPORT_DIR = "jinshujuexport"

def migrate_jinshuju_entries():
    """
    Migrates Jinshuju form entries to the DynamicFormData model.
    This script performs a "raw" import, placing the original Jinshuju entry
    JSON directly into the 'data' column, preserving all 'field_x' keys.
    """
    with app.app_context():
        print("Clearing existing DynamicFormData entries...")
        try:
            num_deleted = db.session.query(DynamicFormData).delete()
            db.session.commit()
            print(f"Successfully deleted {num_deleted} existing entries.")
        except Exception as e:
            db.session.rollback()
            print(f"Error clearing table: {e}", file=sys.stderr)
            return

        print(f"Starting Jinshuju entry migration from {JINSHUJU_EXPORT_DIR}...")

        all_files = os.listdir(JINSHUJU_EXPORT_DIR)
        entry_files = [f for f in all_files if f.endswith("_entries.json")]

        for filename in entry_files:
            form_token_base = filename.replace("_entries.json", "")
            entries_file_path = os.path.join(JINSHUJU_EXPORT_DIR, filename)
            
            print(f"\nProcessing entries for form: {form_token_base}")

            try:
                with open(entries_file_path, "r", encoding="utf-8") as f:
                    jinshuju_entries = json.load(f)
                
                # Extract form_token based on the new rule: part after the last '_'
                if '_' in form_token_base:
                    form_token = form_token_base.split('_')[-1]
                else:
                    form_token = form_token_base
                
                dynamic_form = DynamicForm.query.filter_by(form_token=form_token).first()

                if not dynamic_form:
                    print(f"Warning: No DynamicForm found for form_token '{form_token}'. Skipping.")
                    continue

                # Helper to flatten address objects
                def flatten_address(value):
                    if isinstance(value, dict) and any(k in value for k in ['province', 'city', 'district', 'street']):
                        parts = [value.get(k) for k in ['province', 'city', 'district', 'street']]
                        return " ".join([p for p in parts if p])
                    return value

                new_entries = []
                for entry in jinshuju_entries:
                    if not isinstance(entry, dict):
                        continue

                    # Pre-process entry to flatten address objects
                    processed_entry = entry.copy()
                    for k, v in processed_entry.items():
                        if isinstance(v, dict):
                            processed_entry[k] = flatten_address(v)

                    total_score = entry.get('exam_score')

                    new_form_data = DynamicFormData(
                        id=uuid.uuid4(),
                        form_id=dynamic_form.id,
                        data=processed_entry,  # Store the processed entry
                        score=total_score,
                        result_details=None, # Do not populate result_details anymore
                        created_at=datetime.fromisoformat(entry['created_at'].replace('Z', '+00:00')) if 'created_at' in entry else datetime.utcnow(),
                        updated_at=datetime.fromisoformat(entry['updated_at'].replace('Z', '+00:00')) if 'updated_at' in entry else datetime.utcnow(),
                    )
                    new_entries.append(new_form_data)
                
                if new_entries:
                    db.session.bulk_save_objects(new_entries)
                    db.session.commit()
                    print(f"Successfully processed and imported {len(new_entries)} entries for {form_token_base}")
                else:
                    print("No entries to import.")

            except Exception as e:
                db.session.rollback()
                print(f"Error processing file {filename}: {e}", file=sys.stderr)
        
        print("\nJinshuju entry migration completed.")

if __name__ == "__main__":
    migrate_jinshuju_entries()
