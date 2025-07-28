import uuid
from flask import jsonify
from psycopg2.extras import RealDictCursor
from backend.db import get_db_connection  # 使用绝对导入

def save_temp_answer(exam_id, user_id, question_id, selected_options):
    """保存临时答案"""
    print(f"开始保存临时答案，参数：exam_id={exam_id}, user_id={user_id}, question_id={question_id}, selected_options={selected_options}")
    conn = None
    cur = None
    try:
        # 验证输入参数
        exam_uuid = str(uuid.UUID(exam_id))
        user_uuid = str(uuid.UUID(user_id))
        question_uuid = str(uuid.UUID(question_id))
        
        print(f"参数验证通过，转换后的UUID：exam_uuid={exam_uuid}, user_uuid={user_uuid}, question_uuid={question_uuid}")
        
        # 建立数据库连接
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 确保selected_options是列表
        if not isinstance(selected_options, list):
            selected_options = [selected_options]
        
        # 将选项ID转换为PostgreSQL数组格式
        selected_options_literal = '{' + ','.join(str(uuid.UUID(opt)) for opt in selected_options) + '}'
        print(f"选项ID数组：{selected_options_literal}")
        
        # 先删除可能存在的记录
        cur.execute("""
            DELETE FROM temp_answer_record
            WHERE exam_paper_id = %s
            AND question_id = %s
            AND user_id = %s
            AND is_submitted = false;
        """, (exam_uuid, question_uuid, user_uuid))
        
        # 插入新记录
        cur.execute("""
            INSERT INTO temp_answer_record (
                exam_paper_id,
                question_id,
                selected_option_ids,
                user_id,
                created_at,
                updated_at,
                is_submitted
            ) VALUES (%s, %s, %s, %s, NOW(), NOW(), false)
            RETURNING id;
        """, (exam_uuid, question_uuid, selected_options_literal, user_uuid))
        
        record_id = cur.fetchone()['id']
        print(f"临时答案保存成功，记录ID：{record_id}")
        conn.commit()
        
        return jsonify({
            'success': True,
            'record_id': record_id
        })
        
    except Exception as e:
        print(f"保存临时答案时出错：{str(e)}")
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

def get_temp_answers(exam_id, user_id):
    """获取用户在指定考试中的所有临时答案"""
    conn = None
    cur = None
    try:
        # 验证输入参数
        exam_uuid = str(uuid.UUID(exam_id))
        user_uuid = str(uuid.UUID(user_id))
        
        # 建立数据库连接
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 查询临时答案，使用DISTINCT ON确保每个question_id只返回最新的一条记录
        cur.execute("""
            SELECT DISTINCT ON (question_id)
                question_id,
                selected_option_ids,
                created_at,
                updated_at
            FROM temp_answer_record
            WHERE exam_paper_id = %s
            AND user_id = %s
            AND is_submitted = false
            ORDER BY question_id, updated_at DESC;
        """, (exam_uuid, user_uuid))
        
        temp_answers = cur.fetchall()
        
        return jsonify({
            'success': True,
            'temp_answers': temp_answers
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

def mark_temp_answers_submitted(exam_id, user_id):
    """将临时答案标记为已提交"""
    conn = None
    cur = None
    try:
        # 验证输入参数
        exam_uuid = str(uuid.UUID(exam_id))
        user_uuid = str(uuid.UUID(user_id))
        
        # 建立数据库连接
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 更新临时答案状态
        cur.execute("""
            UPDATE temp_answer_record
            SET is_submitted = true,
                updated_at = NOW()
            WHERE exam_paper_id = %s
            AND user_id = %s
            AND is_submitted = false
            RETURNING id;
        """, (exam_uuid, user_uuid))
        
        affected_records = cur.fetchall()
        conn.commit()
        
        return jsonify({
            'success': True,
            'affected_records': len(affected_records)
        })
        
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()