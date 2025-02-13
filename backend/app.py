from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        database=os.getenv('DB_NAME', 'examdb'),
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', '')
    )

@app.route('/api/courses', methods=['GET'])
def get_courses():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                c.*,
                COUNT(DISTINCT kp.id) as total_points,
                COUNT(DISTINCT q.id) as total_questions
            FROM TrainingCourse c
            LEFT JOIN KnowledgePoint kp ON c.id = kp.course_id
            LEFT JOIN Question q ON kp.id = q.knowledge_point_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        ''')
        courses = cur.fetchall()
        return jsonify(courses)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['GET'])
def get_course(course_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                c.*,
                COUNT(DISTINCT kp.id) as total_points,
                COUNT(DISTINCT q.id) as total_questions
            FROM TrainingCourse c
            LEFT JOIN KnowledgePoint kp ON c.id = kp.course_id
            LEFT JOIN Question q ON kp.id = q.knowledge_point_id
            WHERE c.id = %s
            GROUP BY c.id
        ''', (course_id,))
        course = cur.fetchone()
        if course is None:
            return jsonify({'error': 'Course not found'}), 404
        return jsonify(course)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>/knowledge_points', methods=['GET'])
def get_course_knowledge_points(course_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                kp.*,
                COUNT(q.id) as total_questions
            FROM KnowledgePoint kp
            LEFT JOIN Question q ON kp.id = q.knowledge_point_id
            WHERE kp.course_id = %s
            GROUP BY kp.id
            ORDER BY kp.created_at DESC
        ''', (course_id,))
        points = cur.fetchall()
        return jsonify(points)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>/questions', methods=['GET'])
def get_knowledge_point_questions(point_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取题目信息，按id排序
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                q.difficulty,
                q.knowledge_point_id,
                q.created_at,
                q.updated_at,
                a.answer_text,
                a.explanation,
                a.source,
                kp.course_id
            FROM Question q
            LEFT JOIN Answer a ON q.id = a.question_id
            LEFT JOIN KnowledgePoint kp ON q.knowledge_point_id = kp.id
            WHERE q.knowledge_point_id = %s
            ORDER BY q.id ASC
        ''', (point_id,))
        questions = cur.fetchall()
        
        # 获取每个题目的选项，按id排序
        for question in questions:
            cur.execute('''
                SELECT id, option_text, is_correct
                FROM Option
                WHERE question_id = %s
                ORDER BY id ASC
            ''', (question['id'],))
            question['options'] = cur.fetchall()
            
            # 获取课程下所有知识点（用于编辑时选择）
            cur.execute('''
                SELECT id, point_name
                FROM KnowledgePoint
                WHERE course_id = %s
                ORDER BY created_at DESC
            ''', (question['course_id'],))
            question['available_knowledge_points'] = cur.fetchall()
            
        return jsonify(questions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['GET'])
def get_question(question_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取题目基本信息
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                q.difficulty,
                q.knowledge_point_id,
                q.created_at,
                q.updated_at,
                a.answer_text,
                a.explanation,
                a.source,
                kp.course_id
            FROM Question q
            LEFT JOIN Answer a ON q.id = a.question_id
            LEFT JOIN KnowledgePoint kp ON q.knowledge_point_id = kp.id
            WHERE q.id = %s
        ''', (question_id,))
        question = cur.fetchone()
        
        if question is None:
            return jsonify({'error': '题目不存在'}), 404
            
        # 获取题目选项
        cur.execute('''
            SELECT id, option_text, is_correct
            FROM Option
            WHERE question_id = %s
            ORDER BY id ASC
        ''', (question_id,))
        question['options'] = cur.fetchall()
        
        # 获取课程下所有知识点（用于编辑时选择）
        cur.execute('''
            SELECT id, point_name
            FROM KnowledgePoint
            WHERE course_id = %s
            ORDER BY created_at DESC
        ''', (question['course_id'],))
        question['available_knowledge_points'] = cur.fetchall()
        
        return jsonify(question)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['PUT'])
def update_question(question_id):
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 更新题目基本信息
        cur.execute('''
            UPDATE Question 
            SET question_text = %s,
                question_type = %s,
                difficulty = %s,
                knowledge_point_id = %s
            WHERE id = %s
            RETURNING id
        ''', (
            data['question_text'],
            data['question_type'],
            data['difficulty'],
            data['knowledge_point_id'],
            question_id
        ))
        
        # 更新答案和解析
        cur.execute('''
            INSERT INTO Answer (question_id, answer_text, explanation, source)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (question_id) 
            DO UPDATE SET 
                answer_text = EXCLUDED.answer_text,
                explanation = EXCLUDED.explanation,
                source = EXCLUDED.source
        ''', (
            question_id,
            data['answer_text'],
            data['explanation'],
            data['source']
        ))
        
        # 获取现有选项及其顺序
        cur.execute('SELECT id, option_text FROM Option WHERE question_id = %s ORDER BY id ASC', (question_id,))
        existing_options = cur.fetchall()
        
        # 创建选项id到新数据的映射
        option_updates = {}
        for option in data['options']:
            if 'id' in option:
                option_updates[option['id']] = option
        
        # 更新现有选项
        for existing in existing_options:
            if existing['id'] in option_updates:
                option = option_updates[existing['id']]
                cur.execute('''
                    UPDATE Option 
                    SET option_text = %s,
                        is_correct = %s
                    WHERE id = %s
                ''', (
                    option['option_text'],
                    option['is_correct'],
                    existing['id']
                ))
                # 从待处理选项中移除已处理的
                del option_updates[existing['id']]
        
        # 添加新选项（处理没有id的选项）
        for option in data['options']:
            if 'id' not in option:
                cur.execute('''
                    INSERT INTO Option (question_id, option_text, is_correct)
                    VALUES (%s, %s, %s)
                ''', (
                    question_id,
                    option['option_text'],
                    option['is_correct']
                ))
        
        # 删除不再存在的选项
        existing_ids = {opt['id'] for opt in existing_options}
        updated_ids = {opt['id'] for opt in data['options'] if 'id' in opt}
        ids_to_delete = existing_ids - updated_ids
        
        if ids_to_delete:
            cur.execute('''
                DELETE FROM Option 
                WHERE question_id = %s AND id = ANY(%s)
            ''', (
                question_id,
                list(ids_to_delete)
            ))
        
        conn.commit()
        return jsonify({'message': '更新成功'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    app.run(debug=True)
