# backend/db.py
import psycopg2
import os
import logging
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)
handler = logging.FileHandler('/Users/victor/development/ExamBank/logs/flask.log')
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
log.addHandler(handler)

def get_db_connection():
    try:
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
        conn.set_client_encoding('UTF8')
        log.info("Database connection established successfully.")
        return conn
    except Exception as e:
        log.exception("Failed to connect to the database:")
        raise  # 重新抛出异常，以便上层处理