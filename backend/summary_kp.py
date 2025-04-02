# 根据考试id 将考试内容的知识点掌握情况通过ai汇总后插入exam表中

import json

from db import get_db_connection
from psycopg2.extras import RealDictCursor
from flask import  jsonify, request

def get_exam_detail_byid(exam_take_id):
    # 通过exam表的id 考试id获取考试详情
    print("开始获取考试记录详情，考试ID：", exam_take_id)
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
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
                WHERE ar.exam_id = %s
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
        
        detail_params = [exam_take_id]
        cur.execute(detail_query, detail_params)
        questions = cur.fetchall()
        # print("questions===",questions)
        if questions:
            print("执行summary_knowledge_by_ai")
            summary_knowledge_by_ai(questions,exam_take_id)
        # return json.dumps(questions, ensure_ascii=False, indent=4) #使用json.dumps代替jsonify

        # return jsonify(questions)
    except Exception as e:
        print('Error in get_exam_detail_byid:', str(e))
        # return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

def insert_exam_knowledge_points(exam_id, total_score, data):
    """
    将知识点摘要插入到 exam 表的 knowledge_point_summary 字段中。
    """
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        merge_kp_result_json = json.dumps(data, ensure_ascii=False)
        sql = """
            UPDATE exam
            SET knowledge_point_summary = %s, total_score = %s
            WHERE id = %s;
        """
        # sql = """
        #     INSERT INTO exam (id, knowledge_point_summary)
        #     VALUES (%s, %s)
        #     ON CONFLICT (id) DO UPDATE
        #     SET knowledge_point_summary = %s, updated_at = NOW();
        # """

        cur.execute(sql, (merge_kp_result_json, total_score, exam_id))
        conn.commit()

        # logging.info(f"成功插入或更新 exam_id: {exam_id} 的知识点摘要。")

    except json.JSONDecodeError as e:
        print(f"JSON 编码错误，exam_id: {exam_id}, 错误信息: {e}")
    except Exception as e:
        print(f"未知错误，exam_id: {exam_id}, 错误信息: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()


def summary_knowledge_by_ai(exam_date,exam_take_id):
    kp_coreects=[]
    for exam_detail in exam_date:
        if(exam_detail['is_correct']):
            kp_coreect = {
                        'knowledge_point_name' : exam_detail['knowledge_point'],
                        'if_get' : '已掌握',
                    }
        else:
            kp_coreect = {
                        'knowledge_point_name' : exam_detail['knowledge_point'],
                        'if_get' : '未掌握',
                    }

        kp_coreects.append(kp_coreect)
    # print("kp_coreects",kp_coreects)
    from api.ai_generate import merge_kp_name
    merge_kp_result = merge_kp_name(kp_coreects)
    merge_kp_result_json = json.dumps(merge_kp_result, ensure_ascii=False)
    
    insert_exam_knowledge_points(exam_take_id,0,merge_kp_result_json)



get_exam_detail_byid("96e146d4-d5ad-4337-a3ff-5069c095152b")    





