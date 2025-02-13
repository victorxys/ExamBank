import json
import psycopg2

def import_json_to_db(json_file_path, dbname, user, password, host="localhost", port="5432"):
    """
    Imports course, knowledge points, questions, options, and answers from a JSON file
    into a PostgreSQL database.

    Args:
        json_file_path (str): Path to the JSON file containing course data.
        dbname (str): Name of the PostgreSQL database.
        user (str): PostgreSQL database username.
        password (str): PostgreSQL database password.
        host (str, optional): PostgreSQL database host. Defaults to "localhost".
        port (str, optional): PostgreSQL database port. Defaults to "5432".
    """

    try:
        with open(json_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        conn = psycopg2.connect(dbname=dbname, user=user, password=password, host=host, port=port)
        cur = conn.cursor()

        course_name = data.get('course_name')
        if not course_name:
            print("Error: 'course_name' not found in JSON data.")
            return

        age_group = data.get('age_group')
        description = data.get('description')

        # Insert Course
        insert_course_query = """
            INSERT INTO TrainingCourse (course_name, age_group, description)
            VALUES (%s, %s, %s)
            RETURNING id;
        """
        cur.execute(insert_course_query, (course_name, age_group, description))
        course_id = cur.fetchone()[0]
        print(f"Course '{course_name}' imported with ID: {course_id}")

        knowledge_points = data.get('knowledge_points', [])
        for kp_data in knowledge_points:
            point_name = kp_data.get('point_name')
            kp_description = kp_data.get('description')

            # Insert Knowledge Point
            insert_kp_query = """
                INSERT INTO KnowledgePoint (course_id, point_name, description)
                VALUES (%s, %s, %s)
                RETURNING id;
            """
            cur.execute(insert_kp_query, (course_id, point_name, kp_description))
            kp_id = cur.fetchone()[0]
            print(f"  Knowledge Point '{point_name}' imported with ID: {kp_id}")

            questions = kp_data.get('questions', [])
            for q_data in questions:
                question_text = q_data.get('question_text')
                question_type = q_data.get('question_type')

                # Insert Question
                insert_question_query = """
                    INSERT INTO Question (knowledge_point_id, question_type, question_text)
                    VALUES (%s, %s, %s)
                    RETURNING id;
                """
                cur.execute(insert_question_query, (kp_id, question_type, question_text))
                question_id = cur.fetchone()[0]
                print(f"    Question '{question_text[:50]}...' imported with ID: {question_id}")

                options = q_data.get('options', [])
                for option_data in options:
                    option_text = option_data.get('option_text')
                    is_correct = option_data.get('is_correct', False)

                    # Insert Option
                    insert_option_query = """
                        INSERT INTO Option (question_id, option_text, is_correct)
                        VALUES (%s, %s, %s);
                    """
                    cur.execute(insert_option_query, (question_id, option_text, is_correct))

                answer_explanation = q_data.get('answer_explanation')
                answer_text = q_data.get('answer_text') # if answer_text is available in json


                # Insert Answer
                insert_answer_query = """
                    INSERT INTO Answer (question_id, answer_text, explanation)
                    VALUES (%s, %s, %s);
                """
                cur.execute(insert_answer_query, (question_id, answer_text, answer_explanation))


        conn.commit()
        print("Data import completed successfully!")

    except FileNotFoundError:
        print(f"Error: JSON file not found at path: {json_file_path}")
    except json.JSONDecodeError:
        print(f"Error: Invalid JSON format in file: {json_file_path}")
    except psycopg2.Error as e:
        conn.rollback()
        print(f"Database Error: {e}")
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

if __name__ == "__main__":
    json_file = '../resource/7-12month.json'  # Replace with your JSON file path
    db_name = 'ExamDB'      # Replace with your database name
    db_user = 'postgres'      # Replace with your database user
    db_password = 'xys131313' # Replace with your database password
    db_host = 'localhost'         # Replace if your database is not on localhost
    db_port = '5432'              # Replace if your database port is not 5432

    import_json_to_db(json_file, db_name, db_user, db_password, db_host, db_port)