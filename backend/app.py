from flask import Flask, jsonify, request
from flask_cors import CORS
import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv
import uuid
from dateutil import parser
import logging
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from datetime import timedelta, datetime
import datetime as dt
from backend.api.temp_answer import save_temp_answer, get_temp_answers, mark_temp_answers_submitted  # 使用绝对导入
from backend.api.evaluation import get_evaluation_items, get_user_evaluations
from backend.db import get_db_connection


load_dotenv()

app = Flask(__name__)
CORS(app)

app.config['SECRET_KEY'] = os.environ['SECRET_KEY']  # 设置 SECRET_KEY
app.config['JWT_SECRET_KEY'] = os.environ['SECRET_KEY']  # JWT密钥
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30)  # Token过期时间

jwt = JWTManager(app)  # 初始化JWT管理器

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': '请提供用户名和密码'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('SELECT * FROM users WHERE username = %s', (data['username'],))
        user = cur.fetchone()

        if user and check_password_hash(user['password'], data['password']):
            access_token = create_access_token(identity=user['id'])
            return jsonify({
                'access_token': access_token,
                'user': {
                    'id': user['id'],
                    'username': user['username'],
                    'role': user['role']
                }
            })
        return jsonify({'error': '用户名或密码错误'}), 401
    except Exception as e:
        print('Error in login:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': '请提供用户名和密码'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查用户名是否已存在
        cur.execute('SELECT id FROM users WHERE username = %s', (data['username'],))
        if cur.fetchone():
            return jsonify({'error': '用户名已存在'}), 400

        # 创建新用户
        hashed_password = generate_password_hash(data['password'])
        cur.execute(
            'INSERT INTO users (username, password, role) VALUES (%s, %s, %s) RETURNING id, username, role',
            (data['username'], hashed_password, data.get('role', 'user'))
        )
        new_user = cur.fetchone()
        conn.commit()

        # 生成访问令牌
        access_token = create_access_token(identity=new_user['id'])
        return jsonify({
            'access_token': access_token,
            'user': {
                'id': new_user['id'],
                'username': new_user['username'],
                'role': new_user['role']
            }
        })
    except Exception as e:
        conn.rollback()
        print('Error in register:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

flask_log = os.environ['FLASK_LOG_FILE'] # 设置flask log地址

# 配置日志记录
log = logging.getLogger(__name__)
log.setLevel(logging.DEBUG)
handler = logging.FileHandler(flask_log)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
handler.setFormatter(formatter)
log.addHandler(handler)

# 全局错误处理
@app.errorhandler(Exception)
def handle_exception(e):
    log.exception("An unhandled exception occurred:")
    return jsonify({'error': 'Internal Server Error'}), 500


@app.route('/api/courses', methods=['GET'])
def get_courses():
    # print("开始获取课程列表")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
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
            GROUP BY c.id, c.course_name, c.age_group, c.description, c.created_at, c.updated_at
            ORDER BY c.created_at DESC
        ''')
        courses = cur.fetchall()
        # print("SQL查询结果：", courses)
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
        # print("SQL查询结果：", course)
        if course is None:
            return jsonify({'error': 'Course not found'}), 404
        return jsonify(course)
    except Exception as e:
        print('Error in get_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>/check-deleteable', methods=['GET'])
def check_course_deleteable(course_id):
    print("检查课程是否可删除，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的知识点
        cur.execute('SELECT COUNT(*) FROM knowledgepoint WHERE course_id = %s', (course_id,))
        knowledge_point_count = cur.fetchone()['count']
        
        if knowledge_point_count > 0:
            return jsonify({'deleteable': False, 'message': '该课程包含知识点，无法删除'})
        
        return jsonify({'deleteable': True})
    except Exception as e:
        print('Error in check_course_deleteable:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['DELETE'])
def delete_course(course_id):
    print("开始删除课程，课程ID：", course_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的知识点
        cur.execute('SELECT COUNT(*) FROM knowledgepoint WHERE course_id = %s', (course_id,))
        knowledge_point_count = cur.fetchone()['count']
        
        if knowledge_point_count > 0:
            return jsonify({'error': '该课程包含知识点，无法删除'}), 400

        # 删除课程
        cur.execute('DELETE FROM trainingcourse WHERE id = %s RETURNING id', (course_id,))
        deleted_course = cur.fetchone()
        if not deleted_course:
            return jsonify({'error': '课程不存在'}), 404

        conn.commit()
        return jsonify({'message': '课程删除成功'})
    except Exception as e:
        conn.rollback()
        print('Error in delete_course:', str(e))
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
                COUNT(q.id) AS question_count,
                SUM(CASE WHEN q.question_type = '单选题' THEN 1 ELSE 0 END) AS single_count,
                SUM(CASE WHEN q.question_type = '多选题' THEN 1 ELSE 0 END) AS multiple_count
                -- 如果需要, 还可以计算问答题数量
                -- , SUM(CASE WHEN q.question_type = '问答' THEN 1 ELSE 0 END) AS qa_count
            FROM knowledgepoint kp
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE kp.course_id = %s  -- 占位符, 实际使用时需要替换为具体的 course_id
            GROUP BY kp.id, kp.point_name, kp.description, kp.created_at, kp.updated_at
            ORDER BY kp.created_at DESC;
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

@app.route('/api/knowledge-points', methods=['POST'])
def create_knowledge_point():
    print("开始创建知识点")
    data = request.json
    # print("创建数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查必需字段
        required_fields = ['point_name', 'course_id']
        for field in required_fields:
            if field not in data:
                raise ValueError(f"Missing required field: {field}")

        # 插入新知识点
        cur.execute('''
            INSERT INTO knowledgepoint (
                point_name,
                course_id,
                description
            ) VALUES (%s, %s, %s)
            RETURNING id, point_name, course_id, description, created_at, updated_at
        ''', (
            data['point_name'],
            data['course_id'],
            data.get('description', '')
        ))
        point = cur.fetchone()
        # print("创建知识点结果：", point)
        
        conn.commit()
        return jsonify(point)
    except ValueError as e:
        conn.rollback()
        print(f"Validation error: {str(e)}")
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        conn.rollback()
        print(f"Error creating knowledge point: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge-points', methods=['GET'])
def get_knowledge_points():
    print("开始获取知识点列表")
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    point_name = request.args.get('point_name', '')
    course_id = request.args.get('course_id', '')
    offset = (page - 1) * per_page
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 构建WHERE条件
        where_conditions = []
        params = []
        
        if point_name:
            where_conditions.append("kp.point_name ILIKE %s")
            params.append(f'%{point_name}%')
            
        if course_id:
            where_conditions.append("kp.course_id = %s")
            params.append(course_id)
            
        where_clause = " AND ".join(where_conditions) if where_conditions else "TRUE"
        
        # 获取总记录数
        count_sql = f'SELECT COUNT(*) FROM knowledgepoint kp WHERE {where_clause}'
        cur.execute(count_sql, params)
        total = cur.fetchone()['count']
        
        # 获取分页数据
        query = f'''
            SELECT 
                kp.id,
                kp.point_name,
                kp.description,
                kp.course_id,
                tc.course_name,
                kp.created_at,
                kp.updated_at,
                COUNT(q.id) as question_count
            FROM knowledgepoint kp
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN question q ON q.knowledge_point_id = kp.id
            WHERE {where_clause}
            GROUP BY kp.id, kp.point_name, kp.description, kp.course_id, tc.course_name, kp.created_at, kp.updated_at
            ORDER BY kp.created_at DESC
            LIMIT %s OFFSET %s
        '''
        
        # 计算偏移量
        offset = (page - 1) * per_page
        
        # 添加分页参数
        params.extend([per_page, offset])
        cur.execute(query, params)
        knowledge_points = cur.fetchall()
        
        return jsonify({
            'items': knowledge_points,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        print("Error in get_knowledge_points:", str(e))
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
        # print("SQL查询结果：", point)
        if point is None:
            return jsonify({'error': 'Knowledge point not found'}), 404
        return jsonify(point)
    except Exception as e:
        print("Error in get_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['PUT'])
def update_knowledge_point(point_id):
    print("开始更新知识点，知识点ID：", point_id)
    data = request.json
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查知识点是否存在
        cur.execute('SELECT id FROM knowledgepoint WHERE id = %s', (point_id,))
        if not cur.fetchone():
            return jsonify({'error': '知识点不存在'}), 404

        # 更新知识点信息
        cur.execute('''
            UPDATE knowledgepoint 
            SET point_name = %s,
                course_id = %s
            WHERE id = %s
            RETURNING id, point_name, course_id
        ''', (data['point_name'], data['course_id'], point_id))
        updated_point = cur.fetchone()
        conn.commit()
        return jsonify(updated_point)
    except Exception as e:
        conn.rollback()
        print("Error in update_knowledge_point:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/knowledge_points/<point_id>', methods=['DELETE'])
def delete_knowledge_point(point_id):
    print("开始删除知识点，知识点ID：", point_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查是否有关联的考题
        cur.execute('SELECT COUNT(*) FROM question WHERE knowledge_point_id = %s', (point_id,))
        question_count = cur.fetchone()['count']
        if question_count > 0:
            return jsonify({'error': '该知识点下有关联的考题，无法删除'}), 400

        # 删除知识点
        cur.execute('DELETE FROM knowledgepoint WHERE id = %s RETURNING id', (point_id,))
        deleted_point = cur.fetchone()
        if not deleted_point:
            return jsonify({'error': '知识点不存在'}), 404

        conn.commit()
        return jsonify({'message': '知识点删除成功'})
    except Exception as e:
        conn.rollback()
        print("Error in delete_knowledge_point:", str(e))
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
                q.knowledge_point_id,
                kp.course_id,
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
            GROUP BY q.id, q.question_type, q.question_text, q.knowledge_point_id, kp.course_id
            ORDER BY q.created_at DESC, q.id ASC
        ''', (point_id,))
        questions = cur.fetchall()
        # print("SQL查询结果：", questions)
        
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
        # print("SQL查询结果：", question)
        
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
    # print("更新数据：", data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否存在
        check_sql = 'SELECT id FROM question WHERE id = %s::uuid'
        # print("执行检查题目SQL：", check_sql)
        # print("参数：", (question_id,))
        cur.execute(check_sql, (question_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Question not found'}), 404

        # 更新题目基本信息
        update_question_sql = '''
            UPDATE question 
            SET question_text = %s,
                question_type = %s,
                difficulty = %s,
                knowledge_point_id = %s
            WHERE id = %s::uuid
            RETURNING id, question_text, question_type, difficulty, knowledge_point_id
        '''
        update_question_params = (
            data['question_text'],
            data['question_type'],
            data.get('difficulty', 3),
            data['knowledge_point_id'],
            question_id
        )
        # print("执行更新题目SQL：", update_question_sql)
        # print("参数：", update_question_params)
        cur.execute(update_question_sql, update_question_params)
        question = cur.fetchone()
        # print("更新题目结果：", question)

        # 更新答案信息
        update_answer_sql = '''
            UPDATE answer 
            SET answer_text = %s,
                explanation = %s,
                source = %s
            WHERE question_id = %s::uuid
            RETURNING answer_text, explanation, source
        '''
        update_answer_params = (
            data.get('answer_text', ''),
            data.get('explanation', ''),
            data.get('source', ''),
            question_id
        )
        # print("执行更新答案SQL：", update_answer_sql)
        # print("参数：", update_answer_params)
        cur.execute(update_answer_sql, update_answer_params)
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
    # print("创建数据：", data)
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
        # print("创建题目结果：", question)
        
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
            # print("创建选项结果：", question['options'])
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

@app.route('/api/questions/<question_id>/check-usage', methods=['GET'])
def check_question_usage(question_id):
    print("检查题目使用状态，题目ID：", question_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查题目是否被试卷引用
        cur.execute("""
            SELECT COUNT(*) > 0 as is_used
            FROM exampaperquestion
            WHERE question_id = %s
        """, (question_id,))
        result = cur.fetchone()
        return jsonify({
            'is_used_in_exam': result['is_used'] if result else False
        })
    except Exception as e:
        print("Error in check_question_usage:", str(e))
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
        # 检查题目是否被试卷引用
        cur.execute("""
            SELECT COUNT(*) > 0 as is_used
            FROM exampaperquestion
            WHERE question_id = %s
        """, (question_id,))
        result = cur.fetchone()
        if result and result['is_used']:
            return jsonify({'error': '该题目已被试卷引用，无法删除'}), 400

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

@app.route('/api/users', methods=['GET'])
def get_users():
    log.debug("开始获取用户列表")
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('''
            SELECT
                id,
                username,
                phone_number,
                role,
                email,
                status,
                created_at,
                updated_at
            FROM "user"
            ORDER BY created_at DESC
        ''')
        users = cur.fetchall()
        return jsonify(users)
    except Exception as e:
        print('Error in get_users:', str(e))
        log.exception('Error in get_users:')
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users', methods=['POST'])
def create_user():
    print("开始创建用户")
    data = request.get_json()
    logger.debug(f"Received data: {data}")
    if not data or 'username' not in data or 'password' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查用户名是否已存在
        cur.execute('SELECT id FROM "user" WHERE username = %s', (data['username'],))
        if cur.fetchone():
            return jsonify({'error': 'Username already exists'}), 400

        # 创建新用户
        cur.execute('''
            INSERT INTO "user" (
                username,
                password,
                phone_number,
                role,
                email,
                status
            ) VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, username, phone_number, role, email, status, created_at, updated_at
        ''', (
            data['username'],
            generate_password_hash(data['password']),
            data.get('phone_number', ''),
            data.get('role', 'student'),
            data.get('email', ''),
            data.get('status', 'active')
        ))
        new_user = cur.fetchone()
        conn.commit()
        return jsonify(new_user)
    except Exception as e:
        conn.rollback()
        print('Error in create_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>', methods=['PUT'])
def update_user(user_id):
    print("开始更新用户，用户ID：", user_id)
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 构建更新字段
        update_fields = []
        params = []
        if 'username' in data:
            update_fields.append('username = %s')
            params.append(data['username'])
        if 'password' in data:
            update_fields.append('password = %s')
            params.append(generate_password_hash(data['password']))
        if 'phone_number' in data:
            update_fields.append('phone_number = %s')
            params.append(data['phone_number'])
        if 'role' in data:
            update_fields.append('role = %s')
            params.append(data['role'])
        if 'email' in data:
            update_fields.append('email = %s')
            params.append(data['email'])
        if 'status' in data:
            update_fields.append('status = %s')
            params.append(data['status'])

        if not update_fields:
            return jsonify({'error': 'No fields to update'}), 400

        # 添加用户ID到参数列表
        params.append(user_id)

        # 执行更新
        query = f'''
            UPDATE "user"
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING id, username, phone_number, role, email, status, created_at, updated_at
        '''
        cur.execute(query, params)
        updated_user = cur.fetchone()

        if updated_user is None:
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        return jsonify(updated_user)
    except Exception as e:
        conn.rollback()
        print('Error in update_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>/details', methods=['GET'])
def get_user_detail(user_id):
    from .api.user_details import get_user_details
    return get_user_details(user_id)

@app.route('/api/evaluation-items', methods=['GET'])
def get_evaluation_items_route():
    return get_evaluation_items()

@app.route('/api/evaluation/structure', methods=['GET'])
def get_evaluation_structure():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取所有评价方面
        cur.execute("""
            SELECT 
                id,
                aspect_name,
                description
            FROM evaluation_aspect
            ORDER BY created_at DESC
        """)
        aspects = cur.fetchall()
        
        # 获取所有评价类别
        cur.execute("""
            SELECT 
                id,
                category_name,
                description,
                aspect_id
            FROM evaluation_category
            ORDER BY created_at DESC
        """)
        categories = cur.fetchall()
        
        # 获取所有评价项
        cur.execute("""
            SELECT 
                id,
                item_name,
                description,
                category_id
            FROM evaluation_item
            ORDER BY created_at DESC
        """)
        items = cur.fetchall()
        
        # 构建层级结构
        structure = []
        for aspect in aspects:
            aspect_data = {
                'id': aspect['id'],
                'name': aspect['aspect_name'],
                'description': aspect['description'],
                'type': 'aspect',
                'children': []
            }
            
            # 添加该方面下的类别
            for category in categories:
                if category['aspect_id'] == aspect['id']:
                    category_data = {
                        'id': category['id'],
                        'name': category['category_name'],
                        'description': category['description'],
                        'type': 'category',
                        'children': []
                    }
                    
                    # 添加该类别下的评价项
                    for item in items:
                        if item['category_id'] == category['id']:
                            item_data = {
                                'id': item['id'],
                                'name': item['item_name'],
                                'description': item['description'],
                                'type': 'item'
                            }
                            category_data['children'].append(item_data)
                    
                    aspect_data['children'].append(category_data)
            
            structure.append(aspect_data)
        
        return jsonify(structure)
    except Exception as e:
        print('Error in get_evaluation_structure:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>/evaluations', methods=['GET'])
def get_user_evaluations_route(user_id):
    return get_user_evaluations(user_id)

@app.route('/api/user-evaluation/<user_id>', methods=['POST'])
def create_user_evaluation_route(user_id):
    data = request.get_json()
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            INSERT INTO evaluation 
            (evaluator_id, evaluated_user_id, evaluation_items, scores, comments)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (data['evaluator_id'], user_id, data['evaluation_items'], 
              data['scores'], data['comments']))
        evaluation_id = cur.fetchone()['id']
        conn.commit()
        return jsonify({'id': evaluation_id, 'message': '评价提交成功'})
    except Exception as e:
        conn.rollback()
        print('Error in create_user_evaluation:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/users/<user_id>', methods=['DELETE'])
def delete_user(user_id):
    print("开始删除用户，用户ID：", user_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute('DELETE FROM "user" WHERE id = %s RETURNING id', (user_id,))
        deleted = cur.fetchone()

        if deleted is None:
            return jsonify({'error': 'User not found'}), 404

        conn.commit()
        return jsonify({'message': 'User deleted successfully', 'id': user_id})
    except Exception as e:
        conn.rollback()
        print('Error in delete_user:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/courses/<course_id>', methods=['PUT'])
def update_course(course_id):
    print("开始更新课程，课程ID：", course_id)
    data = request.get_json()
    if not data or 'course_name' not in data:
        return jsonify({'error': 'Missing required fields'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 检查课程是否存在
        cur.execute('SELECT id FROM trainingcourse WHERE id = %s', (course_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Course not found'}), 404

        # 更新课程信息
        cur.execute('''
            UPDATE trainingcourse
            SET course_name = %s,
                age_group = %s,
                description = %s
            WHERE id = %s
            RETURNING id, course_name, age_group, description, created_at, updated_at
        ''', (
            data['course_name'],
            data.get('age_group', ''),
            data.get('description', ''),
            course_id
        ))
        updated_course = cur.fetchone()
        conn.commit()
        return jsonify(updated_course)
    except Exception as e:
        conn.rollback()
        print('Error in update_course:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exampapers', methods=['GET'])
def get_exampapers():
    print("开始获取考卷列表")
    search = request.args.get('search', '')
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                array_agg(DISTINCT tc.course_name) as course_names
            FROM exampaper ep
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            WHERE 
                CASE 
                    WHEN %s != '' THEN 
                        ep.title ILIKE '%%' || %s || '%%' OR 
                        ep.description ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY 
                ep.id, ep.title, ep.description, ep.created_at
            ORDER BY ep.created_at DESC
        """, (search, search, search))
        
        records = cur.fetchall()
        result = []
        for record in records:
            exam_paper = {
                'id': record['id'],
                'title': record['title'],
                'description': record['description'],
                'created_at': record['created_at'].isoformat() if record['created_at'] else None,
                'course_names': [course for course in record['course_names'] if course is not None] if record['course_names'] else []
            }
            result.append(exam_paper)
            
        # print("API Response:", result)
        return jsonify(result)
    except Exception as e:
        print(f"Error in get_exampapers: {str(e)}")
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams', methods=['GET'])
def get_exams():
    print("开始获取考试列表")
    search = request.args.get('search', '')
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                ep.id,
                ep.title,
                ep.description,
                ep.created_at,
                array_agg(DISTINCT tc.course_name) as course_names,
                COUNT(DISTINCT q.id) as question_count,
                COUNT(DISTINCT CASE WHEN q.question_type = '单选题' THEN q.id END) as single_count,
                COUNT(DISTINCT CASE WHEN q.question_type = '多选题' THEN q.id END) as multiple_count
            FROM exampaper ep
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            LEFT JOIN exampaperquestion epq ON ep.id = epq.exam_paper_id
            LEFT JOIN question q ON epq.question_id = q.id
            WHERE 
                CASE 
                    WHEN %s != '' THEN 
                        ep.title ILIKE '%%' || %s || '%%' OR 
                        ep.description ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY 
                ep.id, ep.title, ep.description, ep.created_at
            ORDER BY ep.created_at DESC
        """, (search, search, search))
        
        records = cur.fetchall()
        result = []
        for record in records:
            exam_record = {
                'id': record['id'],
                'title': record['title'],
                'description': record['description'],
                'created_at': record['created_at'].isoformat() if record['created_at'] else None,
                'course_names': [course for course in record['course_names'] if course is not None] if record['course_names'] else [],
                'question_count': record['question_count'],
                'single_count': record['single_count'],
                'multiple_count': record['multiple_count']
            }
            result.append(exam_record)
            
        # print("API Response:", result)
        return jsonify(result)
    except Exception as e:
        print(f"Error in get_exams: {str(e)}")
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
        # print("创建数据：", data)
        
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

        # print(f"Creating exam with {len(course_ids)} courses and {len(point_ids)} knowledge points")
        # print(f"Requesting {single_count} single choice and {multiple_count} multiple choice questions")

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
            # print(f"Available single choice questions: {available_single}")
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
            # print(f"Available multiple choice questions: {available_multiple}")
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
        # print("SQL查询结果：", exam)
        if not exam:
            return jsonify({'error': 'Exam not found'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    id,
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
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.course_name,
                array_agg(json_build_object(
                    'id', o.id,
                    'option_text', o.option_text,
                    'index', o.option_index,
                    'is_correct', o.is_correct
                ) ORDER BY o.option_index) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE epq.exam_paper_id = %s
            GROUP BY q.id, q.question_type, q.question_text, a.explanation, kp.id, kp.point_name, tc.course_name, epq.created_at
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = [dict(q) for q in questions]
        # print("SQL查询结果：==========>", exam)
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
        # print("SQL查询结果：", exam)
        
        if not exam:
            return jsonify({'error': '试卷不存在'}), 404

        # 获取试卷中的所有题目及其选项
        cur.execute('''
            WITH option_numbers AS (
                SELECT 
                    id,
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
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.course_name,
                array_agg(json_build_object(
                    'id', o.id,
                    'option_text', o.option_text,
                    'index', o.option_index,
                    'is_correct', o.is_correct
                ) ORDER BY o.option_index) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN option_numbers o ON q.id = o.question_id
            LEFT JOIN answer a ON q.id = a.question_id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE epq.exam_paper_id = %s
            GROUP BY q.id, q.question_type, q.question_text, a.explanation, kp.id, kp.point_name, tc.course_name, epq.created_at
            ORDER BY epq.created_at ASC
        ''', (exam_id,))
        
        questions = cur.fetchall()
        exam['questions'] = [dict(q) for q in questions]
        
        return jsonify(exam)
    except Exception as e:
        print('Error in get_exam_record_detail:', str(e))
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
                q.knowledge_point_id,
                kp.course_id,
                epq.id as exam_paper_question_id,
                json_agg(
                    json_build_object(
                        'id', o.id,
                        'content', o.option_text,
                        'is_correct', o.is_correct
                    ) ORDER BY o.id
                ) as options
            FROM exampaperquestion epq
            JOIN question q ON epq.question_id = q.id
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN option o ON q.id = o.question_id
            WHERE epq.exam_paper_id = %s
            GROUP BY 
                q.id,
                q.question_type,
                q.question_text,
                q.knowledge_point_id,
                kp.course_id,
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
        # print(grouped_questions)
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
        
        # 获取用户信息
        cur.execute('''
            SELECT username, phone_number
            FROM "user"
            WHERE id = %s
        ''', (user_uuid,))
        user_info = cur.fetchone()
        if not user_info:
            raise ValueError(f"User with ID {user_id} not found")

        # 获取考试开始时间（从临时答案表中获取第一次保存的时间）
        cur.execute('''
            SELECT MIN(created_at) as start_time
            FROM temp_answer_record
            WHERE exam_paper_id = %s AND user_id = %s
        ''', (exam_uuid, user_uuid))
        start_time_record = cur.fetchone()
        start_time = start_time_record['start_time'] if start_time_record and start_time_record['start_time'] else dt.datetime.now()

        # 获取当前时间作为提交时间
        submit_time = dt.datetime.now()

        # Verify exam exists and is active
        cur.execute('''
            SELECT id, title FROM exampaper WHERE id = %s
        ''', (exam_uuid,))
        exam = cur.fetchone()
        if not exam:
            raise ValueError(f"Exam with ID {exam_id} not found")

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

            # print("question_info:",question_info)
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
                # 确保 correct_option_ids 是列表格式
                if isinstance(question_info['correct_option_ids'], str):
                    # 如果是字符串，去掉首尾的 {} 并分割
                    correct_options = question_info['correct_option_ids'].strip('{}').split(',')
                    # 过滤掉空字符串并转换为UUID字符串
                    correct_options = [str(uuid.UUID(opt.strip())) for opt in correct_options if opt.strip()]
                else:
                    correct_options = [str(uuid.UUID(opt)) for opt in question_info['correct_option_ids']]

                # 确保 selected_options 也是UUID字符串格式
                selected_options = [str(uuid.UUID(opt)) for opt in selected_options]

                selected_set = set(selected_options)
                correct_set = set(correct_options)
                
                is_correct = selected_set == correct_set
                score = 2 if is_correct else 0

            # Record answer
            try:
                # Convert selected_options to a PostgreSQL array literal
                # 确保 selected_options 是列表格式
                if not isinstance(selected_options, list):
                    selected_options = [selected_options]
                # 确保所有选项都是有效的UUID字符串
                selected_options = [str(uuid.UUID(opt)) for opt in selected_options]
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
        
        # 在返回结果中添加用户信息和考试时间信息
        response_data = {
            'exam_id': exam_id,
            'user_id': user_id,
            'username': user_info['username'],
            'phone_number': user_info['phone_number'],
            'start_time': start_time.isoformat() if start_time else None,
            'submit_time': submit_time.isoformat(),
            'total_score': total_score,
            'questions': results
        }
        
        return jsonify(response_data)
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

    print("Received data====>:", data)

    if not phone_number:
        return jsonify({'error': '手机号不能为空'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 先查找是否存在该手机号的用户
        cur.execute('SELECT * FROM "user" WHERE phone_number = %s', (phone_number,))
        existing_user = cur.fetchone()
        print("Existing user:", existing_user)
    
        if existing_user:
            # 如果用户已存在，直接返回用户信息
            # 生成访问令牌
            access_token = create_access_token(identity=existing_user['id'])
            return jsonify({
                'access_token': access_token,
                'user': {
                    'id': existing_user['id'],
                    'username': existing_user['username'],
                    'phone_number': existing_user['phone_number'],
                    'role': existing_user['role']
                }
            })
            
        
        # 如果用户不存在且没有提供用户名，返回404
        if not username:
            return jsonify({'error': 'user_not_found'}), 404
        print("到这里了")
        # 如果用户不存在且提供了用户名，创建新用户
        password = "123"
        cur.execute(
            'INSERT INTO "user" (username, phone_number,password) VALUES (%s, %s, %s) RETURNING id, username, phone_number, role',
            (username, phone_number,password)
        )
        new_user = cur.fetchone()
        conn.commit()
        # 生成访问令牌
        access_token = create_access_token(identity=new_user['id'])
        return jsonify({
            'access_token': access_token,
                'user': {
                    'id': new_user['id'],
                    'username': new_user['username'],
                    'phone_number': new_user['phone_number'],
                    'role': new_user['role']
                }
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
    log.debug("开始获取考试记录列表")
    try:
        search = request.args.get('search', '')

        query = """
            WITH ExamPaperQuestionCounts AS (
                SELECT
                    epq.exam_paper_id,
                    COUNT(DISTINCT epq.question_id) AS total_questions,
                    COUNT(DISTINCT CASE WHEN q.question_type = '单选题' THEN epq.question_id END) AS single_choice_total,
                    COUNT(DISTINCT CASE WHEN q.question_type = '多选题' THEN epq.question_id END) AS multi_choice_total
                FROM exampaperquestion epq
                JOIN question q ON epq.question_id = q.id
                GROUP BY epq.exam_paper_id
            )
            SELECT
                ep.id AS exam_paper_id,
                ep.title AS exam_title,
                ep.description AS exam_description,
                ar.user_id,
                ar.created_at AS exam_time,
                SUM(ar.score) AS total_score,
                SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS correct_count,  -- 直接在主查询中计算
                epqc.total_questions,
                CASE
                    WHEN epqc.total_questions = 0 THEN 0.00
                    ELSE ROUND((CAST(SUM(CASE WHEN ar.score > 0 THEN 1 ELSE 0 END) AS DECIMAL) / epqc.total_questions) * 100, 2)
                END AS accuracy_rate,
                u.username AS user_name,
                u.phone_number,
                array_agg(DISTINCT tc.course_name) AS course_names,
                epqc.single_choice_total,
                SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_correct,
                COALESCE(epqc.single_choice_total, 0) - SUM(CASE WHEN q.question_type = '单选题' AND ar.score = 1 THEN 1 ELSE 0 END) AS single_choice_incorrect,
                epqc.multi_choice_total,
                SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_correct,
                COALESCE(epqc.multi_choice_total, 0) - SUM(CASE WHEN q.question_type = '多选题' AND ar.score = 2 THEN 1 ELSE 0 END) AS multi_choice_incorrect
            FROM answerrecord ar
            JOIN exampaper ep ON ar.exam_paper_id = ep.id
            JOIN "user" u ON ar.user_id = u.id
            LEFT JOIN exampapercourse epc ON ep.id = epc.exam_paper_id
            LEFT JOIN trainingcourse tc ON epc.course_id = tc.id
            JOIN ExamPaperQuestionCounts epqc ON ep.id = epqc.exam_paper_id
            JOIN question q ON q.id = ar.question_id  -- 移动到这里
            WHERE
                CASE
                    WHEN %s != '' THEN
                        u.username ILIKE '%%' || %s || '%%' OR
                        u.phone_number ILIKE '%%' || %s || '%%'
                    ELSE TRUE
                END
            GROUP BY
                ep.id,
                ep.title,
                ep.description,
                ar.user_id,
                ar.created_at,  -- 加入到 GROUP BY
                u.username,
                u.phone_number,
                epqc.total_questions,
                epqc.single_choice_total,
                epqc.multi_choice_total
            ORDER BY ar.created_at DESC;
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
                    'correct_count': record[6],
                    'total_questions': record[7],
                    'accuracy_rate': record[8]/100,
                    'user_name': record[9],
                    'phone_number': record[10],
                    'courses': record[11] if record[11] else [],
                    'single_choice_total': record[12],
                    'single_choice_correct': record[13],
                    'single_choice_incorrect': record[14],
                    'multi_choice_total': record[15],
                    'multi_choice_correct': record[16],
                    'multi_choice_incorrect': record[17],
                }
                result.append(exam_record)

            return jsonify(result)
        finally:
            cur.close()
            conn.close()

    except Exception as e:
        print(f"Error in get_exam_records: {str(e)}")
        log.debug(f"Error in get_exam_records: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/questions', methods=['GET'])
def get_questions():
    print("开始获取题目列表")
    title = request.args.get('title', '')
    knowledge_point = request.args.get('knowledgePoint', '')
    course = request.args.get('course', '')
    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        conditions = []
        params = []

        if title:
            conditions.append("q.question_text ILIKE %s")
            params.append(f'%{title}%')

        if knowledge_point:
            conditions.append("kp.id = %s")
            params.append(knowledge_point)

        if course:
            conditions.append("tc.id = %s")
            params.append(course)

        where_clause = " AND ".join(conditions) if conditions else "TRUE"

        # 获取总记录数
        count_query = """
            SELECT COUNT(DISTINCT q.id)
            FROM question q
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            WHERE """
        count_query += where_clause

        cur.execute(count_query, params)
        total = cur.fetchone()['count']

        # 获取分页数据
        query = """
            SELECT DISTINCT
                q.id,
                q.question_text,
                q.question_type,
                q.difficulty,
                q.created_at,
                q.updated_at,
                kp.id as knowledge_point_id,
                kp.point_name as knowledge_point_name,
                tc.id as course_id,
                tc.course_name,
                a.answer_text,
                a.explanation,
                a.source
            FROM question q
            LEFT JOIN knowledgepoint kp ON q.knowledge_point_id = kp.id
            LEFT JOIN trainingcourse tc ON kp.course_id = tc.id
            LEFT JOIN answer a ON q.id = a.question_id
            WHERE """

        query += where_clause
        query += " ORDER BY q.created_at DESC, q.id ASC"
        query += " LIMIT %s OFFSET %s"

        # 添加分页参数
        params.extend([per_page, (page - 1) * per_page])

        cur.execute(query, params)
        questions = cur.fetchall()

        # 获取每个题目的选项
        for question in questions:
            cur.execute('''
                SELECT id, option_text, is_correct
                FROM option
                WHERE question_id = %s
                ORDER BY id ASC
            ''', (question['id'],))
            question['options'] = cur.fetchall()
        # print("API Response:questions", questions)
        return jsonify({
            'data': questions,
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        })
    except Exception as e:
        print("Error in get_questions:", str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# 自动保存答题进度的路由
@app.route('/api/exams/<exam_id>/temp-answers', methods=['POST'])
def save_temp_answer_route(exam_id):
    data = request.json
    user_id = data.get('user_id')
    question_id = data.get('question_id')
    selected_options = data.get('selected_options', [])
    
    return save_temp_answer(exam_id, user_id, question_id, selected_options)

@app.route('/api/exams/<exam_id>/temp-answers/<user_id>', methods=['GET'])
def get_temp_answers_route(exam_id, user_id):
    return get_temp_answers(exam_id, user_id)

@app.route('/api/exams/<exam_id>/temp-answers/<user_id>/submit', methods=['POST'])
def mark_temp_answers_submitted_route(exam_id, user_id):
    return mark_temp_answers_submitted(exam_id, user_id)

@app.route('/api/exam-records/<exam_id>/<user_id>', methods=['GET'])
def get_exam_record_detail(exam_id, user_id):
    print("开始获取考试记录详情，考试ID：", exam_id, "用户ID：", user_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        exam_time = request.args.get('exam_time')
        if not exam_time:
            return jsonify({'error': 'exam_time is required'}), 400
            
        # print("收到的考试时间：", exam_time)
        try:
            exam_time = exam_time.replace(' ', 'T')
            exam_time = exam_time.replace('Z', '+00:00')
            if '+' in exam_time and ':' not in exam_time.split('+')[1]:
                parts = exam_time.split('+')
                exam_time = f"{parts[0]}+{parts[1][:2]}:{parts[1][2:]}"
            # print("转换后的考试时间：", exam_time)
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
                ROUND(CAST(AVG(ar.score)::float / COUNT(*) * 100 as numeric), 2) as total_score,
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

@app.route('/api/courses/knowledge-points', methods=['GET'])
def get_courses_knowledge_points():
    print("开始获取课程知识点列表")
    course_ids = request.args.get('course_ids', '')
    if not course_ids:
        return jsonify({'error': '课程ID不能为空'}), 400
        
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        course_id_list = course_ids.split(',')
        # print("Fetching knowledge points for courses:", course_id_list)
        
        query = "WITH questioncounts AS (SELECT q.knowledge_point_id, SUM(CASE WHEN q.question_type = '单选题' THEN 1 ELSE 0 END) as single_count, SUM(CASE WHEN q.question_type = '多选题' THEN 1 ELSE 0 END) as multiple_count FROM question q GROUP BY q.knowledge_point_id) SELECT kp.id, kp.point_name as name, kp.course_id, COALESCE(qc.single_count, 0)::integer as single_count, COALESCE(qc.multiple_count, 0)::integer as multiple_count FROM knowledgepoint kp LEFT JOIN questioncounts qc ON kp.id = qc.knowledge_point_id WHERE kp.course_id::text = ANY(%s) ORDER BY kp.point_name"
        
        cur.execute(query, (course_id_list,))
        points = cur.fetchall()
        print("SQL query executed successfully")
        # print("Knowledge points found:", len(points))
        # print("First point example:", points[0] if points else "No points found")
        return jsonify(points)
    except Exception as e:
        print('Error in get_courses_knowledge_points:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/exams/<exam_id>', methods=['PATCH'])
def patch_exam(exam_id):
    print("开始更新考卷基本信息，考卷ID：", exam_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        data = request.json
        title = data.get('title')
        description = data.get('description', '')
        
        if not title:
            return jsonify({'error': '考卷标题不能为空'}), 400
            
        # 检查考卷是否存在
        cur.execute('SELECT id FROM exampaper WHERE id = %s', (exam_id,))
        if not cur.fetchone():
            return jsonify({'error': '考卷不存在'}), 404
            
        # 更新考卷基本信息
        cur.execute('''
            UPDATE exampaper
            SET title = %s,
                description = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, title, description, updated_at
        ''', (title, description, exam_id))
        
        updated_exam = cur.fetchone()
        conn.commit()
        return jsonify(updated_exam)
    except Exception as e:
        conn.rollback()
        print('Error in patch_exam:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/evaluation/<evaluation_id>', methods=['GET'])
def get_evaluation_detail(evaluation_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取评价基本信息和详细评分
        cur.execute("""
            WITH evaluation_scores AS (
                SELECT 
                    ei.id as item_id,
                    ei.item_name,
                    ei.description,
                    ec.id as category_id,
                    ec.category_name,
                    ea.id as aspect_id,
                    ea.aspect_name,
                    ed.score
                FROM evaluation e
                JOIN evaluation_detail ed ON e.id = ed.evaluation_id
                JOIN evaluation_item ei ON ed.item_id = ei.id
                JOIN evaluation_category ec ON ei.category_id = ec.id
                JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
                WHERE e.id = %s
            )
            SELECT json_build_object(
                'id', e.id,
                'evaluator_name', u.username,
                'evaluation_time', e.evaluation_time,
                'average_score', COALESCE((SELECT AVG(score) FROM evaluation_detail WHERE evaluation_id = e.id), 0),
                'aspects', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', a.aspect_id,
                            'name', a.aspect_name,
                            'score', a.avg_score,
                            'categories', COALESCE(
                                (SELECT json_agg(
                                    json_build_object(
                                        'id', c.category_id,
                                        'name', c.category_name,
                                        'score', c.avg_score,
                                        'items', COALESCE(
                                            (SELECT json_agg(
                                                json_build_object(
                                                    'id', es.item_id,
                                                    'name', es.item_name,
                                                    'description', es.description,
                                                    'score', es.score
                                                )
                                            )
                                            FROM evaluation_scores es
                                            WHERE es.category_id = c.category_id
                                            GROUP BY c.category_id), '[]'::json)
                                    )
                                )
                                FROM (
                                    SELECT 
                                        category_id,
                                        category_name,
                                        AVG(score) as avg_score
                                    FROM evaluation_scores
                                    WHERE aspect_id = a.aspect_id
                                    GROUP BY category_id, category_name
                                ) c), '[]'::json)
                        )
                    )
                    FROM (
                        SELECT 
                            aspect_id,
                            aspect_name,
                            AVG(score) as avg_score
                        FROM evaluation_scores
                        GROUP BY aspect_id, aspect_name
                    ) a), '[]'::json)
            ) as result
            FROM evaluation e
            JOIN "user" u ON e.evaluator_user_id = u.id
            WHERE e.id = %s
        """, (evaluation_id, evaluation_id))
        
        result = cur.fetchone()
        if not result:
            return jsonify({'error': '未找到评价记录'}), 404
            
        return jsonify(result['result'])
    except Exception as e:
        print('Error in get_evaluation_detail:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/evaluation', methods=['POST'])
def create_evaluation():
    data = request.get_json()
    if not data or 'evaluated_user_id' not in data or 'evaluations' not in data:
        return jsonify({'error': '缺少必要的评价数据'}), 400
    print("开始创建评价记录",data)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取当前用户ID（评价者ID）
        evaluator_id = data['evaluator_user_id']
        if not evaluator_id:
            return jsonify({'error': '未授权的操作'}), 401

        # 插入评价记录
        cur.execute("""
            INSERT INTO evaluation 
            (evaluator_user_id, evaluated_user_id, updated_at)
            VALUES (%s, %s, NOW())
            RETURNING id
        """, (evaluator_id, data['evaluated_user_id']))
        evaluation_id = cur.fetchone()['id']

        # 插入评价项目分数
        for evaluation in data['evaluations']:
            cur.execute("""
                INSERT INTO evaluation_detail
                (evaluation_id, item_id, score)
                VALUES (%s, %s, %s)
            """, (evaluation_id, evaluation['item_id'], evaluation['score']))

        conn.commit()
        return jsonify({'success': True, 'message': '评价提交成功', 'id': evaluation_id})

    except Exception as e:
        conn.rollback()
        print('Error in create_evaluation:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
