from flask import jsonify
from ..db import get_db_connection
from psycopg2.extras import RealDictCursor

def get_evaluation_items():
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cur.execute("""
            SELECT 
                id,
                item_name,
                description,
                created_at,
                updated_at
            FROM evaluation_item
            ORDER BY created_at DESC
        """)
        items = cur.fetchall()
        return jsonify(items)
    except Exception as e:
        print('Error in get_evaluation_items:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

def get_user_evaluations(user_id):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        # 获取评价结构和平均分
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
                    AVG(ed.score) as average_score
                FROM evaluation e
                JOIN evaluation_detail ed ON e.id = ed.evaluation_id
                JOIN evaluation_item ei ON ed.item_id = ei.id
                JOIN evaluation_category ec ON ei.category_id = ec.id
                JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
                WHERE e.evaluated_user_id = %s
                GROUP BY ei.id, ei.item_name, ei.description, ec.id, ec.category_name, ea.id, ea.aspect_name
            )
            SELECT json_build_object(
                'aspects', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', a.aspect_id,
                            'name', a.aspect_name,
                            'average_score', a.avg_score,
                            'categories', COALESCE(
                                (SELECT json_agg(
                                    json_build_object(
                                        'id', c.category_id,
                                        'name', c.category_name,
                                        'average_score', c.avg_score,
                                        'items', COALESCE(
                                            (SELECT json_agg(
                                                json_build_object(
                                                    'id', es.item_id,
                                                    'name', es.item_name,
                                                    'description', es.description,
                                                    'average_score', es.average_score
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
                                        AVG(average_score) as avg_score
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
                            AVG(average_score) as avg_score
                        FROM evaluation_scores
                        GROUP BY aspect_id, aspect_name
                    ) a), '[]'::json),
                'evaluations', COALESCE(
                    (SELECT json_agg(
                        json_build_object(
                            'id', e.id,
                            'evaluator_name', u1.username,
                            'evaluation_time', e.evaluation_time,
                            'average_score', COALESCE(eval_avg.avg_score, 0),
                            'additional_comments', e.additional_comments
                        )
                        ORDER BY e.evaluation_time DESC
                    )
                    FROM evaluation e
                    LEFT JOIN "user" u1 ON e.evaluator_user_id = u1.id
                    LEFT JOIN LATERAL (
                        SELECT AVG(ed.score) as avg_score
                        FROM evaluation_detail ed
                        WHERE ed.evaluation_id = e.id
                    ) eval_avg ON true
                    WHERE e.evaluated_user_id = %s), '[]'::json)
            ) as result
        """, (user_id, user_id))
        
        result = cur.fetchone()['result']
        return jsonify(result)
    except Exception as e:
        print('Error in get_user_evaluations:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

def update_evaluation(evaluation_id, data):
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    try:
        print("开始更新评价记录，评价ID:", evaluation_id)
        print("接收到的数据:", data)

        # 验证评价记录是否存在
        cur.execute("""
            SELECT id FROM evaluation 
            WHERE id = %s
        """, (evaluation_id,))
        if not cur.fetchone():
            return jsonify({'error': '未找到评价记录'}), 404

        # 验证数据格式
        if not isinstance(data.get('evaluations'), list):
            return jsonify({'error': '评价数据格式错误：evaluations必须是数组'}), 400

        for evaluation in data['evaluations']:
            if not isinstance(evaluation, dict) or \
               'item_id' not in evaluation or \
               'score' not in evaluation:
                return jsonify({'error': '评价数据格式错误：每个评价项必须包含item_id和score'}), 400

            if not isinstance(evaluation['score'], (int, float)) or \
               evaluation['score'] < 0 or evaluation['score'] > 100:
                return jsonify({'error': f'评分值无效：{evaluation["score"]}，分数必须在0-100之间'}), 400

        # 更新评价时间和补充说明
        cur.execute("""
            UPDATE evaluation 
            SET updated_at = NOW(),
                additional_comments = %s
            WHERE id = %s
        """, (data.get('additional_comments'), evaluation_id))

        # 更新评价项目分数
        if 'evaluations' in data:
            # 先删除原有的评分记录
            cur.execute("""
                DELETE FROM evaluation_detail 
                WHERE evaluation_id = %s
            """, (evaluation_id,))

            # 插入新的评分记录
            for evaluation in data['evaluations']:
                try:
                    cur.execute("""
                        INSERT INTO evaluation_detail
                        (evaluation_id, item_id, score)
                        VALUES (%s, %s, %s)
                    """, (evaluation_id, evaluation['item_id'], evaluation['score']))
                except Exception as e:
                    print(f"插入评分记录失败: evaluation_id={evaluation_id}, item_id={evaluation['item_id']}, score={evaluation['score']}")
                    raise e

        conn.commit()
        print("评价更新成功，评价ID:", evaluation_id)
        return jsonify({'success': True, 'message': '评价更新成功', 'id': evaluation_id})

    except Exception as e:
        conn.rollback()
        print('Error in update_evaluation:', str(e))
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()