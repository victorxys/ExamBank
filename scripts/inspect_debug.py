import os
import sys
import json
from flask import Flask
from sqlalchemy import text

# Add project root to sys.path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.extensions import db
from backend.models import DynamicForm, DynamicFormData
from dotenv import load_dotenv

# dotenv_path = os.path.join(project_root, 'backend', '.env')
# load_dotenv(dotenv_path=dotenv_path)
from backend.app import app

def inspect_data():
    with app.app_context():
        form_token = 'N0Il9H'
        # entry_id = '0042f64a-131b-4474-a974-4c01b52305ec'
        entry_id = "858879e9-de60-485e-8281-f77a33fc3687"
        
        form = DynamicForm.query.filter_by(form_token=form_token).first()
        if not form:
            print("Form not found")
            return

        # entry = DynamicFormData.query.filter_by(id=entry_id).first()
        entry = db.session.get(DynamicFormData, entry_id)
        if not entry:
            print(f"Entry {entry_id} not found.")
            return

        print(f"Entry ID: {entry.id}")
        print(f"Form ID: {entry.form_id}")
        
        # Check for potential file fields (usually contain 'image' or 'file' or are long strings)
        for key, value in entry.data.items():
            str_val = str(value)
            if len(str_val) > 100:
                print(f"Key: {key}, Value Length: {len(str_val)}")
                if "base64" in str_val:
                    print(f"  -> CONTAINS BASE64!")
                elif "http" in str_val:
                    print(f"  -> Contains URL: {str_val[:100]}...")
            
        # Check Jinshuju Schema for specific fields
        # We need to find fields for: Name, Phone, ID Card
        # Based on previous dumps:
        # field_1: 张学鑫 (Name?)
        # field_2: 13469833988 (Phone?)
        # field_93: 420525198402021429 (ID Card?)
        
        target_fields = ['field_4', 'field_92', 'field_5']
        jinshuju_schema = form.jinshuju_schema
        
        expected_titles = [
            "身份证照片",
            "健康证（北京食品健康证、幽门螺旋杆菌、妇科传染性疾病）",
            "入职时照片或生活照一张"
        ]
        
        keys = list(entry.data.keys())
        print("--- Checking for expected titles ---")
        for title in expected_titles:
            if title in keys:
                print(f"FOUND Title: {title}")
                print(f"Value: {entry.data[title]}")
            else:
                print(f"MISSING Title: {title}")
                
        # Also print all keys for reference
        # print(json.dumps(keys, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    inspect_data()
