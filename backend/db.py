import psycopg2
from dotenv import load_dotenv
import os
load_dotenv()

def get_db_connection():
    conn = psycopg2.connect(
        host="localhost",
        database="ExamDB",
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'postgres')
    )
    conn.set_client_encoding('UTF8')
    return conn