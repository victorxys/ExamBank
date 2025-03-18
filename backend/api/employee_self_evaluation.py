from flask import Blueprint, request, jsonify
from datetime import datetime
import uuid
from db import get_db_connection
from flask_jwt_extended import jwt_required, get_jwt_identity

employee_self_evaluation_bp = Blueprint('employee_self_evaluation', __name__)

@employee_self_evaluation_bp.route('/api/evaluation-items', methods=['GET'])
def get_evaluation_items():
    """
    Public endpoint to get all evaluation items
    Optional query parameter 'visible' to filter items visible to clients/employees
    """
    try:
        visible_only = request.args.get('visible', 'false').lower() == 'true'
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = """
            SELECT ei.id, ei.item_name, ei.description, ec.id as category_id, 
                   ec.category_name, ea.id as aspect_id, ea.aspect_name
            FROM evaluation_item ei
            JOIN evaluation_category ec ON ei.category_id = ec.id
            JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
        """
        
       
            
        cursor.execute(query)
        
        items = []
        for row in cursor.fetchall():
            items.append({
                "id": row[0],
                "item_name": row[1],
                "description": row[2],
                "category_id": row[3],
                "category_name": row[4],
                "aspect_id": row[5],
                "aspect_name": row[6]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({"items": items}), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@employee_self_evaluation_bp.route('/api/employee-self-evaluation', methods=['POST'])
def submit_employee_self_evaluation():
    """
    Public endpoint for submitting employee self-evaluations
    """
    data = request.json
    
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Validate required fields
    required_fields = ['name', 'phone_number', 'evaluations']
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400
    
    # Validate evaluations format
    if not isinstance(data['evaluations'], list) or len(data['evaluations']) == 0:
        return jsonify({"error": "Evaluations must be a non-empty list"}), 400
    
    for evaluation in data['evaluations']:
        if 'item_id' not in evaluation or 'score' not in evaluation:
            return jsonify({"error": "Each evaluation must have item_id and score"}), 400
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create employee self evaluation record
        evaluation_id = str(uuid.uuid4())
        current_time = datetime.now()
        cursor.execute(
            """
            INSERT INTO employee_self_evaluation 
            (id, name, phone_number, additional_comments, evaluation_time, updated_at) 
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                evaluation_id, 
                data['name'], 
                data['phone_number'], 
                data.get('comments', ''),
                current_time,
                current_time
            )
        )
        
        # Insert evaluation details
        for evaluation_item in data['evaluations']:
            cursor.execute(
                """
                INSERT INTO employee_self_evaluation_detail 
                (evaluation_id, item_id, score, created_at) 
                VALUES (%s, %s, %s, %s)
                """,
                (
                    evaluation_id,
                    evaluation_item['item_id'],
                    evaluation_item['score'],
                    current_time
                )
            )
        
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True, 
            "message": "Self-evaluation submitted successfully", 
            "evaluation_id": evaluation_id
        }), 201
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@employee_self_evaluation_bp.route('/api/employee-self-evaluations', methods=['GET'])
# @jwt_required()
def get_employee_self_evaluations():
    """
    Get a list of all employee self-evaluations
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get pagination parameters
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 10))
        search = request.args.get('search', '')
        sort_by = request.args.get('sort_by', 'evaluation_time')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Validate sort parameters
        valid_sort_columns = ['evaluation_time', 'employee_name', 'avg_score']
        if sort_by not in valid_sort_columns:
            sort_by = 'evaluation_time'
        
        if sort_order.lower() not in ['asc', 'desc']:
            sort_order = 'desc'
        
        # Calculate offset for pagination
        offset = (page - 1) * per_page
        
        # Base query for counting total records
        count_query = """
            SELECT COUNT(DISTINCT ese.id)
            FROM employee_self_evaluation ese
        """
        
        # Base query for fetching evaluations with average scores
        base_query = """
            SELECT 
                ese.id, 
                ese.name, 
                ese.phone_number, 
                ese.evaluation_time, 
                ese.additional_comments, 
                ese.updated_at,
                AVG(esd.score) as avg_score
            FROM employee_self_evaluation ese
            LEFT JOIN employee_self_evaluation_detail esd ON ese.id = esd.evaluation_id
        """
        
        # Add search condition if provided
        where_clause = ""
        params = []
        
        if search:
            where_clause = """
                WHERE ese.name LIKE %s OR ese.phone_number LIKE %s
            """
            search_param = f"%{search}%"
            params = [search_param, search_param]
            count_query += where_clause
        
        # Complete the main query
        main_query = base_query + where_clause + """
            GROUP BY ese.id, ese.name, ese.phone_number, ese.evaluation_time, ese.additional_comments, ese.updated_at
            ORDER BY {} {}
            LIMIT %s OFFSET %s
        """.format(
            "evaluation_time" if sort_by == "evaluation_time" else 
            "name" if sort_by == "employee_name" else 
            "avg_score",
            sort_order
        )
        
        # Add pagination parameters
        params.extend([per_page, offset])
        
        # Execute count query
        cursor.execute(count_query, params[:2] if search else [])
        total_count = cursor.fetchone()[0]
        
        # Execute main query
        cursor.execute(main_query, params)
        
        evaluations = []
        for row in cursor.fetchall():
            # Get aspect-specific average scores for this evaluation
            cursor.execute(
                """
                SELECT 
                    ea.aspect_name,
                    AVG(esd.score) as aspect_avg
                FROM employee_self_evaluation_detail esd
                JOIN evaluation_item ei ON esd.item_id = ei.id
                JOIN evaluation_category ec ON ei.category_id = ec.id
                JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
                WHERE esd.evaluation_id = %s
                GROUP BY ea.aspect_name
                """,
                (row[0],)
            )
            
            aspect_scores = {}
            for aspect_row in cursor.fetchall():
                aspect_scores[aspect_row[0]] = round(float(aspect_row[1]), 1)
            
            evaluations.append({
                "id": row[0],
                "employee_name": row[1],
                "phone_number": row[2],
                "evaluation_time": row[3].isoformat() if row[3] else None,
                "comments": row[4],
                "updated_at": row[5].isoformat() if row[5] else None,
                "avg_score": round(float(row[6] or 0), 1),
                "aspect_scores": aspect_scores
            })
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "evaluations": evaluations,
            "total": total_count,
            "page": page,
            "per_page": per_page,
            "total_pages": (total_count + per_page - 1) // per_page
        }), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@employee_self_evaluation_bp.route('/api/employee-self-evaluation/<evaluation_id>', methods=['GET'])
