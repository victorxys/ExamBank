from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv
import uuid
from dateutil import parser
import logging

load_dotenv()

app = Flask(__name__)
CORS(app)

# Create a logger
logger = logging.getLogger(__name__)

def get_db_connection():
    conn = psycopg2.connect(
        host="localhost",
        database="ExamDB",
        user=os.getenv('DB_USER', 'postgres'),
        password=os.getenv('DB_PASSWORD', 'postgres')
    )
    conn.set_client_encoding('UTF8')
    return conn

@app.route('/api/courses', methods=['GET'])
def get_courses():
    print("开始获取课程列表")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 修改查询，只返回有题目的课程
        cur.execute('''
            SELECT DISTINCT
                c.id,
                c.course_name,
                c.age_group,
                c.description,
                c.created_at,
                c.updated_at,
                COUNT(DISTINCT kp.id) as knowledge_point_count,
                COUNT(DISTINCT q.id) as question_count
            FROM trainingcourse c
            LEFT JOIN knowledgepoint kp ON kp.course_id = c.id
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE q.id IS NOT NULL
            GROUP BY c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at
            ORDER BY c.created_at DESC
        ''')
        courses = cur.fetchall()
        print("SQL查询结果：", courses)
        return jsonify(courses)
    except Exception as e:
        print('Error in get_courses:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses', methods=['POST'])
def create_course():
    print("开始创建课程")
    data = request.get_json()
    if not data or 'course_name' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            INSERT INTO trainingcourse (
                course_name,
                age_group,
                description
            ) VALUES (%s, %s, %s)
            RETURNING id, course_name, age_group, description, created_at, updated_at
        ''', (
            data['course_name'],
            data.get('age_group', ''),
            data.get('description', '')
        ))
        new_course = cur.fetchone()
        print("创建课程结果：", new_course)
        conn.commit()
        return jsonify(new_course)
    except Exception as e:
        conn.rollback()
        print('Error in create_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['GET'])
def get_course(course_id):
    print("开始获取课程详情，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                c.id,
                c.course_name,
                c.age_group,
                c.description,
                c.created_at,
                c.updated_at,
                COUNT(DISTINCT kp.id) as total_points,
                COUNT(DISTINCT q.id) as total_questions
            FROM trainingcourse c
            LEFT JOIN knowledgepoint kp ON c.id = kp.course_id
            LEFT JOIN question q ON kp.id = q.knowledge_point_id
            WHERE c.id = %s
            GROUP BY c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at
        ''', (course_id,))
        course = cur.fetchone()
        print("SQL查询结果：", course)
        if course is None:
            return jsonify({'error': 'Course not found'}), 404
        return jsonify(course)
    except Exception as e:
        print('Error in get_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>/knowledge_points', methods=['GET'])
