import os
import sys
import json
import uuid
from datetime import datetime
from flask import Flask
from sqlalchemy.exc import IntegrityError

# Add project root to sys.path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.extensions import db, migrate
from backend.models import DynamicForm
from dotenv import load_dotenv

# Load environment variables from backend/.env
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'backend', '.env')
load_dotenv(dotenv_path=dotenv_path)

# Initialize Flask app for database context
app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)
migrate.init_app(app, db)

JINSHUJU_EXPORT_DIR = "jinshujuexport"

def jinshuju_to_surveyjs_converter(jinshuju_schema: dict, correct_answer_map: dict) -> dict:
    """
    Converts a Jinshuju form schema to a SurveyJS compatible schema,
    embedding correct answers and points from the provided map.
    """
    title = jinshuju_schema.get("name", "Converted Form")
    description = jinshuju_schema.get("description", "")
    surveyjs_elements = []

    for field_obj in jinshuju_schema.get("fields", []):
        if not isinstance(field_obj, dict):
            print(f"    - Skipping invalid field object (not a dict): {field_obj}")
            continue

        for field_key, field_props in field_obj.items():
            field_type = field_props.get("type")
            field_label = field_props.get("label")
            
            survey_question = {
                "name": field_label,
                "title": field_label,
                "isRequired": field_props.get("validation", {}).get("required", False),
                "visible": not field_props.get("private", False)
            }

            choices = field_props.get("choices")
            if choices:
                survey_question["choices"] = [{"value": opt["value"], "text": opt["name"]} for opt in choices]

            # --- Type Conversion Logic ---
            if field_type == "single_line_text":
                survey_question["type"] = "text"
            elif field_type == "multi_line_text" or field_type == "textarea":
                survey_question["type"] = "comment"
            elif field_type == "attachment":
                survey_question["type"] = "file"
            elif field_type == "number":
                survey_question["type"] = "text"
                survey_question["inputType"] = "number"
            elif field_type == "multiple_choice" or field_type == "multiple_select" or field_type == "checkbox":
                survey_question["type"] = "checkbox"
            elif field_type == "radio" or field_type == "single_choice":
                survey_question["type"] = "radiogroup"
            elif field_type == "drop_down_list" or field_type == "dropdown":
                survey_question["type"] = "dropdown"
            else:
                survey_question["type"] = "text"

            # --- Embed Correct Answer and Points ---
            if field_key in correct_answer_map:
                answer_details = correct_answer_map[field_key]
                survey_question["points"] = answer_details.get("score", 0)
                
                correct_answer_text = answer_details.get("correct_answer")
                if correct_answer_text and choices:
                    choice_map = {choice["name"]: choice["value"] for choice in choices}
                    
                    if survey_question["type"] == "checkbox":
                        # Handle multi-select answers (comma-separated string)
                        correct_texts = [s.strip() for s in correct_answer_text.split('，')]
                        correct_values = [choice_map[t] for t in correct_texts if t in choice_map]
                        if correct_values:
                            survey_question["correctAnswer"] = correct_values
                    else:
                        # Handle single-select answers
                        if correct_answer_text in choice_map:
                            survey_question["correctAnswer"] = choice_map[correct_answer_text]

            surveyjs_elements.append(survey_question)

    return {
        "title": title,
        "description": description,
        "pages": [{"name": "page1", "elements": surveyjs_elements}]
    }

def migrate_jinshuju_forms():
    """
    Migrates Jinshuju form structures to DynamicForm model, embedding correct answers.
    """
    with app.app_context():
        print(f"Starting Jinshuju form migration from {JINSHUJU_EXPORT_DIR}...")
        
        for filename in os.listdir(JINSHUJU_EXPORT_DIR):
            if filename.endswith("_structure.json"):
                base_name = filename.replace("_structure.json", "")
                
                if '_' in base_name:
                    jinshuju_form_name = base_name.rsplit('_', 1)[0]
                    form_token = base_name.rsplit('_', 1)[1]
                else:
                    jinshuju_form_name = base_name
                    form_token = base_name.replace(" ", "_").replace("（", "").replace("）", "").lower()

                structure_file_path = os.path.join(JINSHUJU_EXPORT_DIR, filename)
                entries_file_path = os.path.join(JINSHUJU_EXPORT_DIR, base_name + "_entries.json")
                
                print(f"Processing {filename} -> Name: '{jinshuju_form_name}', Token: '{form_token}'")
                
                try:
                    with open(structure_file_path, "r", encoding="utf-8") as f:
                        jinshuju_schema = json.load(f)

                    # --- Build Correct Answer Map from first entry (with robust checks) ---
                    correct_answer_map = {}
                    if os.path.exists(entries_file_path):
                        try:
                            with open(entries_file_path, "r", encoding="utf-8") as f:
                                entries_data = json.load(f)
                                if isinstance(entries_data, list) and len(entries_data) > 0:
                                    first_entry = entries_data[0]
                                    if isinstance(first_entry, dict):
                                        for key, value in first_entry.items():
                                            if key.endswith("_extra_value") and isinstance(value, dict):
                                                base_key = key.replace("_extra_value", "")
                                                correct_answer_map[base_key] = {
                                                    "correct_answer": value.get("correct_answer"),
                                                    "score": value.get("score")
                                                }
                        except (json.JSONDecodeError, IndexError) as e:
                            print(f"    - Warning: Could not process entries file {entries_file_path}. Reason: {e}")
                    # --- End Map Build ---

                    surveyjs_schema = jinshuju_to_surveyjs_converter(jinshuju_schema, correct_answer_map)
                    
                    exam_form_tokens = [
                        "3yOX5B", "x2biCW", "tfWGXs", "1NJPeo", "jYFQFH", "GgnClX",
                        "h0OeDy", "dIvgdf", "GzgzL6", "foY4Jq", "PlPtBt", "GiiRah"
                    ]
                    
                    form_type = "EXAM" if form_token in exam_form_tokens else "QUESTIONNAIRE"
                    
                    existing_form = DynamicForm.query.filter_by(form_token=form_token).first()

                    if existing_form:
                        print(f"DynamicForm with token '{form_token}' already exists. Updating...")
                        existing_form.name = jinshuju_form_name
                        existing_form.description = jinshuju_schema.get("description", "")
                        existing_form.surveyjs_schema = surveyjs_schema
                        existing_form.jinshuju_schema = jinshuju_schema
                        existing_form.form_type = form_type
                        existing_form.updated_at = datetime.utcnow()
                    else:
                        print(f"Creating new DynamicForm for '{jinshuju_form_name}'...")
                        new_dynamic_form = DynamicForm(
                            name=jinshuju_form_name,
                            form_token=form_token,
                            description=jinshuju_schema.get("description", ""),
                            form_type=form_type,
                            surveyjs_schema=surveyjs_schema,
                            jinshuju_schema=jinshuju_schema,
                        )
                        db.session.add(new_dynamic_form)
                    
                    db.session.commit()
                    print(f"Successfully processed {base_name}")

                except IntegrityError:
                    db.session.rollback()
                    print(f"Error: Duplicate form_token '{form_token}' for {base_name}. Skipping.")
                except Exception as e:
                    db.session.rollback()
                    print(f"Error processing {filename}: {e}")
        
        print("Jinshuju form migration completed.")

if __name__ == "__main__":
    migrate_jinshuju_forms()
