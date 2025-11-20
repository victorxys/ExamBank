import os
import sys
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
import json

# Add backend directory to path
backend_dir = os.path.join(os.path.dirname(__file__), '..', 'backend')
sys.path.insert(0, backend_dir)

load_dotenv(os.path.join(backend_dir, '.env'))

database_url = os.getenv('DATABASE_URL')
engine = create_engine(database_url)

with engine.connect() as connection:
    result = connection.execute(text("SELECT surveyjs_schema FROM dynamic_form WHERE form_token = 'sqcCWM'"))
    row = result.fetchone()
    if row:
        schema = row[0]
        print(json.dumps(schema, indent=2, ensure_ascii=False))
    else:
        print("Form not found")