# @jwt_required()
def get_employee_self_evaluation_details(evaluation_id):
    """
    Get detailed information about a specific employee self-evaluation
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get basic evaluation info
        cursor.execute(
            """
            SELECT id, name, phone_number, evaluation_time, additional_comments, updated_at
            FROM employee_self_evaluation
            WHERE id = %s
            """,
            (evaluation_id,)
        )
        
        eval_row = cursor.fetchone()
        if not eval_row:
            return jsonify({"error": "Evaluation not found"}), 404
        
        evaluation = {
            "id": eval_row[0],
            "employee_name": eval_row[1],
            "phone_number": eval_row[2],
            "evaluation_time": eval_row[3].isoformat() if eval_row[3] else None,
            "comments": eval_row[4],
            "updated_at": eval_row[5].isoformat() if eval_row[5] else None,
            "details": []
        }
        
        # Get evaluation details
        cursor.execute(
            """
            SELECT esd.id, ei.item_name, ec.category_name, ea.aspect_name, esd.score
            FROM employee_self_evaluation_detail esd
            JOIN evaluation_item ei ON esd.item_id = ei.id
            JOIN evaluation_category ec ON ei.category_id = ec.id
            JOIN evaluation_aspect ea ON ec.aspect_id = ea.id
            WHERE esd.evaluation_id = %s
            """,
            (evaluation_id,)
        )
        
        for detail_row in cursor.fetchall():
            evaluation["details"].append({
                "id": detail_row[0],
                "item_name": detail_row[1],
                "category_name": detail_row[2],
                "aspect_name": detail_row[3],
                "score": detail_row[4]
            })
        
        cursor.close()
        conn.close()
        
        return jsonify(evaluation), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500