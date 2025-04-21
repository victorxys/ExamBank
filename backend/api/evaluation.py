from flask import jsonify, request
from ..db import get_db_connection
from psycopg2.extras import RealDictCursor
import traceback # <--- 添加这一行导入
import uuid
import json



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
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1. Get aspects with categories and items
        cur.execute("""
            WITH evaluation_scores AS (
                SELECT 
                    ed.item_id, 
                    AVG(ed.score) as average_score,
                    COUNT(ed.id) as evaluation_count
                FROM evaluation e
                JOIN evaluation_detail ed ON e.id = ed.evaluation_id
                WHERE e.evaluated_user_id = %s
                GROUP BY ed.item_id
            )
            SELECT 
                a.id as aspect_id,
                a.aspect_name,
                c.id as category_id,
                c.category_name,
                i.id as item_id,
                i.item_name,
                i.description,
                es.average_score,
                a.sort_order as aspect_order,
                c.sort_order as category_order,
                i.sort_order as item_order,
                CASE WHEN es.evaluation_count > 0 THEN true ELSE false END as has_evaluation
            FROM evaluation_aspect a
            LEFT JOIN evaluation_category c ON c.aspect_id = a.id
            LEFT JOIN evaluation_item i ON i.category_id = c.id
            LEFT JOIN evaluation_scores es ON es.item_id = i.id
            ORDER BY a.sort_order, c.sort_order, i.created_at
        """, (user_id,))
        
        results = cur.fetchall()

        # 2. Get evaluations basic info
        sql_evaluations = """
            SELECT
                e.id,
                e.evaluation_time,
                e.additional_comments,
                COALESCE(u1.username, c.first_name) AS evaluator_name,
                COALESCE(u1.role, c.title) AS evaluator_title,
                CASE
                    WHEN e.evaluator_user_id IS NOT NULL THEN 'internal'
                    WHEN e.evaluator_customer_id IS NOT NULL THEN 'client'
                    ELSE 'unknown'
                END AS evaluation_type,
                -- 使用 COALESCE 避免没有 detail 时 AVG 返回 NULL 导致错误
                COALESCE(AVG(ed.score), 0.0) AS average_score
            FROM evaluation e
            LEFT JOIN evaluation_detail ed ON e.id = ed.evaluation_id
            LEFT JOIN "user" u1 ON e.evaluator_user_id = u1.id
            LEFT JOIN customer c ON e.evaluator_customer_id = c.id
            WHERE e.evaluated_user_id = %s
            GROUP BY e.id, u1.username, c.first_name, u1.role, c.title -- 确保 GROUP BY 包含所有非聚合列
            ORDER BY e.evaluation_time DESC
        """
        print(f"Executing SQL for evaluations list:\n{sql_evaluations}") # 打印 SQL
        cur.execute(sql_evaluations, (user_id,))
        evaluations_list = cur.fetchall()
        print(f"Found {len(evaluations_list)} evaluation(s).")

        # 如果没有评价记录，提前返回
        if not evaluations_list:
            print("No evaluations found, returning empty list.")
            return jsonify({'evaluations': []})

        # --- 第 2 步: 获取所有相关的评价项分数 ---
        evaluation_ids = [str(e['id']) for e in evaluations_list]
        print(f"Fetching item scores for evaluation IDs: {evaluation_ids}")
        item_scores_map = {}
        if evaluation_ids:
            sql_item_scores = """
                SELECT
                    ed.evaluation_id,
                    ed.item_id,
                    ei.item_name,
                    ed.score
                FROM evaluation_detail ed
                JOIN evaluation_item ei ON ed.item_id = ei.id
                WHERE ed.evaluation_id = ANY(%s::uuid[])
            """
            # print(f"Executing SQL for item scores:\n{sql_item_scores}") # 可选打印
            cur.execute(sql_item_scores, (evaluation_ids,))
            item_scores_raw = cur.fetchall()
            for row in item_scores_raw:
                eval_id_str = str(row['evaluation_id'])
                if eval_id_str not in item_scores_map:
                    item_scores_map[eval_id_str] = []
                item_scores_map[eval_id_str].append({
                    "item_id": str(row['item_id']),
                    "item_name": row['item_name'],
                    "score": row['score']
                })
            print(f"Fetched item scores for {len(item_scores_map)} evaluation(s).")

        # --- 第 3 步: 获取所有相关的手动输入 ---
        print(f"Fetching manual inputs for evaluation IDs: {evaluation_ids}")
        manual_inputs_map = {}
        if evaluation_ids:
            sql_manual_inputs = """
                SELECT evaluation_id, category_id, manual_input
                FROM evaluation_manual_input
                WHERE evaluation_id = ANY(%s::uuid[])
                ORDER BY created_at ASC
            """
            # print(f"Executing SQL for manual inputs:\n{sql_manual_inputs}") # 可选打印
            cur.execute(sql_manual_inputs, (evaluation_ids,))
            manual_inputs_raw = cur.fetchall()
            for row in manual_inputs_raw:
                eval_id_str = str(row['evaluation_id'])
                category_id_str = str(row['category_id']) # *** 使用 category_id ***
                if eval_id_str not in manual_inputs_map:
                    manual_inputs_map[eval_id_str] = {}
                if category_id_str not in manual_inputs_map[eval_id_str]:
                    manual_inputs_map[eval_id_str][category_id_str] = []
                manual_inputs_map[eval_id_str][category_id_str].append(row['manual_input'])
            print(f"Fetched manual inputs for {len(manual_inputs_map)} evaluation(s).")


        # 3. Process results into required structure
        print("Processing results into required structure...")
        
        aspects_dict = {}  # 使用字典来存储基于name的aspects
        current_category = None
        


        for row in results:
            aspect_name = row['aspect_name']
            category_id = row['category_id']
            
            # Get or create aspect
            if aspect_name not in aspects_dict:
                aspects_dict[aspect_name] = {
                    'id': row['aspect_id'],
                    'name': aspect_name,
                    'categories': [],
                    'average_score': 0,
                    'aspect_order': row['aspect_order'],
                    '_category_dict': {}  # 临时存储，用于追踪categories
                }
            
            current_aspect = aspects_dict[aspect_name]
            
            # Handle category
            if category_id:
                if category_id not in current_aspect['_category_dict']:
                    new_category = {
                        'id': category_id,
                        'name': row['category_name'],
                        'items': [],
                        'manual_inputs': [],  # 添加manual_inputs字段
                        'category_order': row['category_order'],
                        'average_score': 0
                    }
                    current_aspect['_category_dict'][category_id] = new_category
                    current_aspect['categories'].append(new_category)
                
                current_category = current_aspect['_category_dict'][category_id]
                
                # Add item to category if it exists and has evaluation
                if row['item_id']:
                    if row['has_evaluation']:
                        current_category['items'].append({
                            'id': row['item_id'],
                            'name': row['item_name'],
                            'description': row['description'],
                            'item_order': row['item_order'],
                            'average_score': float(row['average_score'] or 0)
                        })

        # Add manual inputs to categories and ensure categories with only manual inputs are included
        # First, collect all category_ids that have manual inputs
        categories_with_manual_inputs = set()
        for eval_id, categories in manual_inputs_map.items():
            categories_with_manual_inputs.update(categories.keys())
            
            # Add manual inputs to existing categories
            for category_id, inputs in categories.items():
                category_found = False
                for aspect in aspects_dict.values():
                    if category_id in aspect['_category_dict']:
                        aspect['_category_dict'][category_id]['manual_inputs'].extend(inputs)
                        category_found = True
                        break
                
                # If category not found (because it has no items), we need to find its info and create it
                if not category_found:
                    # 查询category信息
                    cur.execute("""
                        SELECT c.id, c.category_name, c.aspect_id, a.aspect_name, c.sort_order as category_order
                        FROM evaluation_category c
                        JOIN evaluation_aspect a ON c.aspect_id = a.id
                        WHERE c.id = %s
                    """, (category_id,))
                    cat_info = cur.fetchone()
                    if cat_info:
                        aspect_name = cat_info['aspect_name']
                        # Create aspect if it doesn't exist
                        if aspect_name not in aspects_dict:
                            aspects_dict[aspect_name] = {
                                'id': cat_info['aspect_id'],
                                'name': aspect_name,
                                'categories': [],
                                'average_score': 0,
                                '_category_dict': {}
                            }
                        # Create category
                        new_category = {
                            'id': category_id,
                            'name': cat_info['category_name'],
                            'items': [],
                            'manual_inputs': inputs,
                            'category_order': cat_info['category_order'],
                            'average_score': 0
                        }
                        aspects_dict[aspect_name]['_category_dict'][category_id] = new_category
                        aspects_dict[aspect_name]['categories'].append(new_category)

        # Calculate averages and clean up temporary data
        aspects = []
        for aspect in aspects_dict.values():
            category_total = 0
            valid_category_count = 0
            valid_categories = []
            
            for category in aspect['categories']:
                # 只保留有items评分或有manual_inputs的categories
                if category['items'] or category['manual_inputs']:
                    # *** 按照 item_order 排序 items ***
                    category['items'].sort(key=lambda x: x.get('item_order', 0))
                    if category['items']:  # 如果有评分items，计算平均分
                        category['average_score'] = sum(item['average_score'] for item in category['items']) / len(category['items'])
                        category_total += category['average_score']
                        valid_category_count += 1
                    else:  # 只有manual_inputs没有评分的category
                        category['average_score'] = 0
                    valid_categories.append(category)
            
            # *** 排序 Categories ***
            valid_categories.sort(key=lambda x: x.get('category_order', 0))
            # 更新aspect的categories为有效的categories
            aspect['categories'] = valid_categories
            
            # Calculate aspect average (only for categories that have evaluations)
            if valid_category_count > 0:
                aspect['average_score'] = category_total / valid_category_count
            else:
                aspect['average_score'] = 0
            
            # Remove temporary tracking dictionary
            del aspect['_category_dict']
            
            # Add to final list if it has any valid categories
            if aspect['categories']:
                aspects.append(aspect)

       
        # Return combined result
        return jsonify({
            'aspects': sorted(aspects, key=lambda x: x['aspect_order']),
            'evaluations': evaluations_list
        })

    except Exception as e:
        print(f"Error in get_user_evaluations: {str(e)}")
        traceback.print_exc()
        return jsonify({'error': '获取评价列表失败: ' + str(e)}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()
        print("--- Finished fetching evaluations ---")

# --- 更新后的 update_evaluation 函数 ---
def update_evaluation(evaluation_id, data):
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        print(f"开始更新评价记录，评价ID: {evaluation_id}")
        print(f"接收到的数据: {json.dumps(data, indent=2)}") # 打印接收到的数据用于调试

        # 验证评价记录是否存在
        cur.execute("SELECT id, evaluator_customer_id FROM evaluation WHERE id = %s", (evaluation_id,))
        evaluation_record = cur.fetchone()
        if not evaluation_record:
            return jsonify({'error': '未找到评价记录'}), 404

        # 1. 更新 evaluation 表 (主要是 additional_comments 和 updated_at)
        additional_comments = data.get('additional_comments', '') # 获取总体补充说明
        cur.execute("""
            UPDATE evaluation
            SET additional_comments = %s,
                updated_at = NOW()
            WHERE id = %s
        """, (additional_comments, evaluation_id))
        print(f"已更新 evaluation 表 for ID: {evaluation_id}")

        # 2. 处理评分项 (evaluation_detail)
        item_scores = data.get('item_scores')
        if item_scores is not None: # 仅当提供了 item_scores 时处理
            if not isinstance(item_scores, list):
                conn.rollback()
                return jsonify({'error': '评分数据格式错误：item_scores 必须是数组'}), 400

             # a. 删除旧的评分记录
            cur.execute("DELETE FROM evaluation_detail WHERE evaluation_id = %s", (evaluation_id,))
            print(f"已删除旧的 evaluation_detail 记录 for evaluation_id: {evaluation_id}")

            # b. 插入新的评分记录
            for item_score in item_scores:
                item_id = item_score.get('item_id')
                score_raw = item_score.get('score')
                score = None # 默认为 NULL

                if item_id is None or score_raw is None:
                    print(f"警告: item_scores 中缺少 item_id 或 score, 跳过: {item_score}")
                    continue

                if score_raw != '' and score_raw is not None:
                    try:
                        score_val = int(score_raw)
                        if 0 <= score_val <= 100:
                            score = score_val
                        else:
                           print(f"警告: score 值 {score_val} 超出范围 [0, 100]，将设为 NULL")
                    except (ValueError, TypeError):
                        print(f"警告: 无法将 score '{score_raw}' 转换为整数，将设为 NULL")

                try:
                    cur.execute("""
                        INSERT INTO evaluation_detail (evaluation_id, item_id, score, created_at)
                        VALUES (%s, %s, %s, NOW())
                    """, (evaluation_id, item_id, score))
                except Exception as insert_detail_error:
                     print(f"插入 evaluation_detail 失败: eval_id={evaluation_id}, item_id={item_id}, score={score}, 错误: {insert_detail_error}")
                     conn.rollback() # 单条插入失败也回滚
                     raise # 重新抛出异常，让全局错误处理捕获

            print(f"已处理 {len(item_scores)} 条 item_scores for evaluation_id: {evaluation_id}")

        # 3. 处理按类别的手动输入 (evaluation_manual_input)
        category_manual_inputs = data.get('category_manual_inputs')
        if category_manual_inputs is not None: # 仅当提供了 category_manual_inputs 时处理
            if not isinstance(category_manual_inputs, dict):
                conn.rollback()
                return jsonify({'error': '手动输入数据格式错误：category_manual_inputs 必须是对象'}), 400

            # a. 删除旧的手动输入记录
            cur.execute("DELETE FROM evaluation_manual_input WHERE evaluation_id = %s", (evaluation_id,))
            print(f"已删除旧的 evaluation_manual_input 记录 for evaluation_id: {evaluation_id}")

            # b. 插入新的手动输入记录 (只插入非空文本)
            manual_inputs_inserted = 0
            for category_id_str, manual_input_text in category_manual_inputs.items():
                if manual_input_text and str(manual_input_text).strip(): # 确保不为空或仅有空白
                    try:
                        # 验证 category_id 是否是有效的 UUID
                        category_id = str(uuid.UUID(category_id_str))
                        cur.execute("""
                            INSERT INTO evaluation_manual_input (evaluation_id, category_id, manual_input, created_at)
                            VALUES (%s, %s, %s, NOW())
                        """, (evaluation_id, category_id, str(manual_input_text).strip()))
                        manual_inputs_inserted += 1
                    except ValueError:
                         print(f"警告: 无效的 category_id '{category_id_str}'，跳过手动输入。")
                    except Exception as insert_manual_error:
                         print(f"插入 evaluation_manual_input 失败: eval_id={evaluation_id}, cat_id={category_id_str}, 错误: {insert_manual_error}")
                         conn.rollback() # 单条插入失败也回滚
                         raise # 重新抛出异常
            print(f"已处理 {manual_inputs_inserted} 条 category_manual_inputs for evaluation_id: {evaluation_id}")

        # 如果是客户评价，还需要更新 customer 表 (如果前端传了 client_name)
        if evaluation_record['evaluator_customer_id'] and 'client_name' in data:
            cur.execute("""
                UPDATE customer SET first_name = %s, title = %s, updated_at = NOW() WHERE id = %s
            """, (data.get('client_name'), data.get('client_title', ''), evaluation_record['evaluator_customer_id']))
            print(f"已更新 customer 表 for customer_id: {evaluation_record['evaluator_customer_id']}")


        conn.commit()
        print(f"评价更新成功，评价ID: {evaluation_id}")
        return jsonify({'success': True, 'message': '评价更新成功', 'id': evaluation_id})

    except Exception as e:
        if conn:
            conn.rollback()
        print(f'Error in update_evaluation for ID {evaluation_id}: {str(e)}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'更新评价时发生内部错误: {str(e)}'}), 500
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