def get_course_knowledge_points(course_id):
    print("开始获取课程知识点，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                kp.id,
                kp.point_name,
                kp.description,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) as question_count
            FROM knowledgepoint kp
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE kp.course_id = %s
            GROUP BY kp.id, kp.point_name, kp.description, kp.created_at, kp.updated_at
            ORDER BY kp.created_at DESC
        ''', (course_id,))
        points = cur.fetchall()
        print("SQL查询结果：", points)
        return jsonify(points)
    except Exception as e:
        print("Error in get_course_knowledge_points:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['GET'])
def get_knowledge_point(point_id):
    print("开始获取知识点详情，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT 
                kp.id,
                kp.point_name,
                kp.description,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) as total_questions
            FROM knowledgepoint kp
            LEFT JOIN question q ON kp.id = q.knowledge_point_id
            WHERE kp.id = %s
            GROUP BY kp.id, kp.point_name, kp.description, kp.created_at, kp.updated_at
        ''', (point_id,))
        point = cur.fetchone()
        print("SQL查询结果：", point)
        if point is None:
            return jsonify({'error': 'Knowledge point not found'}), 404
        return jsonify(point)
    except Exception as e:
        print("Error in get_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>/questions', methods=['GET'])
def get_knowledge_point_questions(point_id):
    print("开始获取知识点题目，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取题目信息，按创建时间降序排序，再按ID升序排序
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                epq.id as exam_paper_question_id,
                json_agg(json_build_object(
                    'id', o.id,
                    'content', o.option_text,
                    'is_correct', o.is_correct
                )) as options
            FROM question q
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN option o ON q.id = o.question_id
            WHERE q.knowledge_point_id = %s
            ORDER BY q.created_at DESC, q.id ASC
        ''', (point_id,))
        questions = cur.fetchall()
        print("SQL查询结果：", questions)
        
        # 获取每个题目的选项，按id排序
        for question in questions:
            cur.execute('''
                SELECT id, option_text, is_correct
                FROM option
                WHERE question_id = %s
                ORDER BY id ASC
            ''', (question['id'],))
            question['options'] = cur.fetchall()
            
            # 获取课程下所有知识点（用于编辑时选择）
            cur.execute('''
                SELECT id, point_name
                FROM knowledgepoint
                WHERE course_id = %s
                ORDER BY created_at DESC
            ''', (question['course_id'],))
            question['available_knowledge_points'] = cur.fetchall()
            
        return jsonify(questions)
    except Exception as e:
        print("Error in get_knowledge_point_questions:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['GET'])
def get_question(question_id):
    print("开始获取题目详情，题目ID：", question_id)
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
            FROM question q
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            WHERE q.id = %s
        ''', (question_id,))
        question = cur.fetchone()
        print("SQL查询结果：", question)
        
        if question is None:
            return jsonify({'error': '题目不存在'}), 404
            
        # 获取题目选项
        cur.execute('''
            SELECT id, option_text, is_correct
            FROM option
            WHERE question_id = %s
            ORDER BY id ASC
        ''', (question_id,))
        question['options'] = cur.fetchall()
        
        # 获取课程下所有知识点（用于编辑时选择）
        cur.execute('''
            SELECT id, point_name
            FROM knowledgepoint
            WHERE course_id = %s
            ORDER BY created_at DESC
        ''', (question['course_id'],))
        question['available_knowledge_points'] = cur.fetchall()
        
        return jsonify(question)
    except Exception as e:
        print("Error in get_question:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['PUT'])
def update_question(question_id):
    print("开始更新题目，题目ID：", question_id)
    data = request.json
    print("更新数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否存在
        cur.execute('SELECT id FROM question WHERE id = %s::uuid', (question_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Question not found'}), 404

        # 更新题目基本信息
        cur.execute('''
            UPDATE question 
            SET question_text = %s,
                question_type = %s,
                difficulty = %s,
                knowledge_point_id = %s
            WHERE id = %s::uuid
            RETURNING id, question_text, question_type, difficulty, knowledge_point_id
        ''', (
            data['question_text'],
            data['question_type'],
            data.get('difficulty', 3),
            data['knowledge_point_id'],
            question_id
        ))
        question = cur.fetchone()
        print("更新题目结果：", question)

        # 更新答案信息
        cur.execute('''
            UPDATE answer 
            SET answer_text = %s,
                explanation = %s,
                source = %s
            WHERE question_id = %s::uuid
            RETURNING answer_text, explanation, source
        ''', (
            data.get('answer_text', ''),
            data.get('explanation', ''),
            data.get('source', ''),
            question_id
        ))
        answer = cur.fetchone()
        if answer:
            question.update(answer)

        # 删除旧选项
        cur.execute('DELETE FROM option WHERE question_id = %s::uuid', (question_id,))
        
        # 插入新选项
        question['options'] = []
        if 'options' in data and isinstance(data['options'], list):
            for option in data['options']:
                if not isinstance(option, dict) or 'option_text' not in option:
                    continue
                cur.execute('''
                    INSERT INTO option (
                        question_id,
                        option_text,
                        is_correct
                    ) VALUES (%s, %s, %s)
                    RETURNING id, option_text, is_correct
                ''', (
                    question_id,
                    option['option_text'],
                    option.get('is_correct', False)
                ))
                question['options'].append(cur.fetchone())

        conn.commit()
        return jsonify(question)
    except Exception as e:
        conn.rollback()
        print(f"Error updating question: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions', methods=['POST'])
def create_question():
    print("开始创建题目")
    data = request.json
    print("创建数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查必需字段
        required_fields = ['question_text', 'question_type', 'knowledge_point_id']
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # 插入新题目
        cur.execute('''
            INSERT INTO question (
                question_text,
                question_type,
                difficulty,
                knowledge_point_id
            ) VALUES (%s, %s, %s, %s)
            RETURNING id, question_text, question_type, difficulty, knowledge_point_id
        ''', (
            data['question_text'],
            data['question_type'],
            data.get('difficulty', 3),
            data['knowledge_point_id']
        ))
        question = cur.fetchone()
        print("创建题目结果：", question)
        
        # 插入答案信息
        cur.execute('''
            INSERT INTO answer (
                question_id,
                answer_text,
                explanation,
                source
            ) VALUES (%s, %s, %s, %s)
            RETURNING answer_text, explanation, source
        ''', (
            question['id'],
            data.get('answer_text', ''),
            data.get('explanation', ''),
            data.get('source', '')
        ))
        answer = cur.fetchone()
        question.update(answer)
        
        # 插入选项
        if 'options' in data and isinstance(data['options'], list):
            question['options'] = []
            for option in data['options']:
                if not isinstance(option, dict) or 'option_text' not in option:
                    continue
                cur.execute('''
                    INSERT INTO option (
                        question_id,
                        option_text,
                        is_correct
                    ) VALUES (%s, %s, %s)
                    RETURNING id, option_text, is_correct
                ''', (
                    question['id'],
                    option['option_text'],
                    option.get('is_correct', False)
                ))
                question['options'].append(cur.fetchone())
            print("创建选项结果：", question['options'])
        else:
            question['options'] = []
        
        conn.commit()
        return jsonify(question), 201
    except ValueError as e:
        conn.rollback()
        print(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        print(f"Error creating question: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/questions/<question_id>', methods=['DELETE'])
def delete_question(question_id):
    print("开始删除题目，题目ID：", question_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 首先删除题目的选项
        cur.execute('DELETE FROM option WHERE question_id = %s', (question_id,))
        
        # 删除题目的答案
        cur.execute('DELETE FROM answer WHERE question_id = %s', (question_id,))
        
        # 最后删除题目本身
        cur.execute('DELETE FROM question WHERE id = %s RETURNING id', (question_id,))
        deleted = cur.fetchone()
        
        if deleted is None:
            return jsonify({'error': 'Question not found'}), 404
            
        conn.commit()
        return jsonify({'message': 'Question deleted successfully', 'id': question_id})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams', methods=['GET'])
def get_exams():
    print("开始获取考试列表")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取考卷信息和相关的课程信息
        cur.execute('''
            WITH examquestioncounts AS (
                SELECT 
                    epq.exam_paper_id,
                    COUNT(CASE WHEN q.question_type = '单选题' THEN 1 END) as single_count,
                    COUNT(CASE WHEN q.question_type = '多选题' THEN 1 END) as multiple_count
                FROM exampaperquestion epq
                JOIN question q ON epq.question_id = q.id
                GROUP BY epq.exam_paper_id
            ),
            examcourses AS (
                SELECT DISTINCT
                    ep.id as exam_id,
                    array_agg(DISTINCT tc.course_name) as course_names
                FROM exampaper ep
                JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
                JOIN trainingcourse tc ON epc.course_id = tc.id
                GROUP BY ep.id
            )
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                ep.updated_at,
                COALESCE(eqc.single_count, 0) as single_count,
                COALESCE(eqc.multiple_count, 0) as multiple_count,
                COALESCE(ec.course_names, ARRAY[]::text[]) as course_names
            FROM exampaper ep
            LEFT JOIN examquestioncounts eqc ON ep.id = eqc.exam_paper_id
            LEFT JOIN examcourses ec ON ep.id = ec.exam_id
            ORDER BY ep.created_at DESC
        ''')
        exams = cur.fetchall()
        print("SQL查询结果：", exams)
        return jsonify(exams)
    except Exception as e:
        print('Error in get_exams:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams', methods=['POST'])
def create_exam():
    print("开始创建考试")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.get_json()
        print("创建数据：", data)
        
        title = data.get('title')
        description = data.get('description', '')
        course_ids = data.get('course_ids', [])  # 从前端直接接收课程ID列表
        point_ids = data.get('point_ids', [])
        single_count = data.get('single_count', 0)
        multiple_count = data.get('multiple_count', 0)

        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
        if not course_ids:
            return jsonify({'error': '请选择至少一个课程'}), 400
        if not point_ids:
            return jsonify({'error': '请选择至少一个知识点'}), 400
        if single_count == 0 and multiple_count == 0:
            return jsonify({'error': '请设置要抽取的题目数量'}), 400

        print(f"Creating exam with {len(course_ids)} courses and {len(point_ids)} knowledge points")
        print(f"Requesting {single_count} single choice and {multiple_count} multiple choice questions")

        # 创建考卷
        cur.execute('''
            INSERT INTO exampaper (title, description)
            VALUES (%s, %s)
            RETURNING id
        ''', (title, description))
        exam_id = cur.fetchone()['id']
        print(f"Created exam with ID: {exam_id}")

        # 创建试卷和课程的关联
        for course_id in course_ids:
            cur.execute('''
                INSERT INTO exampapercourse (exam_paper_id, course_id)
                VALUES (%s, %s)
            ''', (exam_id, course_id))
        print(f"Associated exam with courses: {course_ids}")

        # 检查每种题型是否有足够的题目
        if single_count > 0:
            cur.execute(f'''
                SELECT COUNT(*) as count
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '单选题'
            ''')
            available_single = cur.fetchone()['count']
            print(f"Available single choice questions: {available_single}")
            if available_single < single_count:
                conn.rollback()
                return jsonify({'error': f'单选题数量不足，只有 {available_single} 道题可用'}), 400

        if multiple_count > 0:
            cur.execute(f'''
                SELECT COUNT(*) as count
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '多选题'
            ''')
            available_multiple = cur.fetchone()['count']
            print(f"Available multiple choice questions: {available_multiple}")
            if available_multiple < multiple_count:
                conn.rollback()
                return jsonify({'error': f'多选题数量不足，只有 {available_multiple} 道题可用'}), 400

        # 从选定的知识点中随机抽取题目
        if single_count > 0:
            cur.execute(f'''
                INSERT INTO exampaperquestion (exam_paper_id, question_id)
                SELECT %s, q.id
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '单选题'
                ORDER BY RANDOM()
                LIMIT %s
            ''', (exam_id, single_count))

        if multiple_count > 0:
            cur.execute(f'''
                INSERT INTO exampaperquestion (exam_paper_id, question_id)
                SELECT %s, q.id
                FROM question q
                WHERE q.knowledge_point_id IN (SELECT id::uuid FROM unnest(ARRAY[{point_ids}]) AS id)
                AND q.question_type = '多选题'
                ORDER BY RANDOM()
                LIMIT %s
            ''', (exam_id, multiple_count))

        conn.commit()
        print(f"Successfully created exam with ID: {exam_id}")
        return jsonify({'id': exam_id})
    except Exception as e:
        conn.rollback()
        print('Error in create_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['GET'])
def get_exam(exam_id):
    print("开始获取考试详情，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取考卷基本信息
        cur.execute('''
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                ep.updated_at
            FROM exampaper ep
            WHERE ep.id = %s
        ''', (exam_id,))
        exam = cur.fetchone()
        print("SQL查询结果：", exam)
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        # 获取考卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    question_id,
                    option_text,
                    is_correct,
                    (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer as option_index
                FROM option
            )
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                epq.id as exam_paper_question_id,
                array_agg(o.option_text ORDER BY o.option_index) as options,
                array_agg(
                    CASE WHEN o.is_correct THEN chr(65 + o.option_index) END
                    ORDER BY o.option_index
                ) FILTER (WHERE o.is_correct) as answer,
                tc.course_name,
                kp.point_name
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                tc.course_name,
                kp.point_name,
                epq.id
            ORDER BY 
                CASE q.question_type 
                    WHEN '单选题' THEN 1 
                    WHEN '多选题' THEN 2 
                    ELSE 3 
                END,
                epq.id
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = questions

        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/detail', methods=['GET'])
def get_exam_detail(exam_id):
    print("开始获取考试详情（包含课程信息），考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取试卷基本信息和相关课程
        cur.execute('''
            WITH exam_courses AS (
                SELECT DISTINCT
                    ep.id as exam_id,
                    array_agg(DISTINCT tc.course_name) as course_names
                FROM exampaper ep
                JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
                JOIN trainingcourse tc ON epc.course_id = tc.id
                WHERE ep.id = %s
                GROUP BY ep.id
            )
            SELECT 
                e.id,
                e.title,
                e.description,
                e.created_at,
                COALESCE(ec.course_names, ARRAY[]::text[]) as course_names
            FROM exampaper e
            LEFT JOIN exam_courses ec ON e.id = ec.exam_id
            WHERE e.id = %s
            GROUP BY e.id, e.title, e.description, e.created_at, ec.course_names
        ''', (exam_id, exam_id))
        exam = cur.fetchone()
        print("SQL查询结果：", exam)
        
        if not exam:
            return jsonify({'error': '试卷不存在'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    question_id,
                    option_text,
                    is_correct,
                    (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer as option_index
                FROM option
            )
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                epq.id as exam_paper_question_id,
                array_agg(o.option_text ORDER BY o.option_index) as options,
                array_agg(
                    CASE WHEN o.is_correct THEN chr(65 + CAST(o.option_index AS INTEGER)) END
                    ORDER BY o.option_index
                ) FILTER (WHERE o.is_correct) as answer,
                tc.course_name,
                kp.point_name
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY 
                q.id,
                q.question_type,
                q.question_text,
                a.explanation,
                tc.course_name,
                kp.point_name,
                epq.id
            ORDER BY 
                CASE q.question_type 
                    WHEN '单选题' THEN 1 
                    WHEN '多选题' THEN 2 
                    ELSE 3 
                END,
                epq.id
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = [dict(q) for q in questions]

        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam_detail:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['PUT'])
def update_exam(exam_id):
    print("开始更新考试，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.json
        title = data.get('title')
        description = data.get('description', '')
        course_ids = data.get('course_ids', [])
        
        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
            
        if not course_ids:
            return jsonify({'error': '请选择至少一个课程'}), 400
            
        # 更新考卷基本信息
        cur.execute('''
            UPDATE exampaper
            SET title = %s, description = %s
            WHERE id = %s
        ''', (title, description, exam_id))
        
        # 删除旧的课程关联
        cur.execute('''
            DELETE FROM exampapercourse
            WHERE exam_paper_id = %s
        ''', (exam_id,))
        
        # 添加新的课程关联
        for course_id in course_ids:
            cur.execute('''
                INSERT INTO exampapercourse (exam_paper_id, course_id)
                VALUES (%s, %s)
            ''', (exam_id, course_id))
            
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        print('Error in update_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/take', methods=['GET'])
def get_exam_for_taking(exam_id):
    print("首先，开始获取考试题目，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取考卷基本信息
        cur.execute('''
            SELECT 
                e.id,
                e.title,
                e.description,
                e.created_at,
                json_agg(json_build_object(
                    'id', tc.id,
                    'name', tc.course_name
                )) as courses
            FROM exampaper e
            LEFT JOIN exampapercourse epc ON e.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            WHERE e.id = %s
            GROUP BY e.id, e.title, e.description, e.created_at
        ''', (exam_id,))
        exam = cur.fetchone()

        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        # 获取考卷中的题目（不包含正确答案）
        cur.execute('''
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                epq.id as exam_paper_question_id,
                json_agg(
                    json_build_object(
                        'id', o.id,
                        'content', o.option_text
                    ) ORDER BY o.id
                ) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option o ON q.id = o.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY 
                q.id,
                q.question_type,
                q.question_text,
                epq.id
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        # print(questions)
        # 按题型分组
        grouped_questions = {
            'single': [],
            'multiple': []
        }
        
        for q in questions:
            if q['question_type'] == '单选题':
                grouped_questions['single'].append(q)
            elif q['question_type'] == '多选题':
                grouped_questions['multiple'].append(q)
        print(grouped_questions)
        return jsonify({
            'exam': exam,
            'questions': grouped_questions
        })
        
    except Exception as e:
        print('Error in get_exam_for_taking:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/take', methods=['GET'])
def get_exam_questions(exam_id):
    print("开始获取考试题目，考试ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取试卷基本信息
        cur.execute('''
            SELECT 
                ep.id,
                ep.title,
                ep.description
            FROM exampaper ep
            WHERE ep.id = %s
        ''', (exam_id,))
        exam = cur.fetchone()
        
        if not exam:
            return jsonify({'error': '试卷不存在'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    question_id,
                    option_text,
                    is_correct,
                    id as option_id,
                    (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer as option_index
                FROM option
            )
            SELECT 
                q.id,
                q.question_type,
                q.question_text,
                array_agg(json_build_object(
                    'id', o.option_id,
                    'option_text', o.option_text,
                    'index', o.option_index
                ) ORDER BY o.option_index) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY q.id, q.question_type, q.question_text, epq.created_at
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = questions

        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam_questions:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>/submit', methods=['POST'])
def submit_exam_answer(exam_id):
    logger = logging.getLogger(__name__)
    logger.info(f"Starting exam submission for exam_id: {exam_id}")
    
    conn = None
    cur = None
    try:
        # Input validation
        if not exam_id:
            raise ValueError("Exam ID is required")
            
        data = request.json
        user_id = data.get('user_id')
        answers = data.get('answers', [])
        
        if not user_id:
            raise ValueError("User ID is required")
        if not answers:
            raise ValueError("No answers provided")
            
        # Validate exam_id and user_id are valid UUIDs
        try:
            exam_uuid = str(uuid.UUID(exam_id))
            user_uuid = str(uuid.UUID(user_id))
        except ValueError as e:
            logger.error(f"Invalid UUID format: {str(e)}")
            return jsonify({'error': 'Invalid exam ID or user ID format'}), 400
            
        # Establish database connection
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Verify exam exists and is active
        cur.execute('''
            SELECT id, title FROM exampaper WHERE id = %s
        ''', (exam_uuid,))
        exam = cur.fetchone()
        if not exam:
            raise ValueError(f"Exam with ID {exam_id} not found")
            
        # Verify user exists
        cur.execute('''
            SELECT id FROM "user" WHERE id = %s
        ''', (user_uuid,))
        user = cur.fetchone()
        if not user:
            raise ValueError(f"User with ID {user_id} not found")
            
        # Check if user has already submitted this exam
        cur.execute('''
            SELECT COUNT(*) as submission_count 
            FROM answerrecord 
            WHERE exam_paper_id = %s AND user_id = %s
        ''', (exam_uuid, user_uuid))
        submission_count = cur.fetchone()['submission_count']
        # if submission_count > 0:
        #     raise ValueError("You have already submitted this exam")

        results = []
        total_score = 0

        for answer in answers:
            question_id = answer.get('question_id')
            selected_options = answer.get('selected_options', [])
            
            if not question_id:
                logger.warning("Skipping answer with missing question_id")
                continue
                
            # Validate question_id UUID
            try:
                question_id = str(uuid.UUID(question_id))
            except ValueError:
                logger.warning(f"Invalid question_id UUID format: {question_id}")
                continue

            # Validate selected_options
            try:
                selected_options = [str(uuid.UUID(opt)) for opt in selected_options]
            except ValueError as e:
                logger.error(f"Invalid UUID in selected_options: {str(e)}")
                continue

            # Get question info and correct answers
            cur.execute('''
                WITH option_with_index AS (
                    SELECT
                        id,
                        question_id,
                        option_text,
                        is_correct,
                        chr(65 + (ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1)::integer) AS option_char
                    FROM option
                    WHERE question_id = %s
                ),
                correct_options AS (
                  SELECT
                        question_id,
                        array_agg(id) as correct_option_ids,
                        array_agg(option_char) AS correct_answer_chars
                    FROM option_with_index
                    WHERE is_correct
                    GROUP BY question_id
                )
                SELECT
                    q.id,
                    q.question_type,
                    q.question_text,
                    a.explanation,
                    co.correct_answer_chars,
                    co.correct_option_ids,
                    json_agg(
                        json_build_object(
                            'id', owi.id,
                            'content', owi.option_text,
                            'is_correct', owi.is_correct,
                            'char', owi.option_char
                        ) ORDER BY owi.option_char
                    ) AS options
                FROM question q
                LEFT JOIN answer a ON q.id = a.question_id
                LEFT JOIN option_with_index owi ON q.id = owi.question_id
                LEFT JOIN correct_options co ON q.id = co.question_id
                WHERE q.id = %s
                GROUP BY q.id, q.question_type, q.question_text, a.explanation, co.correct_answer_chars, co.correct_option_ids;
            ''', (question_id, question_id))
            
            question_info = cur.fetchone()

            print("question_info:",question_info)
            if not question_info:
                logger.warning(f"No question info found for question_id: {question_id}")
                continue

            # Calculate score
            is_correct = False
            score = 0

            if question_info['question_type'] == '单选题':
                is_correct = len(selected_options) == 1 and selected_options[0] in question_info['correct_option_ids']
                score = 1 if is_correct else 0
            elif question_info['question_type'] == '多选题':
                # 确保 correct_option_ids 是列表而不是字符串
                if isinstance(question_info['correct_option_ids'], str):
                    # 如果是字符串，去掉首尾的 {} 并分割
                    correct_options = question_info['correct_option_ids'].strip('{}').split(',')
                    # 过滤掉空字符串
                    correct_options = [opt for opt in correct_options if opt]
                else:
                    correct_options = question_info['correct_option_ids']

                selected_set = set(selected_options)
                correct_set = set(correct_options)
                
                print("选中的选项：", selected_set)
                print("正确的选项：", correct_set)
                
                is_correct = selected_set == correct_set
                print("是否正确：", is_correct)
                score = 2 if is_correct else 0

            # Record answer
            try:
                # Convert selected_options to a PostgreSQL array literal
                selected_options_literal = '{' + ','.join(selected_options) + '}'
                cur.execute('''
                    INSERT INTO answerrecord (
                        exam_paper_id,
                        question_id,
                        selected_option_ids,
                        user_id,
                        score,
                        created_at
                    ) VALUES (%s, %s, %s, %s, %s, NOW())
                    RETURNING id;
                ''', (exam_uuid, question_id, selected_options_literal, user_uuid, score))
                
                answer_record_id = cur.fetchone()['id']
                
                # 构建结果对象
                result = {
                    'id': question_id,
                    'question_text': question_info['question_text'],
                    'question_type': question_info['question_type'],
                    'selected_option_ids': selected_options,
                    'options': question_info['options'],
                    'score': score,
                    'is_correct': is_correct,
                    'explanation': question_info['explanation']
                }
                
                results.append(result)
                total_score += score
                
            except Exception as e:
                logger.error(f"Error recording answer: {str(e)}")
                conn.rollback()
                continue

        # Commit the transaction
        conn.commit()
        
        # Return the results
        return jsonify({
            'exam_id': exam_id,
            'user_id': user_id,
            'total_score': total_score,
            'questions': results
        })
    except ValueError as e:
        if conn:
            conn.rollback()
        logger.error(f"Validation error in submit_exam_answer: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Error in submit_exam_answer: {str(e)}")
        return jsonify({'error': 'An internal server error occurred'}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

@app.route('/api/exams/<exam_id>', methods=['DELETE'])
def delete_exam(exam_id):
    try:
        # Validate exam_id is a valid UUID
        try:
            uuid.UUID(exam_id)
        except ValueError:
            return jsonify({'error': 'Invalid exam ID format'}), 400

        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # First check if exam exists
                cur.execute("SELECT id FROM exampaper WHERE id = %s", (exam_id,))
                if cur.fetchone() is None:
                    return jsonify({'error': 'Exam not found'}), 404

                # Delete all answer records for this exam
                cur.execute("DELETE FROM answerrecord WHERE exam_paper_id = %s", (exam_id,))
                
                # Delete the exam paper
                cur.execute("DELETE FROM exampaper WHERE id = %s", (exam_id,))
                
                conn.commit()

        return jsonify({'message': 'Exam deleted successfully'}), 200

    except Exception as e:
        app.logger.error(f"Error deleting exam: {str(e)}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/users/login', methods=['POST'])
def login_or_register_user():
    data = request.get_json()
    phone_number = data.get('phone_number')
    username = data.get('username', '')

    if not phone_number:
        return jsonify({'error': '手机号不能为空'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 先查找是否存在该手机号的用户
        cur.execute('SELECT * FROM "user" WHERE phone_number = %s', (phone_number,))
        existing_user = cur.fetchone()

        if existing_user:
            # 如果用户已存在，直接返回用户信息
            return jsonify({
                'id': existing_user['id'],
                'username': existing_user['username'],
                'phone_number': existing_user['phone_number']
            })
        
        # 如果用户不存在且没有提供用户名，返回404
        if not username:
            return jsonify({'error': 'user_not_found'}), 404
            
        # 如果用户不存在且提供了用户名，创建新用户
        cur.execute(
            'INSERT INTO "user" (username, phone_number) VALUES (%s, %s) RETURNING id, username, phone_number',
            (username, phone_number)
        )
        new_user = cur.fetchone()
        conn.commit()

        return jsonify({
            'id': new_user['id'],
            'username': new_user['username'],
            'phone_number': new_user['phone_number']
        })

    except psycopg2.Error as e:
        conn.rollback()
        print('Error in login_or_register_user:', str(e))
        return jsonify({'error': '登录或注册失败'}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exam-records', methods=['GET'])
def get_exam_records():
    try:
        search = request.args.get('search', '')
        
        query = """
            SELECT 
                ep.id as exam_paper_id,
                ep.title as exam_title,
                ep.description as exam_description,
                ar.user_id,
                ar.created_at as exam_time,
                ROUND(CAST(AVG(ar.score) AS numeric), 2) as total_score,
                u.username as user_name,
                u.phone_number,
                array_agg(DISTINCT tc.course_name) as course_names
            FROM answerrecord ar
            JOIN exampaper ep ON ar.exam_paper_id = ep.id
            JOIN "user" u ON ar.user_id = u.id
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            WHERE 
                CASE 
                    WHEN %s != '' THEN 
                        u.username ILIKE '%%' || %s || '%%' OR 
                        u.phone_number ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY 
                ep.id, ep.title, ep.description, 
                ar.user_id, ar.created_at,
                u.username, u.phone_number
            ORDER BY ar.created_at DESC
        """
        
        conn = get_db_connection()
        cur = conn.cursor()
        try:
            cur.execute(query, (search, search, search))
            records = cur.fetchall()
            
            result = []
            for record in records:
                exam_record = {
                    'exam_paper_id': record[0],
                    'exam_title': record[1],
                    'exam_description': record[2],
                    'user_id': record[3],
                    'exam_time': record[4].isoformat() if record[4] else None,
                    'total_score': float(record[5]) if record[5] is not None else 0.0,
                    'user_name': record[6],
                    'phone_number': record[7],
                    'courses': [course for course in record[8] if course is not None] if record[8] else []
                }
                result.append(exam_record)
                
            print("API Response:", result)  # 添加日志输出
            return jsonify(result)
        finally:
            cur.close()
            conn.close()
            
    except Exception as e:
        print(f"Error in get_exam_records: {str(e)}")  # 添加错误日志
        return jsonify({'error': str(e)}), 500

@app.route('/api/exam-records/<exam_id>/<user_id>', methods=['GET'])
def get_exam_record_detail(exam_id, user_id):
    print("开始获取考试记录详情，考试ID：", exam_id, "用户ID：", user_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        exam_time = request.args.get('exam_time')
        if not exam_time:
            return jsonify({'error': 'exam_time is required'}), 400
            
        print("收到的考试时间：", exam_time)
        try:
            exam_time = exam_time.replace(' ', 'T')
            exam_time = exam_time.replace('Z', '+00:00')
            if '+' in exam_time and ':' not in exam_time.split('+')[1]:
                parts = exam_time.split('+')
                exam_time = f"{parts[0]}+{parts[1][:2]}:{parts[1][2:]}"
            print("转换后的考试时间：", exam_time)
        except Exception as e:
            print("时间格式转换错误：", str(e))
            return jsonify({'error': '无效的时间格式'}), 400

        # 获取考试基本信息
        base_query = '''
            SELECT 
                e.id as exam_paper_id,
                e.title as exam_title,
                e.description as exam_description,
                u.id as user_id,
                u.username,
                u.phone_number,
                to_char(ar.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as exam_time,
                ROUND(CAST(SUM(ar.score)::float / COUNT(*) * 100 as numeric), 2) as total_score,
                COUNT(*) OVER (PARTITION BY e.id, u.id) as attempt_number,
                COALESCE(
                    (
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', tc.id,
                            'name', tc.course_name
                        ))
                        FROM exampapercourse epc2
                        JOIN trainingcourse tc ON epc2.course_id = tc.id
                        WHERE epc2.exam_paper_id = e.id
                    ),
                    '[]'::jsonb
                ) as courses
            FROM answerrecord ar
            JOIN exampaper e ON ar.exam_paper_id = e.id
            JOIN "user" u ON ar.user_id = u.id
            WHERE ar.user_id = %s
            AND e.id = %s
            AND ar.created_at >= %s::timestamp with time zone
            AND ar.created_at < (%s::timestamp with time zone + INTERVAL '1 second')
            GROUP BY e.id, e.title, e.description, u.id, u.username, u.phone_number, ar.created_at
        '''
        
        cur.execute(base_query, [user_id, exam_id, exam_time, exam_time])
        exam_info = cur.fetchone()

        if not exam_info:
            return jsonify({'error': 'Exam record not found'}), 404

        # 获取答题详情
        detail_query = '''
            WITH option_numbers AS (
                SELECT 
                    id,
                    question_id,
                    ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY id) - 1 as option_index
                FROM option
            ),
            debug_info AS (
                SELECT 
                    q.id,
                    q.question_text,
                    q.question_type,
                    a.explanation,
                    ar.selected_option_ids,
                    array_agg(o.id) FILTER (WHERE o.is_correct) as correct_option_ids,
                    array_length(ar.selected_option_ids, 1) as selected_length,
                    array_length(array_agg(o.id) FILTER (WHERE o.is_correct), 1) as correct_length,
                    CASE 
                        WHEN q.question_type = '单选题' THEN
                            CASE 
                                WHEN array_length(ar.selected_option_ids, 1) = 1 AND 
                                     ar.selected_option_ids = array_agg(o.id) FILTER (WHERE o.is_correct)
                                THEN true 
                                ELSE false 
                            END
                        ELSE
                            CASE 
                                WHEN ar.selected_option_ids @> array_agg(o.id) FILTER (WHERE o.is_correct) AND
                                     array_length(ar.selected_option_ids, 1) = array_length(array_agg(o.id) FILTER (WHERE o.is_correct), 1)
                                THEN true 
                                ELSE false 
                            END
                    END as is_correct,
                    json_agg(
                        json_build_object(
                            'id', o.id,
                            'text', replace(o.option_text, E'\\u2103', '°C'),
                            'is_correct', o.is_correct,
                            'char', CASE 
                                WHEN opt_num.option_index < 26 THEN 
                                    chr(65 + CAST(opt_num.option_index AS INTEGER))
                                ELSE 
                                    CAST(opt_num.option_index + 1 AS TEXT)
                            END
                        ) ORDER BY opt_num.option_index
                    ) as options,
                    c.course_name,
                    kp.point_name as knowledge_point,
                    MIN(epq.created_at) as question_order
                FROM question q
                JOIN exampaperquestion epq ON q.id = epq.question_id
                JOIN answerrecord ar ON epq.exam_paper_id = ar.exam_paper_id AND q.id = ar.question_id
                JOIN option o ON q.id = o.question_id
                JOIN option_numbers opt_num ON o.id = opt_num.id
                JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
                JOIN trainingcourse c ON kp.course_id = c.id
                LEFT JOIN answer a ON q.id = a.question_id
                WHERE ar.user_id = %s
                AND epq.exam_paper_id = %s
                AND ar.created_at >= %s::timestamp with time zone
                AND ar.created_at < (%s::timestamp with time zone + INTERVAL '1 second')
                GROUP BY q.id, q.question_text, q.question_type, a.explanation, ar.selected_option_ids, c.course_name, kp.point_name
            )
            SELECT 
                *,
                json_build_object(
                    'question_text', question_text,
                    'question_type', question_type,
                    'selected_option_ids', selected_option_ids,
                    'correct_option_ids', correct_option_ids,
                    'selected_length', selected_length,
                    'correct_length', correct_length,
                    'is_correct', is_correct
                ) as debug_output
            FROM debug_info
            ORDER BY question_order;
        '''
        
        detail_params = [user_id, exam_id, exam_time, exam_time]
        cur.execute(detail_query, detail_params)
        questions = cur.fetchall()
        
        # 合并考试信息和题目信息
        response_data = dict(exam_info)
        response_data['questions'] = questions
        
        return jsonify(response_data)
    except Exception as e:
        print('Error in get_exam_record_detail:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_ids>/points', methods=['GET'])
def get_courses_knowledge_points(course_ids):
    print("开始获取课程知识点，课程ID：", course_ids)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 将逗号分隔的课程ID转换为列表
        course_id_list = course_ids.split(',')
        print("Fetching knowledge points for courses:", course_id_list)
        
        # 获取指定课程的所有知识点及其题目数量
        cur.execute('''
            WITH questioncounts AS (
                SELECT 
                    q.knowledge_point_id,
                    SUM(CASE WHEN q.question_type = '单选题' THEN 1 ELSE 0 END) as single_count,
                    SUM(CASE WHEN q.question_type = '多选题' THEN 1 ELSE 0 END) as multiple_count
                FROM question q
                GROUP BY q.knowledge_point_id
            )
            SELECT 
                kp.id,
                kp.point_name as name,
                kp.course_id,
                COALESCE(qc.single_count, 0)::integer as single_count,
                COALESCE(qc.multiple_count, 0)::integer as multiple_count
            FROM knowledgepoint kp
            LEFT JOIN questioncounts qc ON kp.id = qc.knowledge_point_id
            WHERE kp.course_id::text = ANY(%s)
            ORDER BY kp.point_name
        ''', (course_id_list,))
        
        points = cur.fetchall()
        print("SQL query executed successfully")
        print("Knowledge points found:", len(points))
        print("First point example:", points[0] if points else "No points found")
        return jsonify(points)
    except Exception as e:
        print('Error in get_courses_knowledge_points:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()



@app.route('/api/users/login', methods=['POST'])
def user_login():
    print("开始用户登录")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.get_json()
        username = data.get('username')
        phone_number = data.get('phone_number')

        if not username or not phone_number:
            return jsonify({'error': '用户名和手机号不能为空'}), 400

        # 查找用户，如果不存在则创建
        cur.execute('''
            SELECT id, username, phone_number
            FROM "user"
            WHERE username = %s AND phone_number = %s
        ''', (username, phone_number))
        
        user = cur.fetchone()
        
        if not user:
            cur.execute('''
                INSERT INTO "user" (username, phone_number)
                VALUES (%s, %s)
                RETURNING id, username, phone_number
            ''', (username, phone_number))
            user = cur.fetchone()
            conn.commit()

        return jsonify(user)
    except Exception as e:
        print('Error in user_login:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    app.run(debug=True)
