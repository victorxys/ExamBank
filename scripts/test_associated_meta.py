#!/usr/bin/env python3
import sys
import os

# Add backend directory to path
backend_dir = os.path.join(os.path.dirname(__file__), '..', 'backend')
sys.path.insert(0, backend_dir)

from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, '.env'))

from extensions import db
from models import DynamicForm
from app import create_app
import json

app = create_app()

with app.app_context():
    form = DynamicForm.query.filter_by(form_token='Iqltzj').first()
    
    if not form:
        print("Form not found!")
        sys.exit(1)
    
    print("=== Form Found ===")
    print(f"Name: {form.name}")
    print(f"Token: {form.form_token}")
    
    # Check for form_association fields
    associated_form_meta = {}
    
    if form.jinshuju_schema and 'fields' in form.jinshuju_schema:
        print("\n=== Checking for form_association fields ===")
        for field_wrapper in form.jinshuju_schema['fields']:
            for field_id, field_def in field_wrapper.items():
                if field_def.get('type') == 'form_association':
                    print(f"\nFound form_association: {field_id}")
                    print(f"  Label: {field_def.get('label')}")
                    
                    associated_token = field_def.get('associated_form_token')
                    display_fields = field_def.get('display_field_settings', [])
                    
                    print(f"  Associated token: {associated_token}")
                    print(f"  Display fields: {[df.get('api_code') for df in display_fields]}")
                    
                    if associated_token and display_fields:
                        associated_form = DynamicForm.query.filter_by(form_token=associated_token).first()
                        
                        if associated_form:
                            print(f"  Associated form found: {associated_form.name}")
                            
                            if associated_form.jinshuju_schema:
                                field_meta = {}
                                
                                for assoc_field_wrapper in associated_form.jinshuju_schema.get('fields', []):
                                    for assoc_field_id, assoc_field_def in assoc_field_wrapper.items():
                                        if any(df.get('api_code') == assoc_field_id for df in display_fields):
                                            field_meta[assoc_field_id] = {
                                                'label': assoc_field_def.get('label', ''),
                                                'type': assoc_field_def.get('type', '')
                                            }
                                            print(f"    {assoc_field_id}: {assoc_field_def.get('label')} ({assoc_field_def.get('type')})")
                                
                                associated_form_meta[field_id] = {
                                    'associated_token': associated_token,
                                    'fields': field_meta
                                }
                        else:
                            print(f"  WARNING: Associated form '{associated_token}' not found in database!")
    
    print("\n=== Final associated_form_meta ===")
    print(json.dumps(associated_form_meta, indent=2, ensure_ascii=False))
