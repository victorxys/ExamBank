# backend/api/contract_api.py
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required
from backend.models import (
    db,
    BaseContract,
    User,
    SubstituteRecord,
    CustomerBill,
    EmployeePayroll,
    FinancialActivityLog,
)
from backend.tasks import calculate_monthly_billing_task
from backend.services.billing_engine import BillingEngine
from datetime import datetime
import decimal
from sqlalchemy.exc import IntegrityError

D = decimal.Decimal

contract_bp = Blueprint("contract_api", __name__, url_prefix="/api/contracts")


@contract_bp.route("/<string:contract_id>/substitutes", methods=["POST"])
@jwt_required()
def create_substitute_record(contract_id):
    data = request.get_json()
    required_fields = [
        "substitute_user_id",
        "start_date",
        "end_date",
        "employee_level",
        "substitute_type",
    ]
    if not all(field in data for field in required_fields):
        return jsonify({"error": "Missing required fields"}), 400

    try:
        start_date = datetime.strptime(data["start_date"], "%Y-%m-%d").date()
        end_date = datetime.strptime(data["end_date"], "%Y-%m-%d").date()
        employee_level = D(data["employee_level"])
        substitute_type = data["substitute_type"]

        main_contract = BaseContract.query.get(contract_id)
        if not main_contract:
            return jsonify({"error": "Main contract not found"}), 404

        substitute_user = User.query.get(data["substitute_user_id"])
        if not substitute_user:
            return jsonify({"error": "Substitute user not found"}), 404

        # 1. Create the record
        new_record = SubstituteRecord(
            main_contract_id=str(contract_id),
            substitute_user_id=data["substitute_user_id"],
            start_date=start_date,
            end_date=end_date,
            substitute_salary=employee_level,
            substitute_type=substitute_type,
            substitute_management_fee=D(data.get("management_fee_rate", "0.25"))
            if substitute_type == "maternity_nurse"
            else D("0"),
        )
        db.session.add(new_record)
        db.session.commit()

        # 2. Call the centralized processing logic in the engine
        engine = BillingEngine()
        engine.process_substitution(new_record.id)

        return jsonify(
            {
                "message": "替班记录已创建，相关账单已更新。",
                "record_id": str(new_record.id),
            }
        ), 201

    except ValueError:
        return jsonify({"error": "Invalid date or amount format"}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Failed to create substitute record: {e}", exc_info=True
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/<string:contract_id>/substitutes", methods=["GET"])
@jwt_required()
def get_substitute_records(contract_id):
    try:
        records = (
            SubstituteRecord.query.filter_by(main_contract_id=contract_id)
            .order_by(SubstituteRecord.start_date.desc())
            .all()
        )
        result = [
            {
                "id": str(record.id),
                "substitute_user_id": str(record.substitute_user_id),
                "substitute_user_name": record.substitute_user.username
                if record.substitute_user
                else "N/A",
                "start_date": record.start_date.isoformat(),
                "end_date": record.end_date.isoformat(),
                "substitute_salary": str(record.substitute_salary),
                "substitute_management_fee": str(record.substitute_management_fee),
                "created_at": record.created_at.isoformat(),
                "original_customer_bill_id": str(record.original_customer_bill_id) if record.original_customer_bill_id else None,
            }
            for record in records
        ]
        return jsonify(result)
    except Exception as e:
        current_app.logger.error(
            f"Failed to get substitute records for contract {contract_id}: {e}",
            exc_info=True,
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/substitutes/<string:record_id>", methods=["DELETE"])
@jwt_required()
def delete_substitute_record(record_id):
    force_delete = request.args.get("force", "false").lower() == "true"

    sub_record = SubstituteRecord.query.get(record_id)
    if not sub_record:
        return jsonify({"error": "Substitute record not found"}), 404

    try:
        recalc_info = None
        if sub_record.original_customer_bill_id:
            original_bill = CustomerBill.query.get(sub_record.original_customer_bill_id)
            if original_bill:
                recalc_info = {
                    "year": original_bill.year,
                    "month": original_bill.month,
                    "contract_id": original_bill.contract_id,
                }
        current_app.logger.info(
            f"Deleting substitute record {record_id} for contract {sub_record.main_contract_id}, force delete: {force_delete}"
        )
        if force_delete:
            if sub_record.generated_bill_id:
                FinancialActivityLog.query.filter_by(
                    customer_bill_id=sub_record.generated_bill_id
                ).delete(synchronize_session=False)
            if sub_record.generated_payroll_id:
                FinancialActivityLog.query.filter_by(
                    employee_payroll_id=sub_record.generated_payroll_id
                ).delete(synchronize_session=False)

        if sub_record.generated_bill_id:
            CustomerBill.query.filter_by(id=sub_record.generated_bill_id).delete(
                synchronize_session=False
            )
        if sub_record.generated_payroll_id:
            EmployeePayroll.query.filter_by(id=sub_record.generated_payroll_id).delete(
                synchronize_session=False
            )

        db.session.delete(sub_record)
        db.session.flush()

        if recalc_info:
            engine = BillingEngine()
            engine.calculate_for_month(
                recalc_info["year"],
                recalc_info["month"],
                recalc_info["contract_id"],
                force_recalculate=True,
            )

        db.session.commit()

        return jsonify({"message": "Substitute record deleted successfully."}), 200

    except IntegrityError as e:
        db.session.rollback()
        if "financial_activity_logs" in str(e.orig):
            return jsonify(
                {
                    "error": "conflict_logs_exist",
                    "message": "Cannot delete because associated bill/payroll has activity logs. Use force=true to override.",
                }
            ), 409
        else:
            current_app.logger.error(
                f"Integrity error on delete substitute record {record_id}: {e}",
                exc_info=True,
            )
            return jsonify({"error": "Database integrity error"}), 500

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(
            f"Failed to delete substitute record {record_id}: {e}", exc_info=True
        )
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/<uuid:contract_id>/terminate", methods=["POST"])
@jwt_required()
def terminate_contract(contract_id):
    data = request.get_json()
    termination_date_str = data.get("termination_date")

    if not termination_date_str:
        return jsonify({"error": "Termination date is required"}), 400

    try:
        termination_date = datetime.strptime(termination_date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400

    contract = BaseContract.query.get_or_404(contract_id)

    # --- 修复开始: 精确删除未来月份的账单，而不是当月的 ---
    termination_year = termination_date.year
    termination_month = termination_date.month

    # 构建查询，查找所有在终止月份之后的账单
    bills_to_delete_query = CustomerBill.query.with_entities(CustomerBill.id).filter(
        CustomerBill.contract_id == contract_id,
        ((CustomerBill.year == termination_year) & (CustomerBill.month > termination_month)) |
        (CustomerBill.year > termination_year)
    )
    bill_ids_to_delete = [item[0] for item in bills_to_delete_query.all()]

    # 构建查询，查找所有在终止月份之后的薪酬单
    payrolls_to_delete_query = EmployeePayroll.query.with_entities(
        EmployeePayroll.id
    ).filter(
        EmployeePayroll.contract_id == contract_id,
        ((EmployeePayroll.year == termination_year) & (EmployeePayroll.month > termination_month)) |
        (EmployeePayroll.year > termination_year)
    )
    payroll_ids_to_delete = [item[0] for item in payrolls_to_delete_query.all()]
    # --- 修复结束 ---

    if bill_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.customer_bill_id.in_(bill_ids_to_delete)
        ).delete(synchronize_session=False)

    if payroll_ids_to_delete:
        FinancialActivityLog.query.filter(
            FinancialActivityLog.employee_payroll_id.in_(payroll_ids_to_delete)
        ).delete(synchronize_session=False)

    if bill_ids_to_delete:
        CustomerBill.query.filter(CustomerBill.id.in_(bill_ids_to_delete)).delete(
            synchronize_session=False
        )

    if payroll_ids_to_delete:
        EmployeePayroll.query.filter(
            EmployeePayroll.id.in_(payroll_ids_to_delete)
        ).delete(synchronize_session=False)

    contract.status = "terminated"
    contract.end_date = termination_date

    if contract.type == "maternity_nurse":
        contract.expected_offboarding_date = termination_date

    year = termination_date.year
    month = termination_date.month

    # 关键修复：先提交数据库事务，再触发异步任务，防止并发竞争
    db.session.commit()

    calculate_monthly_billing_task.delay(
        year, month, contract_id=str(contract_id), force_recalculate=True
    )

    current_app.logger.info(
        f"Contract {contract_id} terminated on {termination_date}. Recalculation triggered for {year}-{month}."
    )

    return jsonify(
        {
            "message": f"Contract {contract_id} has been terminated. Recalculation for {year}-{month} is in progress."
        }
    )


@contract_bp.route("/<uuid:contract_id>/succeed", methods=["POST"])
@jwt_required()
def succeed_trial_contract(contract_id):
    contract = BaseContract.query.get_or_404(contract_id)

    if contract.type != "nanny_trial":
        return jsonify({"error": "Only trial contracts can succeed."}), 400

    if contract.status != "trial_active":
        return jsonify(
            {
                "error": f"Contract is not in trial_active state, but in {contract.status}."
            }
        ), 400

    contract.status = "trial_succeeded"
    db.session.commit()

    current_app.logger.info(
        f"Trial contract {contract_id} has been marked as 'trial_succeeded'."
    )
    return jsonify({"message": "Trial contract marked as succeeded."})
