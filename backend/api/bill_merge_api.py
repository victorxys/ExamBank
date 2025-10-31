# backend/api/bill_merge_api.py
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required
from backend.services.bill_merge_service import BillMergeService

bill_merge_bp = Blueprint("bill_merge_api", __name__, url_prefix="/api/bill-merges")

@bill_merge_bp.route("", methods=["POST"])
@jwt_required()
def merge_bills():
    """
    处理续约合同的账单合并，支持预览和执行两种模式。
    """
    data = request.get_json()
    source_bill_id = data.get("source_bill_id")
    target_contract_id = data.get("target_contract_id")
    dry_run = data.get("dry_run", False)

    if not source_bill_id or not target_contract_id:
        return jsonify({"error": "源账单ID和目标合同ID均为必填项"}), 400

    service = BillMergeService()

    try:
        if dry_run:
            current_app.logger.info(f"[BillMerge] Getting preview for source_bill_id: {source_bill_id} -> target_contract_id: {target_contract_id}")
            preview_data = service.get_merge_preview(source_bill_id, target_contract_id)
            return jsonify(preview_data)
        else:
            current_app.logger.info(f"[BillMerge] Executing merge for source_bill_id: {source_bill_id} -> target_contract_id: {target_contract_id}")
            result = service.execute_merge(source_bill_id, target_contract_id)
            return jsonify(result)

    except Exception as e:
        current_app.logger.error(
            f"[BillMerge] Error during bill merge operation for source_bill_id: {source_bill_id} -> target_contract_id: {target_contract_id}: {e}",
            exc_info=True
        )
        # 在这里可以根据异常类型返回更具体的错误信息
        return jsonify({"error": "操作失败", "message": str(e)}), 500
