from flask import Flask, request, jsonify
from flask_cors import CORS
import psycopg2
import psycopg2.extras
import random
import json
from datetime import datetime, timedelta

app = Flask(__name__)
CORS(app)

# 数据库连接配置
DB_CONFIG = {
    'dbname': 'examdb',
    'user': 'postgres',
    'password': 'postgres',
    'host': 'localhost'
}

def get_db_connection():
    conn = psycopg2.connect(**DB_CONFIG)
    return conn

# 课程管理API
@app.route('/api/courses', methods=['GET'])
def get_courses():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('SELECT * FROM courses ORDER BY created_at DESC')
    courses = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([dict(course) for course in courses])

@app.route('/api/courses', methods=['POST'])
def create_course():
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute(
        'INSERT INTO courses (name, description) VALUES (%s, %s) RETURNING *',
        (data['name'], data.get('description'))
    )
    course = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(dict(course))

# 知识点管理API
@app.route('/api/courses/<int:course_id>/knowledge-points', methods=['GET'])
def get_knowledge_points(course_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('SELECT * FROM knowledge_points WHERE course_id = %s', (course_id,))
    points = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([dict(point) for point in points])

@app.route('/api/knowledge-points', methods=['POST'])
def create_knowledge_point():
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute(
        'INSERT INTO knowledge_points (course_id, content, description) VALUES (%s, %s, %s) RETURNING *',
        (data['course_id'], data['content'], data.get('description'))
    )
    point = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(dict(point))

# 题目管理API
@app.route('/api/knowledge-points/<int:point_id>/questions', methods=['GET'])
def get_questions(point_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute('SELECT * FROM questions WHERE knowledge_point_id = %s', (point_id,))
    questions = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([dict(question) for question in questions])

@app.route('/api/questions', methods=['POST'])
def create_question():
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute(
        '''INSERT INTO questions 
           (knowledge_point_id, type, content, options, correct_answers, explanation, source) 
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *''',
        (data['knowledge_point_id'], data['type'], data['content'], 
         json.dumps(data['options']), json.dumps(data['correct_answers']),
         data.get('explanation'), data.get('source'))
    )
    question = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(dict(question))

# 试卷管理API
@app.route('/api/exams', methods=['POST'])
def create_exam():
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 创建试卷
    cur.execute(
        '''INSERT INTO exams (title, course_id, duration, total_score) 
           VALUES (%s, %s, %s, %s) RETURNING *''',
        (data['title'], data['course_id'], data['duration'], data['total_score'])
    )
    exam = cur.fetchone()
    
    # 随机选择题目
    selected_questions = []
    for point_id, count in data['question_distribution'].items():
        cur.execute(
            'SELECT id FROM questions WHERE knowledge_point_id = %s ORDER BY RANDOM() LIMIT %s',
            (point_id, count)
        )
        selected_questions.extend(cur.fetchall())
    
    # 添加试卷题目
    for order, question in enumerate(selected_questions, 1):
        cur.execute(
            '''INSERT INTO exam_questions (exam_id, question_id, score, question_order)
               VALUES (%s, %s, %s, %s)''',
            (exam['id'], question['id'], data['per_question_score'], order)
        )
    
    conn.commit()
    cur.close()
    conn.close()
    return jsonify(dict(exam))

# 学生验证码API
@app.route('/api/verification-code', methods=['POST'])
def send_verification_code():
    data = request.get_json()
    phone = data['phone']
    code = ''.join(random.choices('0123456789', k=6))
    expires_at = datetime.now() + timedelta(minutes=5)
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # 删除旧的验证码
    cur.execute('DELETE FROM verification_codes WHERE phone = %s', (phone,))
    
    # 插入新验证码
    cur.execute(
        'INSERT INTO verification_codes (phone, code, expires_at) VALUES (%s, %s, %s)',
        (phone, code, expires_at)
    )
    
    conn.commit()
    cur.close()
    conn.close()
    
    # TODO: 实际发送验证码到手机
    # 这里先返回验证码，实际生产环境中应该通过短信服务发送
    return jsonify({'message': '验证码已发送', 'code': code})

# 学生登录API
@app.route('/api/login', methods=['POST'])
def student_login():
    data = request.get_json()
    phone = data['phone']
    code = data['code']
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 验证码验证
    cur.execute(
        '''SELECT * FROM verification_codes 
           WHERE phone = %s AND code = %s AND expires_at > %s''',
        (phone, code, datetime.now())
    )
    verification = cur.fetchone()
    
    if not verification:
        return jsonify({'error': '验证码无效或已过期'}), 400
    
    # 获取或创建学生账号
    cur.execute('SELECT * FROM students WHERE phone = %s', (phone,))
    student = cur.fetchone()
    
    if not student:
        cur.execute(
            'INSERT INTO students (phone) VALUES (%s) RETURNING *',
            (phone,)
        )
        student = cur.fetchone()
    
    conn.commit()
    cur.close()
    conn.close()
    
    return jsonify(dict(student))

# 考试API
@app.route('/api/exams/<int:exam_id>/start', methods=['POST'])
def start_exam():
    data = request.get_json()
    student_id = data['student_id']
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 创建考试记录
    cur.execute(
        '''INSERT INTO exam_records 
           (student_id, exam_id, start_time, status) 
           VALUES (%s, %s, %s, 'in_progress') RETURNING *''',
        (student_id, exam_id, datetime.now())
    )
    record = cur.fetchone()
    
    # 获取试卷题目
    cur.execute(
        '''SELECT q.*, eq.score, eq.question_order 
           FROM exam_questions eq 
           JOIN questions q ON eq.question_id = q.id 
           WHERE eq.exam_id = %s 
           ORDER BY eq.question_order''',
        (exam_id,)
    )
    questions = cur.fetchall()
    
    conn.commit()
    cur.close()
    conn.close()
    
    return jsonify({
        'record': dict(record),
        'questions': [dict(q) for q in questions]
    })

@app.route('/api/exam-records/<int:record_id>/submit', methods=['POST'])
def submit_exam():
    data = request.get_json()
    answers = data['answers']  # {question_id: answer}
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 获取考试记录
    cur.execute('SELECT * FROM exam_records WHERE id = %s', (record_id,))
    record = cur.fetchone()
    
    total_score = 0
    # 记录每道题的答案和得分
    for question_id, student_answer in answers.items():
        # 获取题目信息和分值
        cur.execute(
            '''SELECT q.*, eq.score 
               FROM questions q 
               JOIN exam_questions eq ON q.id = eq.question_id 
               WHERE q.id = %s AND eq.exam_id = %s''',
            (question_id, record['exam_id'])
        )
        question = cur.fetchone()
        
        # 判断答案是否正确
        correct_answers = question['correct_answers']
        is_correct = set(student_answer) == set(correct_answers)
        score = question['score'] if is_correct else 0
        total_score += score
        
        # 记录答案
        cur.execute(
            '''INSERT INTO answer_records 
               (exam_record_id, question_id, student_answer, is_correct, score) 
               VALUES (%s, %s, %s, %s, %s)''',
            (record_id, question_id, json.dumps(student_answer), is_correct, score)
        )
    
    # 更新考试记录
    cur.execute(
        '''UPDATE exam_records 
           SET end_time = %s, score = %s, status = 'completed', updated_at = %s 
           WHERE id = %s RETURNING *''',
        (datetime.now(), total_score, datetime.now(), record_id)
    )
    updated_record = cur.fetchone()
    
    # 获取错题解析
    cur.execute(
        '''SELECT ar.*, q.content, q.explanation, q.correct_answers 
           FROM answer_records ar 
           JOIN questions q ON ar.question_id = q.id 
           WHERE ar.exam_record_id = %s AND ar.is_correct = false''',
        (record_id,)
    )
    wrong_answers = cur.fetchall()
    
    conn.commit()
    cur.close()
    conn.close()
    
    return jsonify({
        'record': dict(updated_record),
        'wrong_answers': [dict(wa) for wa in wrong_answers]
    })

if __name__ == '__main__':
    app.run(debug=True)
