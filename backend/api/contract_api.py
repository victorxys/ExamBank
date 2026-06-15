# backend/api/contract_api.py
from flask import Blueprint, jsonify, request, current_app, send_file, render_template,send_from_directory
import os
import time
import urllib.parse
from flask_jwt_extended import jwt_required, get_jwt_identity
from backend.models import (
    db,
    BaseContract,
    User,
    SubstituteRecord,
    CustomerBill,
    EmployeePayroll,
    FinancialActivityLog,
    PaymentStatus,
    ContractTemplate,
    SigningStatus, # 导入 SigningStatus 枚举
    TrialOutcome,
    Customer, # 导入 Customer
    ServicePersonnel, # 导入 ServicePersonnel
    NannyContract,MaternityNurseContract,NannyTrialContract, ExternalSubstitutionContract,
    CompanyBankAccount,
    FinancialAdjustment,
    PaymentRecord,
    AttendanceRecord,
    AttendanceForm,
    EmployeeSalaryHistory,
    ContractSignature,
    WechatMessageLog,
    ContractOperationLog,
)
import base64
import requests
from backend.tasks import calculate_monthly_billing_task
from backend.services.billing_engine import BillingEngine, calculate_substitute_management_fee, _update_bill_payment_status
from backend.services.contract_service import (
    ContractService,
    cancel_substitute_bill_due_to_transfer,
    apply_transfer_credits_to_new_contract,
    _find_successor_contract_internal,
    update_salary_history_on_contract_activation # 导入薪资历史服务函数
)
# from backend.api.billing_api import _get_billing_details_internal
from datetime import datetime, timedelta
import decimal
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_, and_, extract, func
from sqlalchemy.orm import joinedload
D = decimal.Decimal
from backend.tasks import calculate_monthly_billing_task, trigger_initial_bill_generation_task
from dateutil.relativedelta import relativedelta # <--- 请确保文件顶部有此导入
from backend.services.contract_operation_log_service import (
    create_contract_operation_log,
    diff_snapshots,
    snapshot_contract,
)
from backend.utils.miniapp_config import get_miniapp_credentials, miniapp_credential_status

contract_bp = Blueprint("contract_api", __name__, url_prefix="/api/contracts")

ONGOING_EMPLOYEE_CONTRACT_STATUSES = ("active", "pending", "trial_active")
_MINIAPP_ACCESS_TOKEN_CACHE = {
    "appid": "",
    "access_token": "",
    "expires_at": 0,
}


def _serialize_employee_ongoing_contract(contract):
    type_choices = {
        "nanny": "育儿嫂合同",
        "maternity_nurse": "月嫂合同",
        "nanny_trial": "育儿嫂试工合同",
        "external_substitution": "外部替班合同",
    }
    return {
        "id": str(contract.id),
        "customer_name": contract.customer_name,
        "service_personnel_id": str(contract.service_personnel_id) if contract.service_personnel_id else None,
        "service_personnel_name": contract.service_personnel.name if contract.service_personnel else None,
        "contract_type_value": contract.type,
        "contract_type_label": type_choices.get(contract.type, contract.type),
        "status": contract.status,
        "start_date": contract.start_date.isoformat() if contract.start_date else None,
        "end_date": contract.end_date.isoformat() if contract.end_date else None,
        "termination_date": contract.termination_date.isoformat() if contract.termination_date else None,
        "is_monthly_auto_renew": getattr(contract, "is_monthly_auto_renew", False),
    }


def _serialize_employee_pending_trial_contract(contract):
    return {
        "id": str(contract.id),
        "customer_name": contract.customer_name,
        "service_personnel_id": str(contract.service_personnel_id) if contract.service_personnel_id else None,
        "service_personnel_name": contract.service_personnel.name if contract.service_personnel else None,
        "contract_type_value": contract.type,
        "contract_type_label": "育儿嫂试工合同",
        "status": contract.status,
        "trial_outcome": contract.trial_outcome.value if contract.trial_outcome else None,
        "start_date": contract.start_date.isoformat() if contract.start_date else None,
        "end_date": contract.end_date.isoformat() if contract.end_date else None,
        "daily_rate": str(contract.employee_level) if contract.employee_level is not None else "",
        "introduction_fee": str(contract.introduction_fee) if contract.introduction_fee is not None else "0",
    }


def _frontend_signing_url(token):
    frontend_base_url = current_app.config.get('FRONTEND_BASE_URL', '').rstrip('/')
    return f"{frontend_base_url}/sign/{token}"


def _miniapp_access_token(config=None):
    now = time.time()
    appid, secret = get_miniapp_credentials((config or {}).get("appid"))
    if (
        _MINIAPP_ACCESS_TOKEN_CACHE["appid"] == appid
        and _MINIAPP_ACCESS_TOKEN_CACHE["access_token"]
        and _MINIAPP_ACCESS_TOKEN_CACHE["expires_at"] > now + 60
    ):
        return _MINIAPP_ACCESS_TOKEN_CACHE["access_token"]

    if not appid or not secret:
        missing = []
        if not appid:
            missing.append("WECHAT_MINIAPP_APPID")
        if not secret:
            missing.append("WECHAT_MINIAPP_SECRET")
        raise RuntimeError(f"未配置 {'/'.join(missing)}")

    response = requests.get(
        "https://api.weixin.qq.com/cgi-bin/token",
        params={
            "grant_type": "client_credential",
            "appid": appid,
            "secret": secret,
        },
        timeout=(3, 8),
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("errcode"):
        raise RuntimeError(payload.get("errmsg") or "获取小程序 access_token 失败")

    access_token = payload.get("access_token")
    if not access_token:
        raise RuntimeError("微信未返回小程序 access_token")

    _MINIAPP_ACCESS_TOKEN_CACHE["appid"] = appid
    _MINIAPP_ACCESS_TOKEN_CACHE["access_token"] = access_token
    _MINIAPP_ACCESS_TOKEN_CACHE["expires_at"] = now + int(payload.get("expires_in") or 7200)
    return access_token


def _generate_miniapp_url_link(token, role, config):
    access_token = _miniapp_access_token(config)
    path = str(config.get("contract_sign_path") or "pages/contract-sign/index").strip().lstrip("/")
    query = urllib.parse.urlencode({"token": token, "role": role})
    expire_days = max(1, min(int(config.get("expire_days") or 30), 30))
    expire_time = int(time.time()) + expire_days * 24 * 60 * 60
    payload = {
        "path": path,
        "query": query,
        "is_expire": True,
        "expire_type": 0,
        "expire_time": expire_time,
        "env_version": config.get("env_version") or "release",
    }

    response = requests.post(
        f"https://api.weixin.qq.com/wxa/generate_urllink?access_token={access_token}",
        json=payload,
        timeout=(3, 8),
    )
    response.raise_for_status()
    data = response.json()
    if data.get("errcode"):
        raise RuntimeError(data.get("errmsg") or "生成小程序链接失败")
    url_link = data.get("url_link")
    if not url_link:
        raise RuntimeError("微信未返回小程序 URL Link")
    return url_link


def _build_contract_signing_link(token, role, miniapp_config=None):
    web_url = _frontend_signing_url(token)
    result = {
        "role": role,
        "web_url": web_url,
        "primary_url": web_url,
        "primary_type": "web",
        "miniapp_url": "",
        "miniapp_error": "",
    }
    config = miniapp_config or {}
    if not config.get("enabled"):
        return result

    try:
        miniapp_url = _generate_miniapp_url_link(token, role, config)
        result.update({
            "primary_url": miniapp_url,
            "primary_type": "miniapp",
            "miniapp_url": miniapp_url,
        })
    except Exception as exc:
        current_app.logger.warning("生成小程序合同签署 URL Link 失败 role=%s token=%s error=%s", role, token, exc)
        result["miniapp_error"] = str(exc)
        if not config.get("fallback_to_web", True):
            raise
    return result


def _get_employee_ongoing_contracts(service_personnel_id, exclude_contract_id=None):
    query = BaseContract.query.options(joinedload(BaseContract.service_personnel)).filter(
        BaseContract.service_personnel_id == service_personnel_id,
        BaseContract.status.in_(ONGOING_EMPLOYEE_CONTRACT_STATUSES),
        BaseContract.type != "nanny_trial",
    )
    if exclude_contract_id:
        query = query.filter(BaseContract.id != str(exclude_contract_id))
    return query.order_by(BaseContract.start_date.desc()).all()


def _get_employee_pending_trial_contracts(service_personnel_id):
    return NannyTrialContract.query.options(joinedload(NannyTrialContract.service_personnel)).filter(
        NannyTrialContract.service_personnel_id == service_personnel_id,
        or_(
            NannyTrialContract.trial_outcome == TrialOutcome.PENDING,
            NannyTrialContract.status == "trial_active",
        ),
    ).order_by(NannyTrialContract.end_date.desc()).all()


# 家庭ID管理相关API
@contract_bp.route("/families", methods=["GET"])
@jwt_required()
def get_existing_families():
    """获取现有的家庭ID列表"""
    try:
        # 查询所有非空的family_id
        families = db.session.query(BaseContract.family_id)\
            .filter(BaseContract.family_id.isnot(None))\
            .distinct()\
            .order_by(BaseContract.family_id)\
            .all()
        
        family_list = [family[0] for family in families if family[0]]
        
        return jsonify({
            "success": True,
            "families": family_list
        })
    except Exception as e:
        current_app.logger.error(f"Failed to get existing families: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@contract_bp.route("/family/<string:family_id>", methods=["GET"])
@jwt_required()
def get_family_contracts(family_id):
    """获取指定家庭的所有合同"""
    try:
        contracts = BaseContract.query.filter_by(family_id=family_id).all()
        
        contract_list = []
        for contract in contracts:
            contract_list.append({
                "id": str(contract.id),
                "customer_name": contract.customer_name,
                "employee_name": contract.employee_name,
                "contract_type_label": getattr(contract, 'contract_type_label', contract.type),
                "start_date": contract.start_date.isoformat() if contract.start_date else None,
                "end_date": contract.end_date.isoformat() if contract.end_date else None,
                "status": contract.status
            })
        
        return jsonify({
            "success": True,
            "contracts": contract_list
        })
    except Exception as e:
        current_app.logger.error(f"Failed to get family contracts: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@contract_bp.route("/<string:contract_id>/family", methods=["PUT"])
@jwt_required()
def update_contract_family(contract_id):
    """更新合同的家庭ID"""
    try:
        data = request.get_json()
        family_id = data.get('family_id')
        
        # 查找合同
        contract = BaseContract.query.get(contract_id)
        if not contract:
            return jsonify({"success": False, "error": "合同不存在"}), 404
        
        # 更新家庭ID
        contract.family_id = family_id if family_id else None
        db.session.commit()
        
        current_app.logger.info(f"Updated contract {contract_id} family_id to {family_id}")
        
        return jsonify({
            "success": True,
            "message": "家庭ID更新成功"
        })
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Failed to update contract family: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@contract_bp.route("/<string:contract_id>/substitutes", methods=["POST"])
@jwt_required()
def create_substitute_record(contract_id):
    data = request.get_json()
    current_app.logger.debug(f"--- [API-CreateSub] START for contract: {contract_id} ---")
    current_app.logger.debug(f"[API-CreateSub] Received data: {data}")

    required_fields = [
        "substitute_user_id",
        "start_date",
        "end_date",
        "employee_level",
        "substitute_type",
    ]
    if not all(field in data and data[field] for field in required_fields):
        return jsonify({"error": "请填写所有必填项"}), 400

    try:
        start_date = datetime.fromisoformat(data["start_date"])
        end_date = datetime.fromisoformat(data["end_date"])
        employee_level = D(data["employee_level"])
        substitute_type = data["substitute_type"]
        original_bill_id = data.get("original_bill_id")
        substitute_management_fee_rate = D(data.get("substitute_management_fee_rate", 0))

        main_contract = BaseContract.query.get(contract_id)
        if not main_contract:
            return jsonify({"error": "Main contract not found"}), 404

        substitute_user = User.query.get(data["substitute_user_id"])
        if not substitute_user:
            return jsonify({"error": "Substitute user not found"}), 404

        # 1. 创建记录并立即保存费率
        new_record = SubstituteRecord(
            main_contract_id=str(contract_id),
            substitute_user_id=data["substitute_user_id"],
            start_date=start_date,
            end_date=end_date,
            substitute_salary=employee_level,
            substitute_type=substitute_type,
            original_customer_bill_id=original_bill_id,
            substitute_management_fee_rate=substitute_management_fee_rate,
        )

        # 2. 根据类型，选择性地预计算费用金额
        if substitute_type == 'nanny':
            # 育儿嫂：调用辅助函数计算仅超出合同期的管理费
            # 该函数现在将使用 new_record 上已保存的费率
            total_fee = calculate_substitute_management_fee(new_record, main_contract)
            new_record.substitute_management_fee = total_fee
        elif substitute_type == 'maternity_nurse':
            # 月嫂：不在API层面计算费用金额，其逻辑更复杂，完全由后续的BillingEngine处理
            new_record.substitute_management_fee = D(0) # 提供一个默认值

        db.session.add(new_record)
        db.session.flush() # flush以获取new_record.id

        # 3. 调用计费引擎，它将使用已保存的费率和金额进行最终的账单生成
        engine = BillingEngine()
        engine.calculate_for_substitute(new_record.id)

        # 如果影响了原始账单，也触发重算
        if original_bill_id:
            original_bill = CustomerBill.query.get(original_bill_id)
            if original_bill:
                engine.calculate_for_month(
                    original_bill.year,
                    original_bill.month,
                    original_bill.contract_id,
                    force_recalculate=True
                )

        db.session.commit()

        current_app.logger.debug(f"--- [API-CreateSub] END for contract: {contract_id} ---")
        return jsonify(
            {
                "message": "替班记录已创建，相关账单已更新。",
                "record_id": str(new_record.id),
            }
        ), 201

    except (ValueError, decimal.InvalidOperation):
        db.session.rollback()
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
        result = []
        for record in records:
            current_app.logger.debug(f"[API-GetSub] Retrieved record ID: {record.id}, start_date:{record.start_date}, end_date: {record.end_date}") # 添加此行
            result.append({
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
                 # 【修复】在这里加上前端需要的替班账单ID
                "substitute_customer_bill_id": str(record.generated_bill_id) if record.generated_bill_id else None,
            })
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

        return jsonify({"message": "Substitute record deleted successfully."}),
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


@contract_bp.route("/<uuid:contract_id>/succeed", methods=["POST"])
@jwt_required()
def succeed_trial_contract(contract_id):
    contract = BaseContract.query.get_or_404(contract_id)

    if contract.type != "nanny_trial":
        return jsonify({"error": "Only trial contracts can succeed."}),

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


@contract_bp.route("/search-unpaid-bills", methods=["GET"])
@jwt_required()
def search_unpaid_bills():
    """
    根据客户名或拼音，搜索指定年月下未付清的账单。
    """
    search_term = request.args.get("search", "").strip()
    year = request.args.get("year", type=int)
    month = request.args.get("month", type=int)

    if not search_term or not year or not month:
        return jsonify([])

    try:
        pinyin_search_term = search_term.replace(" ", "")
        
        query = db.session.query(CustomerBill).join(BaseContract).filter(
            or_(
                BaseContract.customer_name.ilike(f"%{search_term}%"),
                BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%")
            ),
            CustomerBill.year == year,
            CustomerBill.month == month,
            CustomerBill.total_due > 0,
            or_(
                CustomerBill.payment_status == PaymentStatus.UNPAID,
                CustomerBill.payment_status == PaymentStatus.PARTIALLY_PAID
            )
        ).limit(20) # 限制返回结果，避免过多数据

        bills = query.all()

        results = [
            {
                "bill_id": str(bill.id),
                "customer_name": bill.contract.customer_name,
                "employee_name": bill.contract.service_personnel.name if bill.contract.service_personnel else "未知",
                "cycle": f"{bill.cycle_start_date.strftime('%Y-%m-%d')} to {bill.cycle_end_date.strftime('%Y-%m-%d')}",
                "amount_remaining": str(bill.total_due - bill.total_paid)
            }
            for bill in bills
        ]
        
        return jsonify(results)

    except Exception as e:
        current_app.logger.error(f"Failed to search unpaid bills: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500
    
from weasyprint import HTML
import io
from flask import render_template, send_file
import markdown

# 在 backend/api/contract_api.py 文件末尾添加

@contract_bp.route("/signatures/<uuid:signature_id>/image", methods=["GET"])
def get_signature_image(signature_id):
    """
    Serve the signature image file robustly using absolute paths.
    """
    signature = ContractSignature.query.get_or_404(signature_id)

    if not signature.file_path:
        current_app.logger.error(f"Signature record {signature_id} found, but its file_path is empty.")
        return "Signature file path not recorded in database", 404

    # The file_path in DB is relative, e.g., "static/signatures/file.png".
    # `send_from_directory` needs the directory path and the filename separately.
    
    # Let's construct the absolute path to the directory containing the signatures.
    # current_app.root_path is the 'backend' folder.
    signatures_dir = os.path.join(current_app.root_path, 'static', 'signatures')
    filename = os.path.basename(signature.file_path)
    signature_file_path = os.path.join(signatures_dir, filename)

    if not os.path.isfile(signature_file_path):
        current_app.logger.warning(
            f"Signature file not found on disk. Looked for '{filename}' in '{signatures_dir}'."
        )
        return "Signature file not found on disk", 404

    # Use send_from_directory with an absolute directory path.
    # It will handle the file existence check and return a 404 if not found.
    return send_from_directory(signatures_dir, filename)

@contract_bp.route("/<string:contract_id>/download", methods=["GET"])
@jwt_required()
def download_contract_pdf(contract_id):
    """
    生成并下载合同的PDF版本。
    """
    try:
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel)
        ).get_or_404(contract_id)

        if contract.type == 'maternity_nurse':
            pdf_title = "月嫂服务合同"
        else:
            pdf_title = "家政服务合同"

        # 检查签名状态，理论上应该双方都签署了才提供下载
        if contract.signing_status != SigningStatus.SIGNED:
            # 暂时允许下载未完全签署的合同，以便预览
            current_app.logger.warning(f"合同 {contract_id} 正在被下载，但其签署状态为 {contract.signing_status}")

        service_content = contract.service_content
        # 如果 service_content 是一个列表，将其转换为 Markdown 列表字符串
        if isinstance(service_content, list):
            # 如果列表不为空，则格式化为项目符号列表
            if service_content:
                markdown_text = '\n'.join(f'- {item}' for item in service_content)
            else:
                markdown_text = '' # 如果是空列表，则为空字符串
        else:
            # 如果不是列表，则假定为字符串或 None
            markdown_text = service_content or ''
            
        service_content_html = markdown.markdown(markdown_text)
        # 1. 读取并转换主模板内容
        template_content = contract.template.content if contract.template else ''
        main_content_html = markdown.markdown(template_content)
        # 2. 读取并转换附件内容
        attachment_content_html = markdown.markdown(contract.attachment_content) if contract.attachment_content else ''

        # 获取签名 (用于PDF生成，需要使用绝对路径)
        customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').first()
        employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').first()

        # 构造签名文件的绝对路径
        signatures_dir = os.path.join(current_app.root_path, 'static', 'signatures')
        
        customer_sig_abs_path = os.path.join(signatures_dir, os.path.basename(customer_sig.file_path)) if customer_sig and customer_sig.file_path else None
        employee_sig_abs_path = os.path.join(signatures_dir, os.path.basename(employee_sig.file_path)) if employee_sig and employee_sig.file_path else None

        # 使用绝对路径检查文件是否存在，并创建 file:// URI
        customer_signature_path = f"file://{customer_sig_abs_path}" if customer_sig_abs_path and os.path.exists(customer_sig_abs_path) else None
        employee_signature_path = f"file://{employee_sig_abs_path}" if employee_sig_abs_path and os.path.exists(employee_sig_abs_path) else None


        rendered_html = render_template(
            "contract_pdf.html",
            pdf_title=pdf_title, 
            service_content=service_content_html,
            main_content=main_content_html,
            attachment_content=attachment_content_html,
            customer_signature=customer_signature_path,
            employee_signature=employee_signature_path,
            customer=contract.customer,
            employee=contract.service_personnel,
            contract=contract
        )

        pdf_file = HTML(string=rendered_html, base_url=request.url_root).write_pdf()

        # --- 核心修改：构建符合用户要求的下载文件名 ---
        employee_name = contract.service_personnel.name if contract.service_personnel else "未知员工"
        
        # 定义类型映射（带“合同”后缀）
        TYPE_LABELS = {
            "nanny": "育儿嫂合同",
            "maternity_nurse": "月嫂合同",
            "nanny_trial": "育儿嫂试工合同",
            "external_substitution": "外部替班合同",
        }
        contract_type_label = TYPE_LABELS.get(contract.type, "合同")
        
        # 清理文件名非法字符
        today_str = datetime.now().strftime('%Y%m%d')
        safe_filename = f"{employee_name}-{contract_type_label}-{today_str}.pdf"
        safe_filename = safe_filename.replace("/", "_").replace("\\", "_")

        return send_file(
            io.BytesIO(pdf_file),
            mimetype='application/pdf',
            as_attachment=True,
            download_name=safe_filename
        )

    except Exception as e:
        current_app.logger.error(f"为合同 {contract_id} 生成PDF失败: {e}", exc_info=True)
        return jsonify({"error": "生成PDF失败"}), 500


@contract_bp.route("", methods=["GET"])
@jwt_required()
def search_contracts():
    """
    搜索或列出合同。
    (已优化：不再返回base64签名图片数据)
    """
    search_term = request.args.get("search", "").strip()
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 15, type=int)
    type_filter = request.args.get("type", "").strip()
    status_filter = request.args.get("status", "all").strip()
    deposit_status_filter = request.args.get("deposit_status", "").strip()
    signing_status_filter = request.args.get("signing_status", "").strip()
    sort_by = request.args.get("sort_by", "updated_at").strip()  # 默认按更新时间排序
    sort_order = request.args.get("sort_order", "desc").strip()

    try:
        contract_poly = db.with_polymorphic(BaseContract, "*")
        query = db.session.query(contract_poly).options(joinedload(contract_poly.service_personnel))

        if search_term:
            pinyin_search_term = search_term.replace(" ", "")
            query = query.join(ServicePersonnel, BaseContract.service_personnel_id == ServicePersonnel.id, isouter=True)
            query = query.filter(
                or_(
                    BaseContract.customer_name.ilike(f"%{search_term}%"),
                    BaseContract.customer_name_pinyin.ilike(f"%{pinyin_search_term}%"),
                    ServicePersonnel.name.ilike(f"%{search_term}%"),
                    ServicePersonnel.name_pinyin.ilike(f"%{pinyin_search_term}%"),
                )
            )
        
        if type_filter:
            if type_filter == 'nanny':
                query = query.filter(BaseContract.type.in_(['nanny', 'external_substitution']))
            elif type_filter == 'formal':
                query = query.filter(BaseContract.type.in_(['nanny', 'maternity_nurse']))
            else:
                query = query.filter(BaseContract.type == type_filter)
        
        is_monthly_auto_renew_filter = request.args.get("is_monthly_auto_renew")
        if type_filter == 'nanny' and is_monthly_auto_renew_filter in ['true', 'false']:
            query = query.filter(NannyContract.is_monthly_auto_renew == (is_monthly_auto_renew_filter == 'true'))

        if status_filter != 'all':
            query = query.filter(BaseContract.status == status_filter)
        if signing_status_filter:
            query = query.filter(BaseContract.signing_status == signing_status_filter)
        if deposit_status_filter:
            if deposit_status_filter == 'paid':
                query = query.filter(BaseContract.deposit_amount > 0, BaseContract.security_deposit_paid >= BaseContract.deposit_amount)
            elif deposit_status_filter == 'unpaid':
                query = query.filter(BaseContract.deposit_amount > 0, BaseContract.security_deposit_paid < BaseContract.deposit_amount)

        if hasattr(BaseContract, sort_by):
            column_to_sort = getattr(BaseContract, sort_by)
            if sort_order == 'desc':
                query = query.order_by(column_to_sort.desc())
            else:
                query = query.order_by(column_to_sort.asc())
        else:
            query = query.order_by(BaseContract.updated_at.desc())

        paginated_contracts = query.paginate(page=page, per_page=per_page, error_out=False)
        contracts = paginated_contracts.items

        TYPE_CHOICES = {
            "nanny": "育儿嫂合同",
            "maternity_nurse": "月嫂合同",
            "nanny_trial": "育儿嫂试工合同",
            "external_substitution": "外部替班合同",
        }
        results = []
        today = datetime.utcnow().date()
        for contract in contracts:
            remaining_months = 0
            highlight_remaining = False
            
            # 修复：pending（待上户）以及提前终止的 terminated 状态的合同也应该显示剩余月数
            if contract.status in ['pending', 'active','terminated'] and contract.end_date:
                end_date_obj = contract.end_date
                if isinstance(end_date_obj, datetime):
                    end_date_obj = end_date_obj.date()

                if end_date_obj > today:
                    delta = relativedelta(end_date_obj, today)
                    remaining_months = delta.years * 12 + delta.months
                    if delta.days > 0:
                        remaining_months += 1
                    if remaining_months <= 2:
                        highlight_remaining = True

            contract_data = {
                "id": str(contract.id),
                "customer_name": contract.customer_name,
                "service_personnel_name": contract.service_personnel.name if contract.service_personnel else "N/A",
                "start_date": contract.start_date.isoformat(),
                "end_date": contract.end_date.isoformat(),
                "status": contract.status,
                "signing_status": contract.signing_status.value if contract.signing_status else None,
                "created_at": contract.created_at.isoformat() if contract.created_at else None,
                "updated_at": contract.updated_at.isoformat() if contract.updated_at else None,
                "contract_type_value": contract.type,
                "contract_type_label": TYPE_CHOICES.get(contract.type, contract.type),
                "deposit_amount": str(getattr(contract, 'deposit_amount', 0) or 0),
                "deposit_paid": bool(getattr(contract, 'security_deposit_paid', 0) and getattr (contract, 'deposit_amount', 0) and getattr (contract, 'security_deposit_paid', 0) >= getattr (contract, 'deposit_amount', 0)),
                "remaining_months": remaining_months,
                "highlight_remaining": highlight_remaining,
                "is_monthly_auto_renew": getattr(contract, 'is_monthly_auto_renew', False),
                "customer_signing_token": contract.customer_signing_token,
                "employee_signing_token": contract.employee_signing_token,
                # --- 核心修改：移除了签名数据 ---
                # "customer_signature": contract.customer_signature,
                # "employee_signature": contract.employee_signature,
            }
            results.append(contract_data)
        
        return jsonify({
            "contracts": results,
            "total": paginated_contracts.total,
            "pages": paginated_contracts.pages,
            "current_page": paginated_contracts.page
        })

    except Exception as e:
        current_app.logger.error(f"Failed to search or list contracts: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@contract_bp.route("/<uuid:contract_id>/substitute-context", methods=["GET"])
@jwt_required()
def get_contract_substitute_context(contract_id):
    """
    获取用于判断替班管理费逻辑的合同上下文信息。
    """
    try:
        contract = db.session.query(BaseContract).get(contract_id)

        if not contract:
            return jsonify({"error": "Contract not found"}), 404

        contract_type_key = "non_auto_renewing"
        effective_end_date = None

        # 判断是否为自动续签的育儿嫂合同 (NannyContract)
        if contract.type == 'nanny' and hasattr(contract, 'is_monthly_auto_renew') and contract.is_monthly_auto_renew:
            contract_type_key = "auto_renewing"
            # 对于自动续签合同，只有终止日期有意义
            if contract.termination_date:
                effective_end_date = contract.termination_date
            else:
                # 没有终止日期，视为无限期
                effective_end_date = None
        else:
            # 对于所有其他类型的合同 (非自动续签育儿嫂, 月嫂等)
            contract_type_key = "non_auto_renewing"
            if contract.termination_date:
                effective_end_date = max(contract.end_date, contract.termination_date)
            else:
                effective_end_date = contract.end_date

        return jsonify({
            "contract_type": contract_type_key,
            "effective_end_date": effective_end_date.isoformat() if effective_end_date else None
        })

    except Exception as e:
        current_app.logger.error(f"Failed to get contract substitute context for {contract_id}: {e}",exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/employees/<uuid:service_personnel_id>/ongoing-contracts", methods=["GET"])
@jwt_required()
def get_employee_ongoing_contracts(service_personnel_id):
    """
    获取指定服务人员当前占用中的合同，用于创建新合同时提示先终止原合同。
    """
    try:
        service_personnel = ServicePersonnel.query.get(str(service_personnel_id))
        if not service_personnel:
            return jsonify({"error": "服务人员未找到"}), 404

        contracts = _get_employee_ongoing_contracts(str(service_personnel_id))
        return jsonify({
            "has_conflict": len(contracts) > 0,
            "service_personnel_id": str(service_personnel.id),
            "service_personnel_name": service_personnel.name,
            "contracts": [_serialize_employee_ongoing_contract(contract) for contract in contracts],
        })
    except Exception as e:
        current_app.logger.error(f"获取服务人员进行中合同失败 {service_personnel_id}: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/employees/<uuid:service_personnel_id>/pending-trial-contracts", methods=["GET"])
@jwt_required()
def get_employee_pending_trial_contracts(service_personnel_id):
    """
    获取指定服务人员待处理的试工合同，用于创建正式合同时选择是否一并确认试工成功。
    """
    try:
        service_personnel = ServicePersonnel.query.get(str(service_personnel_id))
        if not service_personnel:
            return jsonify({"error": "服务人员未找到"}), 404

        contracts = _get_employee_pending_trial_contracts(str(service_personnel_id))
        return jsonify({
            "has_pending_trials": len(contracts) > 0,
            "service_personnel_id": str(service_personnel.id),
            "service_personnel_name": service_personnel.name,
            "contracts": [_serialize_employee_pending_trial_contract(contract) for contract in contracts],
        })
    except Exception as e:
        current_app.logger.error(f"获取服务人员待处理试工合同失败 {service_personnel_id}: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/nanny-trial-contracts/<uuid:trial_contract_id>/draft-conversion-preview", methods=["POST"])
@jwt_required()
def preview_trial_conversion_for_draft_contract(trial_contract_id):
    """
    基于创建正式合同弹窗中的草稿参数，预览试工成功后预计转入正式合同的费用。
    """
    data = request.get_json() or {}
    formal_start_date_str = data.get("start_date")
    if not formal_start_date_str:
        return jsonify({"error": "缺少正式合同开始日期"}), 400

    trial_contract = db.session.get(NannyTrialContract, str(trial_contract_id))
    if not trial_contract:
        return jsonify({"error": "试工合同未找到"}), 404

    is_pending_trial = (
        trial_contract.trial_outcome == TrialOutcome.PENDING
        or trial_contract.status == "trial_active"
    )
    if not is_pending_trial:
        return jsonify({"error": "该试工合同已处理，无法预览试工成功费用"}), 400

    try:
        formal_start = datetime.fromisoformat(formal_start_date_str.split("T")[0]).date()
        trial_start = trial_contract.start_date.date() if isinstance(trial_contract.start_date, datetime) else trial_contract.start_date
        trial_end = trial_contract.end_date.date() if isinstance(trial_contract.end_date, datetime) else trial_contract.end_date

        if not trial_start or not trial_end:
            return jsonify({"error": "试工合同起止日期不完整"}), 400

        non_overlap_days = 0
        if formal_start > trial_start:
            non_overlap_end = min(trial_end, formal_start)
            if non_overlap_end > trial_start:
                non_overlap_days = (non_overlap_end - trial_start).days

        overlap_days = 0
        if formal_start <= trial_end:
            overlap_start = max(trial_start, formal_start)
            if trial_end >= overlap_start:
                overlap_days = (trial_end - overlap_start).days

        trial_daily_rate = D(trial_contract.employee_level or "0")
        trial_monthly_rate = trial_daily_rate * D(26)
        management_fee_rate = D(
            trial_contract.management_fee_rate
            if trial_contract.management_fee_rate is not None
            else "0.1"
        )

        service_fee = (trial_daily_rate * D(non_overlap_days)).quantize(D("0.01"))
        management_fee = (trial_monthly_rate * management_fee_rate / D(30) * D(non_overlap_days)).quantize(D("0.01"))
        introduction_fee = D(trial_contract.introduction_fee or "0").quantize(D("0.01"))
        total_transfer_amount = (service_fee + management_fee).quantize(D("0.01"))

        return jsonify({
            "trial_contract_id": str(trial_contract.id),
            "non_overlap_days": non_overlap_days,
            "overlap_days": overlap_days,
            "service_fee": {
                "amount": str(service_fee),
                "description": f"预计转入正式合同的试工劳务费：日薪 {trial_daily_rate} × 非重叠 {non_overlap_days} 天",
            },
            "management_fee": {
                "amount": str(management_fee),
                "description": f"预计转入正式合同的试工管理费：试工月薪 {trial_monthly_rate} × 管理费率 {management_fee_rate} ÷ 30 × 非重叠 {non_overlap_days} 天",
            },
            "introduction_fee": {
                "amount": str(introduction_fee),
                "description": "介绍费按现有试工成功逻辑保留在试工合同账单中，不转入正式合同。",
            },
            "total_transfer_amount": str(total_transfer_amount),
        })
    except Exception as e:
        current_app.logger.error(f"预览创建正式合同时的试工成功费用失败 {trial_contract_id}: {e}", exc_info=True)
        return jsonify({"error": "计算试工成功费用预览失败"}), 500
     
@contract_bp.route("/<uuid:contract_id>/successor", methods=["GET"])
@jwt_required()
def find_successor_contract(contract_id):
    """
    查找并返回给定合同的续约合同。
    此函数现在作为API包装器，调用内部服务函数。
    """
    try:
        successor = _find_successor_contract_internal(str(contract_id))
        if successor:
            return jsonify({
                "id": str(successor.id),
                "customer_name": successor.customer_name,
                "start_date": successor.start_date.isoformat(),
                "end_date": successor.end_date.isoformat()
            })
        else:
            return "", 204
    except Exception as e:
        current_app.logger.error(f"查找续约合同失败 {contract_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500


@contract_bp.route("/<uuid:contract_id>/signing-links", methods=["GET"])
@jwt_required()
def get_contract_signing_links(contract_id):
    try:
        contract = BaseContract.query.filter_by(id=contract_id).first()
        if not contract:
            return jsonify({"error": "合同未找到"}), 404

        from backend.api.setting_api import get_or_create_miniapp_signing_config
        miniapp_config = get_or_create_miniapp_signing_config().value or {}

        customer_link = _build_contract_signing_link(
            contract.customer_signing_token,
            "customer",
            miniapp_config,
        ) if contract.customer_signing_token else None
        employee_link = _build_contract_signing_link(
            contract.employee_signing_token,
            "employee",
            miniapp_config,
        ) if contract.employee_signing_token else None

        return jsonify({
            "customer": customer_link,
            "employee": employee_link,
            "miniapp_config": {
                "enabled": bool(miniapp_config.get("enabled")),
                "env_version": miniapp_config.get("env_version") or "release",
                "expire_days": miniapp_config.get("expire_days") or 30,
                "diagnostics": miniapp_credential_status(miniapp_config.get("appid")),
            }
        })
    except Exception as e:
        current_app.logger.error(f"获取合同签署链接失败: {e}", exc_info=True)
        return jsonify({"error": "获取签署链接失败"}), 500

import uuid

# ... (other imports remain the same)

@contract_bp.route("/formal", methods=["POST"])
@jwt_required()
def create_formal_contract():
    """
    创建新的正式合同 (支持现有客户、新客户、或无客户信息创建)。
    """
    data = request.get_json()
    current_app.logger.debug(f"--- [API-CreateFormalContract] START ---")
    current_app.logger.debug(f"[API-CreateFormalContract] Received data: {data}")

    # --- Validation (Only base fields are strictly required) ---
    base_required = ["template_id", "service_personnel_id", "start_date", "end_date", "contract_type"]
    for field in base_required:
        if not data.get(field):
            return jsonify({"error": f"缺少必填字段: {field}"}), 400

    try:
        # --- Fetch related objects that are always required ---
        service_personnel = ServicePersonnel.query.get(data["service_personnel_id"])
        if not service_personnel:
            return jsonify({"error": "服务人员未找到"}), 404

        trial_contract_id_to_convert = data.get("trial_contract_id_to_convert")
        trial_contract_to_convert = None
        if trial_contract_id_to_convert:
            trial_contract_to_convert = db.session.get(NannyTrialContract, str(trial_contract_id_to_convert))
            if not trial_contract_to_convert:
                return jsonify({"error": "选择的试工合同未找到"}), 404
            if str(trial_contract_to_convert.service_personnel_id) != str(service_personnel.id):
                return jsonify({"error": "选择的试工合同不属于当前服务人员"}), 400
            is_pending_trial = (
                trial_contract_to_convert.trial_outcome == TrialOutcome.PENDING
                or trial_contract_to_convert.status == "trial_active"
            )
            if not is_pending_trial:
                return jsonify({"error": "选择的试工合同已被处理，无法再次确认试工成功"}), 400

        ongoing_contracts = _get_employee_ongoing_contracts(str(service_personnel.id))
        if ongoing_contracts:
            return jsonify({
                "error": "该服务人员存在进行中的合同，请先终止原合同后再创建新合同。",
                "code": "EMPLOYEE_CONTRACT_CONFLICT",
                "contracts": [_serialize_employee_ongoing_contract(contract) for contract in ongoing_contracts],
            }), 409

        contract_template = ContractTemplate.query.get(data["template_id"])
        if not contract_template:
            return jsonify({"error": "合同模板未找到"}), 404

        # --- Prepare Customer Info (Handles all 3 cases) ---
        customer_attributes = { "customer_id": None, "customer_name": "新客户", "customer_name_pinyin": "xinkehu xkh" }
        customer_id = data.get("customer_id")
        customer_name_from_request = data.get("customer_name")

        if customer_id:
            # Case 1: Existing Customer ID is provided
            customer = Customer.query.get(customer_id)
            if not customer:
                return jsonify({"error": f"客户ID {customer_id} 未找到"}), 404
            customer_attributes["customer_id"] = customer.id
            customer_attributes["customer_name"] = customer.name
            customer_attributes["customer_name_pinyin"] = customer.name_pinyin
        elif customer_name_from_request:
            # Case 2: A temporary name for a new customer is provided
            customer_attributes["customer_name"] = customer_name_from_request
            from pypinyin import pinyin, Style
            pinyin_full = "".join(p[0] for p in pinyin(customer_name_from_request, style=Style.NORMAL))
            pinyin_initials = "".join(p[0] for p in pinyin(customer_name_from_request, style=Style.FIRST_LETTER))
            customer_attributes["customer_name_pinyin"] = f"{pinyin_full} {pinyin_initials}"
        # Case 3: No customer info provided, use the default "新客户"

        # --- Update Service Personnel Address if provided ---
        employee_address = data.get("employee_address")
        if employee_address and service_personnel.address != employee_address:
            service_personnel.address = employee_address
            db.session.add(service_personnel) # Mark for update
            current_app.logger.info(f"Updated address for ServicePersonnel {service_personnel.id} to {employee_address}")

        # --- Prepare Contract Attributes ---
        def to_decimal(value, default=0):
            if value is None or value == '': return D(str(default))
            return D(str(value))

        common_attributes = {
            **customer_attributes,
            "service_personnel_id": service_personnel.id,
            "template_id": data["template_id"],
            "type": data["contract_type"],
            "start_date": datetime.fromisoformat(data["start_date"].split('T')[0]),
            "end_date": datetime.fromisoformat(data["end_date"].split('T')[0]),
            "status": "pending",
            "signing_status": SigningStatus.UNSIGNED,
            "customer_signing_token": str(uuid.uuid4()),
            "employee_signing_token": str(uuid.uuid4()),
            "employee_level": to_decimal(data.get("employee_level")),
            "notes": data.get("notes"),
            "introduction_fee": to_decimal(data.get("introduction_fee")),
            "management_fee_amount": to_decimal(data.get("management_fee_amount")),
            "management_fee_rate": to_decimal(data.get("management_fee_rate")),
            "service_content": data.get("service_content"),
            "service_type": data.get("service_type"),
            "is_auto_renew": data.get("is_auto_renew", False),
            "attachment_content": data.get("attachment_content"),
            "previous_contract_id": data.get("previous_contract_id"),
            "requires_signature": data.get("requires_signature"),
        }

        # --- Update Customer Address if provided (only for existing customers) ---
        customer_address = data.get("customer_address")
        if customer_id and customer_address:
             customer = Customer.query.get(customer_id)
             if customer and customer.address != customer_address:
                 customer.address = customer_address
                 db.session.add(customer)
                 current_app.logger.info(f"Updated address for Customer {customer.id} to {customer_address}")

        # --- Model Selection and Creation ---
        contract_type = data["contract_type"]
        # --- 核心修复：对试工合同，强制使用 daily_rate 作为 employee_level ---
        if contract_type == "nanny_trial":
            daily_rate_from_request = data.get("daily_rate")
            if daily_rate_from_request:
                common_attributes["employee_level"] = to_decimal(daily_rate_from_request)
                current_app.logger.info(f"[CreateFormalContract] 试工合同，使用 daily_rate ( {daily_rate_from_request}) 覆盖 employee_level。")
        # --- 修复结束 ---
        ContractModel = None

        # --- Model Selection and Creation ---
        contract_type = data["contract_type"]
        ContractModel = None

        if contract_type == "nanny":
            ContractModel = NannyContract
            common_attributes["is_monthly_auto_renew"] = data.get("is_monthly_auto_renew", False)
            # 育儿嫂合同的保证金等于员工级别
            common_attributes["security_deposit_paid"] = to_decimal(data.get("employee_level") or 0)

        elif contract_type == "maternity_nurse":
            ContractModel = MaternityNurseContract
            common_attributes["deposit_amount"] = to_decimal(data.get("deposit_amount")),
            common_attributes["provisional_start_date"] = datetime.fromisoformat(data[ "provisional_start_date"].split('T')[0]) if data.get("provisional_start_date") else None
            # 月嫂合同的保证金从前端传入
            common_attributes["security_deposit_paid"] = to_decimal(data.get( "security_deposit_paid") or 0)
            common_attributes["management_fee_rate"] = D(data.get("deposit_rate", 0.25))

        elif contract_type == "nanny_trial":
            ContractModel = NannyTrialContract
            # 试工合同没有保证金，显式设为0
            common_attributes["security_deposit_paid"] = D(0)

        elif contract_type == "external_substitution":
            ContractModel = ExternalSubstitutionContract
            common_attributes["management_fee_rate"] = D(data.get("management_fee_rate", 0.20))
            # 外部替班合同没有保证金，显式设为0
            common_attributes["security_deposit_paid"] = D(0)

        else:
            return jsonify({"error": f"不支持的合同类型: {contract_type}"}), 400

        if trial_contract_to_convert and contract_type != "nanny":
            return jsonify({"error": "试工成功只能关联到育儿嫂正式合同"}), 400

        new_contract = ContractModel(**common_attributes)
        
        # --- 处理无需签署的情况 ---
        if data.get("requires_signature") is False:
            new_contract.signing_status = SigningStatus.NOT_REQUIRED
            new_contract.status = "active"
            current_app.logger.info(f"合同 {new_contract.id} 无需签署，自动激活")
        
        db.session.add(new_contract)
        db.session.flush()
        create_contract_operation_log(
            contract=new_contract,
            user_id=get_jwt_identity(),
            action="create",
            title="创建合同",
            summary=f"创建{new_contract.customer_name}的合同",
            details={
                "contract_type": new_contract.type,
                "customer_name": new_contract.customer_name,
                "service_personnel_name": service_personnel.name,
                "requires_signature": data.get("requires_signature"),
            },
            changes={"created": {"from": None, "to": snapshot_contract(new_contract)}},
        )
        db.session.commit()
        
        # --- 无需签署时，更新薪资历史 ---
        if data.get("requires_signature") is False:
            update_salary_history_on_contract_activation(new_contract)
            db.session.commit()
            current_app.logger.info(f"合同 {new_contract.id} 已更新薪资历史")

        if trial_contract_to_convert:
            operator_id = get_jwt_identity()
            engine = BillingEngine()
            engine.process_trial_conversion(
                trial_contract_id=str(trial_contract_to_convert.id),
                formal_contract_id=str(new_contract.id),
                operator_id=operator_id,
            )
            current_app.logger.info(
                f"试工合同 {trial_contract_to_convert.id} 已在创建正式合同 {new_contract.id} 后确认试工成功。"
            )

        # 触发后台任务以生成初始账单
        trigger_initial_bill_generation_task.delay(str(new_contract.id))
        current_app.logger.info(f"合同 {new_contract.id} 已创建，已提交后台任务以生成初始账单。" )

        # --- 构造完整的签名URL ---
        frontend_base_url = current_app.config.get('FRONTEND_BASE_URL')
        # current_app.logger.debug(f"[API-CreateFormalContract] FRONTEND_BASE_URL: {frontend_base_url}")
        customer_url = f"{frontend_base_url}/sign/{new_contract.customer_signing_token}"
        employee_url = f"{frontend_base_url}/sign/{new_contract.employee_signing_token}"

        return jsonify({
            "message": "正式合同创建成功",
            "contract_id": str(new_contract.id),
            "customer_signing_token": new_contract.customer_signing_token,
            "employee_signing_token": new_contract.employee_signing_token,
            "customer_signing_url": customer_url, # <-- 新增
            "employee_signing_url": employee_url, # <-- 新增
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"创建正式合同失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_bp.route("/<uuid:contract_id>", methods=["DELETE"])
@jwt_required()
def delete_contract(contract_id):
    """
    删除一个合同及其所有关联记录（账单、工资单、调整项、考勤等）。
    这是一个级联删除操作，请谨慎使用。
    """
    contract_id_str = str(contract_id)
    contract = BaseContract.query.get_or_404(contract_id_str)

    try:
        current_app.logger.info(f"开始级联删除合同 {contract_id_str} 及其所有关联数据...")

        # 1. 查找所有关联的 Bill 和 Payroll IDs
        bill_ids = [b.id for b in CustomerBill.query.with_entities(CustomerBill.id).filter_by(contract_id=contract_id_str).all()]
        payroll_ids = [p.id for p in EmployeePayroll.query.with_entities(EmployeePayroll.id).filter_by(contract_id=contract_id_str).all()]
        current_app.logger.info(f"找到关联账单: {bill_ids}, 关联工资单: {payroll_ids}")

        # 2. 删除最深层的依赖：FinancialActivityLog
        if bill_ids:
            FinancialActivityLog.query.filter(FinancialActivityLog.customer_bill_id.in_(bill_ids)).delete(synchronize_session=False)
        if payroll_ids:
            FinancialActivityLog.query.filter(FinancialActivityLog.employee_payroll_id.in_(payroll_ids)).delete(synchronize_session=False)
        
        # 3. 删除支付记录
        if bill_ids:
            PaymentRecord.query.filter(PaymentRecord.customer_bill_id.in_(bill_ids)).delete(synchronize_session=False)

        # 4. 删除财务调整项 (关联到账单、工资单或合同本身)
        if bill_ids:
            FinancialAdjustment.query.filter(FinancialAdjustment.customer_bill_id.in_(bill_ids)).delete(synchronize_session=False)
        if payroll_ids:
            FinancialAdjustment.query.filter(FinancialAdjustment.employee_payroll_id.in_(payroll_ids)).delete(synchronize_session=False)
        FinancialAdjustment.query.filter_by(contract_id=contract_id_str).delete(synchronize_session=False)

        # 5. 删除账单和工资单
        if bill_ids:
            CustomerBill.query.filter(CustomerBill.id.in_(bill_ids)).delete(synchronize_session=False)
        if payroll_ids:
            EmployeePayroll.query.filter(EmployeePayroll.id.in_(payroll_ids)).delete(synchronize_session=False)

        # 6. 删除考勤表
        AttendanceForm.query.filter_by(contract_id=contract_id_str).delete(synchronize_session=False)

        # 7. 删除考勤记录
        AttendanceRecord.query.filter_by(contract_id=contract_id_str).delete(synchronize_session=False)

        # 8. 删除薪酬历史
        EmployeeSalaryHistory.query.filter_by(contract_id=contract_id_str).delete(synchronize_session=False)

        # 9. 最后，删除合同本身
        db.session.delete(contract)
        
        db.session.commit()
        
        current_app.logger.info(f"合同 {contract_id_str} 已被成功级联删除。")
        return jsonify({"message": "合同及所有关联数据已成功删除"}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"级联删除合同 {contract_id_str} 时发生错误: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_bp.route("/<uuid:contract_id>", methods=["GET"])
@jwt_required()
def get_contract_details(contract_id):
    """
    获取单个合同的完整详细信息，用于编辑。
    """
    try:
        contract_poly = db.with_polymorphic(BaseContract, "*")
        contract = db.session.query(contract_poly).options(
            joinedload(contract_poly.customer),
            joinedload(contract_poly.service_personnel)
        ).filter(BaseContract.id == str(contract_id)).first()

        if not contract:
            return jsonify({"error": "合同未找到"}), 404

        result = {
            "id": str(contract.id),
            "contract_type": contract.type,
            "customer_id": contract.customer_id,
            "customer_name": contract.customer_name,
            "customer_id_card": contract.customer.id_card_number if contract.customer else None,
            "customer_address": contract.customer.address if contract.customer else None,
            "service_personnel_id": contract.service_personnel_id,
            "employee_name": contract.service_personnel.name if contract.service_personnel else None,
            "employee_id_card": contract.service_personnel.id_card_number if contract.service_personnel else None,
            "employee_address": contract.service_personnel.address if contract.service_personnel else None,
            "start_date": contract.start_date.isoformat() if contract.start_date else None,
            "end_date": contract.end_date.isoformat() if contract.end_date else None,
            "status": contract.status,
            "notes": contract.notes,
            "attachment_content": contract.attachment_content,
            "employee_level": str(contract.employee_level) if contract.employee_level is not None else '',
            "management_fee_rate": str(contract.management_fee_rate) if contract.management_fee_rate is not None else '',
            "management_fee_amount": str(contract.management_fee_amount) if contract.management_fee_amount is not None else '',
            "introduction_fee": str(contract.introduction_fee) if contract.introduction_fee is not None else '',
            "template_id": contract.template_id,
            "service_content": contract.service_content,
            "service_type": contract.service_type,
            "is_monthly_auto_renew": getattr(contract, 'is_monthly_auto_renew', False),
            # --- 新增字段 ---
            "deposit_amount": str(getattr(contract, 'deposit_amount', '')) if contract.type == 'maternity_nurse' else '',
            # 根据 security_deposit_paid 和 employee_level 反算 deposit_rate
            "deposit_rate": str(
                round(1 - (float(contract.employee_level or 0) / float(contract.security_deposit_paid)), 2)
            ) if contract.type == 'maternity_nurse' and contract.security_deposit_paid and float(contract.security_deposit_paid) > 0 else '0.25',
            "security_deposit_paid": str(getattr(contract, 'security_deposit_paid', '')) if contract.type == 'maternity_nurse' else '',
            "provisional_start_date": getattr(contract, 'provisional_start_date').isoformat() if getattr(contract, 'provisional_start_date', None) else None,
            # --- 试工合同特殊字段：日薪 ---
            "daily_rate": str(contract.employee_level) if contract.type == 'nanny_trial' and contract.employee_level is not None else '',
            # --- 签署相关字段 ---
            "signing_status": contract.signing_status.value if contract.signing_status else 'UNSIGNED',
            "requires_signature": contract.requires_signature,
            # --- 家庭ID字段 ---
            "family_id": contract.family_id,
        }

        return jsonify(result)

    except Exception as e:
        current_app.logger.error(f"获取合同 {contract_id} 详情失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/<uuid:contract_id>/operation-logs", methods=["GET"])
@jwt_required()
def get_contract_operation_logs(contract_id):
    """
    获取合同生命周期操作日志。
    只返回当前合同页面应展示的日志。
    对启用日志功能前已经存在的续约/变更链路，补充只读派生日志，避免历史合同详情出现空白。
    """
    try:
        contract = db.session.get(BaseContract, contract_id)
        if not contract:
            return jsonify({"error": "合同不存在"}), 404

        persisted_logs = (
            ContractOperationLog.query.filter(ContractOperationLog.contract_id == contract_id)
            .order_by(ContractOperationLog.created_at.desc())
            .all()
        )
        show_only_legacy_inbound_log = _should_show_only_legacy_inbound_log(contract, persisted_logs)
        visible_persisted_logs = [] if show_only_legacy_inbound_log else persisted_logs
        log_payloads = [log.to_dict() for log in visible_persisted_logs]
        log_payloads.extend(_build_derived_contract_operation_logs(contract, persisted_logs))
        log_payloads.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return jsonify(log_payloads)
    except Exception as e:
        current_app.logger.error(f"获取合同 {contract_id} 操作日志失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


def _build_derived_contract_operation_logs(contract, persisted_logs):
    derived_logs = []

    if _should_derive_legacy_edit_log(contract, persisted_logs):
        derived_logs.append(
            _serialize_derived_contract_operation_log(
                contract=contract,
                related_contract=None,
                action="edit",
                title="编辑合同",
                summary="历史数据中该合同曾被更新，启用操作日志前无法还原具体字段差异",
                created_at=contract.updated_at or contract.created_at,
                details={"derived": True, "reason": "legacy_updated_contract"},
            )
        )

    if contract.previous_contract_id:
        source = _normalize_contract_link_source(contract.source)
        create_action = "create_from_renewal" if source == "renewal" else "create_from_change"
        if not _has_contract_link_log(
            persisted_logs,
            action=create_action,
            contract_id=contract.id,
            related_contract_id=contract.previous_contract_id,
        ):
            previous_contract = contract.previous_contract
            title = "由续约创建" if source == "renewal" else "由变更创建"
            verb = "续约" if source == "renewal" else "变更"
            derived_logs.append(
                _serialize_derived_contract_operation_log(
                    contract=contract,
                    related_contract=previous_contract,
                    action=create_action,
                    title=title,
                    summary=f"由源合同 {contract.previous_contract_id} {verb}创建",
                    created_at=contract.created_at or contract.updated_at,
                    details={"source_contract_id": str(contract.previous_contract_id), "derived": True},
                )
            )

    for next_contract in contract.next_contracts:
        source = _normalize_contract_link_source(next_contract.source)
        action = "renew" if source == "renewal" else "change"
        if _has_contract_link_log(
            persisted_logs,
            action=action,
            contract_id=contract.id,
            related_contract_id=next_contract.id,
        ):
            continue

        title = "续约合同" if source == "renewal" else "变更合同"
        verb = "续约" if source == "renewal" else "变更"
        changes = {}
        if contract.status:
            changes["status"] = {"from": None, "to": contract.status}
        if contract.termination_date:
            changes["termination_date"] = {"from": None, "to": contract.termination_date.isoformat()}
        if contract.end_date:
            changes["end_date"] = {"from": None, "to": contract.end_date.isoformat()}

        derived_logs.append(
            _serialize_derived_contract_operation_log(
                contract=contract,
                related_contract=next_contract,
                action=action,
                title=title,
                summary=f"{verb}生成新合同 {next_contract.id}",
                created_at=next_contract.created_at or contract.updated_at or contract.created_at,
                details={
                    "new_contract_id": str(next_contract.id),
                    "new_start_date": next_contract.start_date.isoformat() if next_contract.start_date else None,
                    "new_end_date": next_contract.end_date.isoformat() if next_contract.end_date else None,
                    "derived": True,
                },
                changes=changes,
            )
        )

    return derived_logs


def _should_show_only_legacy_inbound_log(contract, persisted_logs):
    if not contract.previous_contract_id:
        return False

    inbound_actions = {"create_from_renewal", "create_from_change"}
    return not any(
        log.action in inbound_actions and str(log.related_contract_id) == str(contract.previous_contract_id)
        for log in persisted_logs
    )


def _should_derive_legacy_edit_log(contract, persisted_logs):
    if contract.previous_contract_id or persisted_logs or not contract.created_at or not contract.updated_at:
        return False
    return _to_naive_second(contract.updated_at) > _to_naive_second(contract.created_at)


def _to_naive_second(value):
    return value.replace(tzinfo=None, microsecond=0)


def _normalize_contract_link_source(source):
    return "renewal" if source == "renewal" else "change"


def _has_contract_link_log(logs, action, contract_id, related_contract_id):
    return any(
        log.action == action
        and str(log.contract_id) == str(contract_id)
        and str(log.related_contract_id) == str(related_contract_id)
        for log in logs
    )


def _serialize_derived_contract_operation_log(
    contract,
    related_contract,
    action,
    title,
    summary,
    created_at,
    details=None,
    changes=None,
):
    return {
        "id": f"derived-{action}-{contract.id}-{related_contract.id if related_contract else 'none'}",
        "contract_id": str(contract.id),
        "related_contract_id": str(related_contract.id) if related_contract else None,
        "related_contract_customer_name": related_contract.customer_name if related_contract else None,
        "related_contract_employee_name": (
            related_contract.service_personnel.name
            if related_contract and related_contract.service_personnel
            else None
        ),
        "user": "系统",
        "action": action,
        "title": title,
        "summary": summary,
        "details": details or {},
        "changes": changes or {},
        "created_at": created_at.isoformat() if created_at else None,
        "derived": True,
    }
    
@contract_bp.route("/<uuid:contract_id>", methods=["PUT"])
@jwt_required()
def update_contract(contract_id):
    """
    更新一个合同。
    - 'pending' 状态的合同允许修改大部分字段。
    - 其他状态的合同只允许修改 'notes' 和 'attachment_content' 等非核心字段。
    """
    contract_id_str = str(contract_id)
    data = request.get_json()
    contract = BaseContract.query.get_or_404(contract_id_str)

    try:
        before_snapshot = snapshot_contract(contract)
        # 1. 通用安全字段更新 (所有状态下都允许)
        if 'notes' in data:
            contract.notes = data.get('notes')
        if 'attachment_content' in data:
            contract.attachment_content = data.get('attachment_content')

        # 2. 对于非 'pending' 状态的合同，只更新安全字段后就直接返回
        if contract.status != 'pending':
            changes = diff_snapshots(before_snapshot, snapshot_contract(contract))
            if changes:
                create_contract_operation_log(
                    contract=contract,
                    user_id=get_jwt_identity(),
                    action="edit",
                    title="编辑合同",
                    summary="更新合同备注/附件等非核心字段",
                    details={"updated_fields": list(changes.keys())},
                    changes=changes,
                )
            db.session.commit()
            current_app.logger.info(f"合同 {contract_id_str} (状态: {contract.status}) 的非核心字段已更新。")
            return jsonify({"message": "合同更新成功 (仅限备注等安全字段)。"}), 200

        # 3. 对 'pending' 状态的合同，允许更广泛的编辑
        current_app.logger.info(f"正在为 PENDING 状态的合同 {contract_id_str} 执行更新...")
        
        def to_decimal(value, default=None):
            if value is None or value == '':
                return default if default is not None else None
            return D(str(value))

        # 更新核心字段
        if 'start_date' in data and data['start_date']:
            contract.start_date = datetime.fromisoformat(data['start_date'].split('T')[0])
        if 'end_date' in data and data['end_date']:
            contract.end_date = datetime.fromisoformat(data['end_date'].split('T')[0])
        
        if 'introduction_fee' in data:
            contract.introduction_fee = to_decimal(data['introduction_fee'], 0)
        
        if 'management_fee_amount' in data:
            contract.management_fee_amount = to_decimal(data['management_fee_amount'], 0)
        if 'management_fee_rate' in data:
            contract.management_fee_rate = to_decimal(data['management_fee_rate'], 0)
        if 'contract_type' in data:
            contract.type = data['contract_type']
        if 'template_id' in data:
            contract.template_id = data['template_id']
            new_template = ContractTemplate.query.get(data['template_id'])
            if new_template:
                pass # Template content is now accessed via relation

        # --- 核心修改：将 security_deposit_paid 的更新逻辑移到外面，使其通用 ---
        if 'security_deposit_paid' in data:
            contract.security_deposit_paid = to_decimal(data['security_deposit_paid'], 0)

        # 根据合同类型处理薪酬及特定字段
        if contract.type == 'nanny_trial':
            if 'daily_rate' in data:
                contract.employee_level = to_decimal(data['daily_rate'], 0)
        else:
            if 'employee_level' in data:
                contract.employee_level = to_decimal(data['employee_level'], 0)

        if 'customer_id_card' in data and contract.customer:
            contract.customer.id_card_number = data['customer_id_card']
        if 'customer_address' in data and contract.customer:
            contract.customer.address = data['customer_address']
        if 'employee_id_card' in data and contract.service_personnel:
            contract.service_personnel.id_card_number = data['employee_id_card']
        if 'employee_address' in data and contract.service_personnel:
            contract.service_personnel.address = data['employee_address']

        if 'is_monthly_auto_renew' in data and contract.type == 'nanny':
            contract.is_monthly_auto_renew = data['is_monthly_auto_renew']
        
        if 'service_content' in data and contract.type in ['nanny', 'nanny_trial']:
            contract.service_content = data['service_content']
        if 'service_type' in data and contract.type in ['nanny', 'nanny_trial']:
            contract.service_type = data['service_type']

        if contract.type == 'maternity_nurse':
            if 'deposit_amount' in data:
                contract.deposit_amount = to_decimal(data['deposit_amount'], 0)
            if 'deposit_rate' in data:
                contract.deposit_rate = to_decimal(data['deposit_rate'], 0)
            if 'provisional_start_date' in data and data['provisional_start_date']:
                contract.provisional_start_date = datetime.fromisoformat(data['provisional_start_date'].split('T')[0])
        
        # Handle requires_signature and signing_status editing
        if 'requires_signature' in data:
            new_requires_signature = data['requires_signature']
            old_requires_signature = contract.requires_signature
            contract.requires_signature = new_requires_signature
            # 仅在值真正发生变化时才更新 signing_status
            if old_requires_signature != new_requires_signature:
                if new_requires_signature is False:
                    contract.signing_status = SigningStatus.NOT_REQUIRED
                    current_app.logger.info(f"编辑合同：签署需求变更为无需签署，signing_status 设置为 NOT_REQUIRED")
                elif new_requires_signature is True:
                    contract.signing_status = SigningStatus.UNSIGNED
                    current_app.logger.info(f"编辑合同：签署需求变更为需要签署，signing_status 设置为 UNSIGNED")
            else:
                current_app.logger.info(f"编辑合同：签署需求未变化({new_requires_signature})，保留当前签署状态 {contract.signing_status}")
        
        # 4. 重要：触发账单重算
        trigger_initial_bill_generation_task.delay(str(contract.id))
        current_app.logger.info(f"已为更新后的合同 {contract.id} 触发账单重算任务。")

        changes = diff_snapshots(before_snapshot, snapshot_contract(contract))
        if changes:
            create_contract_operation_log(
                contract=contract,
                user_id=get_jwt_identity(),
                action="edit",
                title="编辑合同",
                summary="更新待签署合同信息并触发账单重算",
                details={"updated_fields": list(changes.keys())},
                changes=changes,
            )

        db.session.commit()
        return jsonify({"message": "合同更新成功"}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"更新合同 {contract_id_str} 时发生错误: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500
    
def get_contract_for_signing(token):
    """
    一个公开的API，供客户或员工使用专属令牌查看合同。
    """
    try:
        # Determine role and find contract by the provided token
        role = None
        contract = BaseContract.query.filter_by(customer_signing_token=token).first()
        if contract:
            role = "customer"
        else:
            contract = BaseContract.query.filter_by(employee_signing_token=token).first()
            if contract:
                role = "employee"

        if not contract:
            return jsonify({"error": "无效的签名链接或合同不存在"}), 404

        # 关联加载所需信息
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel)
        ).filter_by(id=contract.id).first()

        customer_info = {}
        if contract.customer:
            customer_info = {
                "id": contract.customer.id,
                "name": contract.customer.name,
                "id_card_number": contract.customer.id_card_number,
                "phone_number": contract.customer.phone_number,
                "address": contract.customer.address
            }

        employee_info = {}
        if contract.service_personnel:
            employee_info = {
                "id": contract.service_personnel.id,
                "name": contract.service_personnel.name,
                "id_card_number": contract.service_personnel.id_card_number,
                "phone_number": contract.service_personnel.phone_number,
                "address": contract.service_personnel.address
            }

        # Safely get subclass-specific attributes like deposit_amount
        deposit_amount = getattr(contract, 'deposit_amount', None)
        security_deposit_paid = getattr(contract, 'security_deposit_paid', None)

        # 获取签名
        customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').first()
        employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').first()

        return jsonify({
            "contract_id": str(contract.id),
            "role": role,
            "customer_name": contract.customer_name,
            "template_content": contract.template.content if contract.template else '',
            "service_content": contract.service_content,
            "attachment_content": contract.attachment_content,
            "customer_info": customer_info,
            "employee_info": employee_info,
            "signing_status": contract.signing_status.value if contract.signing_status else None,
            "customer_signature": f"/api/contracts/signatures/{customer_sig.id}/image" if customer_sig else None,
            "employee_signature": f"/api/contracts/signatures/{employee_sig.id}/image" if employee_sig else None,

            # --- 核心修正：添加前端需要的所有核心信息字段 ---
            "type": contract.type,
            "service_type": contract.service_type,
            "start_date": contract.start_date.isoformat(),
            "end_date": contract.end_date.isoformat(),
            "employee_level": float(contract.employee_level) if contract.employee_level is not None else None,
            "management_fee_amount": float(contract.management_fee_amount) if contract.management_fee_amount is not None else None,
            "deposit_amount": float(deposit_amount) if deposit_amount is not None else None,
            "security_deposit_paid": float(security_deposit_paid) if security_deposit_paid is not None else None,
        })
    except Exception as e:
        current_app.logger.error(f"获取合同 {token} 失败: {e}", exc_info=True)
        return jsonify({"error": "加载合同失败，请联系管理员"}), 500


@contract_bp.route("/sign/<string:token>", methods=["GET", "POST"])
def handle_signing_page_action(token):
    """
    一个公开的API，用于处理签名页面的所有交互。
    - GET: 根据token获取合同详情以供预览。
    - POST: 接收并处理签名及相关信息。
    """
    # 统一的token验证和角色确定逻辑
    role = None
    # 优先使用 joinedload 提高效率
    contract_query = BaseContract.query.options(
        joinedload(BaseContract.customer),
        joinedload(BaseContract.service_personnel)
    )
    
    contract = contract_query.filter_by(customer_signing_token=token).first()
    if contract:
        role = "customer"
    else:
        contract = contract_query.filter_by(employee_signing_token=token).first()
        if contract:
            role = "employee"

    if not contract:
        return jsonify({"error": "无效的签名链接或合同不存在"}), 404

    # --- 处理 GET 请求 ---
    if request.method == "GET":
        try:
            # --- 核心修复：在返回的 info 对象中加入 id ---
            customer_info = {}
            if contract.customer:
                customer_info = {
                    "id": contract.customer.id, # <-- 补上 ID
                    "name": contract.customer.name,
                    "phone_number": contract.customer.phone_number,
                    "id_card_number": contract.customer.id_card_number,
                    "address": contract.customer.address,
                }

            employee_info = {}
            if contract.service_personnel:
                employee_info = {
                    "id": contract.service_personnel.id, # <-- 补上 ID
                    "name": contract.service_personnel.name,
                    "phone_number": contract.service_personnel.phone_number,
                    "id_card_number": contract.service_personnel.id_card_number,
                    "address": contract.service_personnel.address,
                }
            
            # 安全地获取特定子类的属性
            deposit_amount = getattr(contract, 'deposit_amount', None)
            security_deposit_paid = getattr(contract, 'security_deposit_paid', None)

            # 获取签名
            customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').first()
            employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').first()

            response_data = {
                "contract_id": str(contract.id),
                "role": role,
                "template_content": contract.template.content if contract.template else '',
                "service_content": contract.service_content,
                "attachment_content": contract.attachment_content,
                "customer_name": contract.customer_name,
                "employee_name": contract.service_personnel.name if contract.service_personnel else "服务人员",
                "customer_signature": f"/api/contracts/signatures/{customer_sig.id}/image" if customer_sig else None,
                "employee_signature": f"/api/contracts/signatures/{employee_sig.id}/image" if employee_sig else None,
                "signing_status": contract.signing_status.value,
                "customer_info": customer_info,
                "employee_info": employee_info,
                "type": contract.type,
                "service_type": contract.service_type,
                "start_date": contract.start_date.isoformat() if contract.start_date else None,
                "end_date": contract.end_date.isoformat() if contract.end_date else None,
                "employee_level": float(contract.employee_level) if contract.employee_level is not None else None,
                "management_fee_amount": float(contract.management_fee_amount) if contract.management_fee_amount is not None else None,
                "deposit_amount": float(deposit_amount) if deposit_amount is not None else None,
                "security_deposit_paid": float(security_deposit_paid) if security_deposit_paid is not None else None,
                "introduction_fee": float(contract.introduction_fee) if contract.introduction_fee is not None else None,
            }
            return jsonify(response_data)
        except Exception as e:
            current_app.logger.error(f"获取签名页数据时出错: {e}", exc_info=True)
            return jsonify({"error": "获取合同数据失败"}), 500

    # --- 处理 POST 请求 ---
    if request.method == "POST":
        data = request.get_json()
        if not data or "signature" not in data:
            return jsonify({"error": "缺少 'signature' 参数"}), 400

        signature = data["signature"]

        try:
            if role == "customer":
                customer_info_data = data.get("customer_info")
                if not customer_info_data or not all(customer_info_data.get(f) for f in ['name', 'phone_number', 'id_card_number', 'address' ]):
                    return jsonify({"error": "客户信息不完整，所有字段均为必填项。"}), 400

                if not contract.customer_id:
                    existing_customer = Customer.query.filter(
                        or_(Customer.id_card_number == customer_info_data['id_card_number'], Customer.phone_number == customer_info_data[ 'phone_number'])
                    ).first()

                    if existing_customer:
                        customer_to_work_with = existing_customer
                        customer_to_work_with.name = customer_info_data['name']
                        customer_to_work_with.address = customer_info_data['address']
                        customer_to_work_with.phone_number = customer_info_data['phone_number']
                        current_app.logger.info(f"发现已存在的客户 (ID: {existing_customer.id} )，更新其信息并关联到合同。" )
                    else:
                        from pypinyin import pinyin, Style
                        name = customer_info_data['name']
                        pinyin_full = "".join(p[0] for p in pinyin(name, style=Style.NORMAL))
                        pinyin_initials = "".join(p[0] for p in pinyin(name, style=Style.FIRST_LETTER))

                        new_customer = Customer(
                            name=name,
                            phone_number=customer_info_data['phone_number'],
                            id_card_number=customer_info_data['id_card_number'],
                            address=customer_info_data['address'],
                            name_pinyin=f"{pinyin_full} {pinyin_initials}"
                        )
                        db.session.add(new_customer)
                        db.session.flush()
                        customer_to_work_with = new_customer
                        current_app.logger.info(f"创建了新客户 (ID: {new_customer.id})。" )

                    contract.customer_id = customer_to_work_with.id
                    contract.customer_name = customer_to_work_with.name
                    contract.customer_name_pinyin = customer_to_work_with.name_pinyin
                else:
                    customer_to_update = Customer.query.get(contract.customer_id)
                    if customer_to_update:
                        customer_to_update.name = customer_info_data['name']
                        customer_to_update.phone_number = customer_info_data['phone_number']
                        customer_to_update.id_card_number = customer_info_data['id_card_number']
                        customer_to_update.address = customer_info_data['address']
                        current_app.logger.info(f"更新了客户 (ID: {customer_to_update.id}) 的信息。" )

                # 保存签名到文件和 ContractSignature 表
                signature_data = data["signature"]
                if "," in signature_data:
                    header, encoded = signature_data.split(",", 1)
                else:
                    encoded = signature_data
                
                img_data = base64.b64decode(encoded)
                
                sig_dir = os.path.join(current_app.root_path, 'static', 'signatures')
                os.makedirs(sig_dir, exist_ok=True)
                
                filename = f"contract_{contract.id}_{role}_{uuid.uuid4()}.png"
                file_path = os.path.join(sig_dir, filename)
                
                with open(file_path, "wb") as f:
                    f.write(img_data)
                
                sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type=role).first()
                if not sig_record:
                    sig_record = ContractSignature(
                        contract_id=contract.id,
                        signature_type=role,
                        file_path=file_path,
                        mime_type="image/png"
                    )
                    db.session.add(sig_record)
                else:
                    # 删除旧文件
                    if os.path.exists(sig_record.file_path):
                        try:
                            os.remove(sig_record.file_path)
                        except:
                            pass
                    sig_record.file_path = file_path
                    sig_record.uploaded_at = func.now()

                # contract.customer_signature = signature <-- REMOVED
                # --- 核心修复：使用行锁和真实签名记录来更新状态，防止并发覆盖 ---
                # 1. 重新获取并锁定合同行
                contract_locked = BaseContract.query.with_for_update().get(contract.id)
                
                # 2. 检查双方签名是否存在
                has_customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').count() > 0
                has_employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').count() > 0

                current_app.logger.info(f"签名状态检查 (Contract: {contract.id}): Customer={has_customer_sig}, Employee={has_employee_sig}")

                if has_customer_sig and has_employee_sig:
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.SIGNED
                        contract_locked.status = "active"
                        update_salary_history_on_contract_activation(contract_locked)
                        current_app.logger.info(f"合同 {contract.id} 已激活 (双发签署完成)。")
                elif has_customer_sig:
                    # 只有在非 SIGNED 状态下才更新，防止回退
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.CUSTOMER_SIGNED
                elif has_employee_sig:
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.EMPLOYEE_SIGNED

            elif role == "employee":
                employee_info_data = data.get("employee_info")
                if not employee_info_data or not all(employee_info_data.get(f) for f in ['name', 'phone_number', 'id_card_number', 'address' ]):
                    return jsonify({"error": "员工信息不完整，所有字段均为必填项。"}), 400

                employee_to_update = ServicePersonnel.query.get(contract.service_personnel_id)
                if employee_to_update:
                    employee_to_update.name = employee_info_data['name']
                    employee_to_update.phone_number = employee_info_data['phone_number']
                    employee_to_update.id_card_number = employee_info_data['id_card_number']
                    employee_to_update.address = employee_info_data['address']
                    current_app.logger.info(f"更新了服务人员 (ID: {employee_to_update.id}) 的信息。")

                # 保存签名到文件和 ContractSignature 表
                signature_data = data["signature"]
                if "," in signature_data:
                    header, encoded = signature_data.split(",", 1)
                else:
                    encoded = signature_data
                
                img_data = base64.b64decode(encoded)
                
                sig_dir = os.path.join(current_app.root_path, 'static', 'signatures')
                os.makedirs(sig_dir, exist_ok=True)
                
                filename = f"contract_{contract.id}_{role}_{uuid.uuid4()}.png"
                file_path = os.path.join(sig_dir, filename)
                
                with open(file_path, "wb") as f:
                    f.write(img_data)
                
                sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type=role).first()
                if not sig_record:
                    sig_record = ContractSignature(
                        contract_id=contract.id,
                        signature_type=role,
                        file_path=file_path,
                        mime_type="image/png"
                    )
                    db.session.add(sig_record)
                else:
                    # 删除旧文件
                    if os.path.exists(sig_record.file_path):
                        try:
                            os.remove(sig_record.file_path)
                        except:
                            pass
                    sig_record.file_path = file_path
                    sig_record.uploaded_at = func.now()

                # --- 核心修复：使用行锁和真实签名记录来更新状态，防止并发覆盖 ---
                # 1. 重新获取并锁定合同行
                contract_locked = BaseContract.query.with_for_update().get(contract.id)
                
                # 2. 检查双方签名是否存在
                has_customer_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').count() > 0
                has_employee_sig = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').count() > 0

                current_app.logger.info(f"签名状态检查 (Contract: {contract.id}): Customer={has_customer_sig}, Employee={has_employee_sig}")

                if has_customer_sig and has_employee_sig:
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.SIGNED
                        contract_locked.status = "active"
                        update_salary_history_on_contract_activation(contract_locked)
                        current_app.logger.info(f"合同 {contract.id} 已激活 (双发签署完成)。")
                elif has_customer_sig:
                    # 只有在非 SIGNED 状态下才更新，防止回退
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.CUSTOMER_SIGNED
                elif has_employee_sig:
                    if contract_locked.signing_status != SigningStatus.SIGNED:
                        contract_locked.signing_status = SigningStatus.EMPLOYEE_SIGNED

            db.session.commit()
            create_contract_operation_log(
                contract=contract,
                user_id=None,
                action="sign",
                title="合同签署",
                summary=f"{'客户' if role == 'customer' else '服务人员'}完成签署",
                details={
                    "role": role,
                    "signing_status": contract.signing_status.value if contract.signing_status else None,
                    "contract_status": contract.status,
                },
            )
            db.session.commit()

            # --- 触发企业微信异步推送 ---
            try:
                from backend.tasks import send_wechat_notification_task
                
                # 获取相关属性
                customer_name = contract.customer_name
                employee_name = contract.service_personnel.name if contract.service_personnel else "服务人员"
                
                type_choices = {
                    "nanny": "育儿嫂合同",
                    "maternity_nurse": "月嫂合同",
                    "nanny_trial": "育儿嫂试工合同",
                    "external_substitution": "外部替班合同",
                }
                contract_type_label = type_choices.get(contract.type, contract.type)
                
                frontend_base_url = current_app.config.get('FRONTEND_BASE_URL', 'http://localhost:5175')
                jump_url = f"{frontend_base_url}/contract/detail/{contract.id}"

                if has_customer_sig and has_employee_sig:
                    msg_type = "SIGN_FULLY"
                    title = "🎉 合同双发签署完成（合同已激活）"
                    description = (
                        f'<div class="gray">时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}</div>\n'
                        f'<div class="normal">合同已由客户({customer_name})与服务人员({employee_name})双方共同签署完毕，系统已自动将其激活。</div>\n'
                        f'<div class="normal">合同类型：{contract_type_label}</div>\n'
                        f'<div class="normal">合同周期：{contract.start_date.strftime("%Y-%m-%d")} 至 {contract.end_date.strftime("%Y-%m-%d")}</div>\n'
                        f'<div class="highlight">请进入后台确认后续服务对接安排。</div>'
                    )
                elif role == "customer":
                    msg_type = "SIGN_CUSTOMER"
                    title = "✍️ 客户已完成合同签署"
                    description = (
                        f'<div class="gray">时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}</div>\n'
                        f'<div class="normal">客户 {customer_name} 已在线上签署了合同。</div>\n'
                        f'<div class="normal">合同类型：{contract_type_label}</div>\n'
                        f'<div class="highlight">目前等待服务人员签署。</div>'
                    )
                else:
                    msg_type = "SIGN_EMPLOYEE"
                    title = "🤝 服务人员已完成合同签署"
                    description = (
                        f'<div class="gray">时间：{datetime.now().strftime("%Y-%m-%d %H:%M")}</div>\n'
                        f'<div class="normal">服务人员 {employee_name} 已在线上签署了合同。</div>\n'
                        f'<div class="normal">合同类型：{contract_type_label}</div>\n'
                        f'<div class="highlight">目前等待客户签署。</div>'
                    )
                from backend.api.setting_api import get_or_create_notification_config
                
                config_obj = get_or_create_notification_config()
                sign_event_cfg = config_obj.value.get("reminders", {}).get("sign_event", {})
                    
                if sign_event_cfg.get("enabled", True):
                    notify_users = (sign_event_cfg.get("notify_users") or "").strip() or None
                    send_wechat_notification_task.delay(
                        touser=notify_users,
                        title=title,
                        description=description,
                        jump_url=jump_url,
                        msg_type=msg_type
                    )
            except Exception as pe:
                current_app.logger.error(f"触发企业微信异步推送失败: {pe}", exc_info=True)

            return jsonify({"message": "签名成功！"}), 200

        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f"处理签名时发生错误: {e}", exc_info=True)
            return jsonify({"error": "处理签名时发生服务器内部错误"}), 500
    
    return jsonify({"error": "不支持的请求方法"}), 405
    
# 1. 定义一个从“资产ID”到真实文件名的映射
# 这两个UUID是我们为签章图片指定的唯一ID
SEAL_ASSETS = {
    "c7a8f0e2-3b4d-4c6e-8a9b-1c2d3e4f5a6b": "company_sign_myms.webp",
    "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d": "company_sign_jfa.webp",
}

@contract_bp.route("/assets/<string:asset_id>", methods=["GET"])
def get_private_asset(asset_id):
    """
    一个安全的接口，用于根据ID提供私有静态资源（如签章图片）。
    """
    # 2. 将目录路径的定义移到函数内部
    # 此时 app context 已经存在，current_app 可用
    private_asset_dir = os.path.join(current_app.root_path, '..', 'backend', 'static', 'private_assets')

    # 3. 从映射中查找文件名
    filename = SEAL_ASSETS.get(asset_id)

    if not filename:
        return "Asset not found", 404

    try:
        # 4. 使用 Flask 的 send_from_directory 安全地发送文件
        return send_from_directory(private_asset_dir, filename)
    except FileNotFoundError:
        current_app.logger.error(f"Asset file not found on disk: {filename} in dir {private_asset_dir}")
        return "Asset file not found", 404


@contract_bp.route("/<string:contract_id>/signing-messages", methods=["GET"])
@jwt_required()
def generate_signing_messages(contract_id):
    """
    为新创建的合同生成客户和员工的签署通知消息 (V3 - 包含支付记录)。
    """
    try:
        # 1. 关联加载获取合同、客户及服务人员信息
        contract = BaseContract.query.options(
            joinedload(BaseContract.customer),
            joinedload(BaseContract.service_personnel)
        ).filter_by(id=contract_id).first()

        if not contract:
            return jsonify({"error": "合同未找到"}), 404

        customer_name = contract.customer.name if contract.customer else contract.customer_name
        employee_name = contract.service_personnel.name if contract.service_personnel else "服务人员"
        

        # 2. 根据合同类型选择正确的银行账户
        if contract.type == 'maternity_nurse':
            account_nickname = '萌姨萌嫂账号'
        else:
            account_nickname = '家福安账号'

        bank_account = CompanyBankAccount.query.filter_by(account_nickname=account_nickname, is_active=True).first()
        if not bank_account:
            return jsonify({"error": f"未找到昵称为 '{account_nickname}' 的有效公司银行账户"}), 500

        # 3. 查找第一期账单
        first_bill = CustomerBill.query.filter_by(
            contract_id=contract_id,
            is_substitute_bill=False
        ).order_by(CustomerBill.cycle_start_date.asc()).first()

        # 4. 构建签署链接。小程序 URL Link 启用后作为主链接，Web 链接仍保留为兜底。
        from backend.api.setting_api import get_or_create_miniapp_signing_config
        miniapp_config = get_or_create_miniapp_signing_config().value or {}
        customer_signing_link = _build_contract_signing_link(
            contract.customer_signing_token,
            "customer",
            miniapp_config,
        )
        employee_signing_link = _build_contract_signing_link(
            contract.employee_signing_token,
            "employee",
            miniapp_config,
        )
        customer_signing_url = customer_signing_link["primary_url"]
        employee_signing_url = employee_signing_link["primary_url"]

        # 5. 生成客户消息
        customer_message_lines = []
        customer_message_lines.append(f"{customer_name}——{employee_name}：签约 {contract.start_date.strftime('%Y.%m.%d')}~{contract.end_date.strftime('%Y.%m.%d')}，")

        payment_records = []
        if first_bill:
            # --- V3 核心修改：强制刷新账单支付状态 ---
            _update_bill_payment_status(first_bill)
            db.session.commit()
            db.session.refresh(first_bill)

                        # --- 提取费用详情 (V4 - 增加月嫂合同特殊处理) ---
            calculation_details = first_bill.calculation_details or {}
            
            # --- 核心修改：统一处理管理费的显示逻辑 ---
            calc_values = [] # 用于收集计算项
            management_fee_amount = D(calculation_details.get('management_fee', 0))
            if management_fee_amount > 0:
                calc_values.append(management_fee_amount)
                log_extras = calculation_details.get('log_extras', {})
                management_fee_reason = log_extras.get('management_fee_reason')
                
                if management_fee_reason and ':' in management_fee_reason:
                    # 优先使用带有计算过程的详细描述
                    calculation_process = management_fee_reason.split(':', 1)[-1].strip()
                    customer_message_lines.append(f"管理费: {calculation_process}")
                else:
                    # 如果没有详细描述，则只显示总金额
                    customer_message_lines.append(f"管理费: {management_fee_amount:.2f}元")
            # --- 修改结束 ---




            # --- 通用逻辑：处理其他增减款项 ---
            adjustments = FinancialAdjustment.query.filter_by(customer_bill_id=first_bill.id).all ()
            for adj in adjustments:
                # --- 核心修正：为月嫂合同增加更强的过滤，防止重复 ---
                if contract.type == 'maternity_nurse':
                    # 如果 adjustment 类型或描述是我们已经明确处理过的，就跳过
                    # 注意：这里使用 str() 转换以兼容 Enum 和 字符串
                    adj_type_str = str(adj.adjustment_type.value) if hasattr(adj.adjustment_type, 'value') else str(adj.adjustment_type)
                    
                    if adj_type_str in ['customer_deposit', 'management_fee'] or \
                       adj.description.strip() in ["保证金", "客交保证金", "管理费"]:
                        continue
                
                # 排除不应由客户看到的员工侧调整
                # 同样使用字符串比较以确保安全
                adj_type_str = str(adj.adjustment_type.value) if hasattr(adj.adjustment_type, 'value') else str(adj.adjustment_type)
                
                if adj_type_str not in ['employee_salary_adjustment', 'employee_bonus', 'employee_deduction']:
                    customer_message_lines.append(f"{adj.description.strip()}：{adj.amount:.2f} 元")
                    
                    # --- 核心修复：根据类型判断正负号 ---
                    val = adj.amount
                    if adj_type_str in ['customer_decrease', 'customer_discount']:
                        val = -val
                    calc_values.append(val)

            # --- 添加总计 (带计算过程) ---
            amount_to_pay = first_bill.total_due
            if len(calc_values) > 1:
                calc_str = ""
                for i, val in enumerate(calc_values):
                    if i == 0:
                        calc_str += f"{val:.2f}"
                    else:
                        if val >= 0:
                            calc_str += f" + {val:.2f}"
                        else:
                            calc_str += f" - {abs(val):.2f}"
                customer_message_lines.append(f"费用总计：{calc_str} = {amount_to_pay:.2f}元")
            else:
                customer_message_lines.append(f"费用总计：{amount_to_pay:.2f}元")
            if first_bill.total_paid > 0:
                customer_message_lines.append(f"已支付：{first_bill.total_paid:.2f}元")
                customer_message_lines.append(f"还需支付：{(amount_to_pay - first_bill.total_paid):.2f}元，")
            # else:
            #      customer_message_lines.append("，") # 保持格式一致

            # 查询收款记录
            payment_records = PaymentRecord.query.filter_by(customer_bill_id=first_bill.id ).order_by(PaymentRecord.payment_date.asc()).all()
        else:
            current_app.logger.warning(f"合同 {contract_id} 的首期账单尚未生成，月嫂合同、试工消息中将不包含费用信息。" )
            # --- 月嫂合同的特殊消息格式,月嫂合同创建时没有首月账单 ---
            if contract.type == 'maternity_nurse':
                deposit_amount = contract.deposit_amount or D(0)
                customer_deposit = deposit_amount
                customer_message_lines.append(f"定金：{customer_deposit:.2f} 元")

            if contract.type == 'nanny_trial':
                introduction_fee = contract.introduction_fee or D(0)
                customer_deposit = introduction_fee
                if introduction_fee > 0:
                    customer_message_lines.append(f"介绍费：{customer_deposit:.2f} 元")
                

        customer_message_lines.append(f"\n户名：{bank_account.payee_name}")
        customer_message_lines.append(f"帐号：{bank_account.account_number}")
        customer_message_lines.append(f"银行：{bank_account.bank_name}")
        customer_message_lines.append("\n合同：")
        customer_message_lines.append(customer_signing_url)
        customer_message_lines.append("1、 请点开上面链接，将甲方内容填写完整")
        customer_message_lines.append("2、 阅读完内容后，最下面签字")
        customer_message_lines.append("3、 签署完毕，最后关闭页面即可")

        # --- V3 新增：附上收款记录 ---
        if payment_records:
            customer_message_lines.append("\n--- 收款记录 ---")
            for p in payment_records:
                payment_date_str = p.payment_date.strftime('%Y-%m-%d') if p.payment_date else 'N/A'
                # 【已修复】移除.2和f之间的空格
                customer_message_lines.append(f"通过「{p.method}」打款 {p.amount:.2f}元 {p.notes} ")

        # 6. 生成员工消息 (保持不变)
        employee_message_lines = []
        # employee_message_lines.append(f"{customer_name}——{employee_name}：签约 {contract.start_date.strftime('%Y.%m.%d')}~{contract.end_date.strftime('%Y.%m.%d')}，")
        # employee_message_lines.append(f"月薪：{contract.employee_level or '待定'}，")
        employee_message_lines.append("\n合同：")
        employee_message_lines.append(employee_signing_url)
        employee_message_lines.append("1、 请点开上面链接，将乙方内容填写完整")
        employee_message_lines.append("2、 阅读完内容后，最下面签字")
        employee_message_lines.append("3、 签署完毕，最后关闭页面即可")

        customer_message = '\n'.join(customer_message_lines).replace("[系统添加] ", "").strip()
        employee_message = '\n'.join(employee_message_lines).replace("[系统添加] ", "").strip()

        return jsonify({
            "customer_message": customer_message,
            "employee_message": employee_message,
            "links": {
                "customer": customer_signing_link,
                "employee": employee_signing_link,
            },
            "miniapp_config": {
                "enabled": bool(miniapp_config.get("enabled")),
                "env_version": miniapp_config.get("env_version") or "release",
                "expire_days": miniapp_config.get("expire_days") or 30,
                "diagnostics": miniapp_credential_status(miniapp_config.get("appid")),
            }
        })

    except Exception as e:
        current_app.logger.error(f"为合同 {contract_id} 生成签署消息失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_bp.route("/<uuid:contract_id>/renew", methods=["POST"])
@jwt_required()
def renew_contract_api(contract_id):
    """
    续约合同。
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    required_fields = ["start_date", "end_date", "management_fee_amount", "employee_level"]
    missing_fields = [field for field in required_fields if field not in data or data[field] is None]
    if missing_fields:
        return jsonify({"error": f"续约请求缺少必填字段: {', '.join(missing_fields)}"}), 400

    try:
        contract_service = ContractService()
        # 1. 创建合同对象（不提交）
        old_contract = db.session.get(BaseContract, str(contract_id))
        before_snapshot = snapshot_contract(old_contract)
        renewed_contract = contract_service.renew_contract(str(contract_id), data)

        # 2. 在同一事务中，同步生成初始账单并处理自动续约
        engine = BillingEngine()
        
        # 月嫂合同续约优化：自动确认上户日期后生成账单
        if isinstance(renewed_contract, MaternityNurseContract):
            if renewed_contract.actual_onboarding_date:
                current_app.logger.info(f"为月嫂续约合同 {renewed_contract.id} (已确认上户日期: {renewed_contract.actual_onboarding_date}) 同步生成初始账单...")
                engine.generate_all_bills_for_contract(renewed_contract.id, force_recalculate=True)
                current_app.logger.info(f"月嫂合同 {renewed_contract.id} 的初始账单已生成。")
            else:
                current_app.logger.info(f"月嫂合同 {renewed_contract.id} 尚未确认上户日期,跳过账单生成。")
        else:
            # 育儿嫂、试用期等其他合同类型
            current_app.logger.info(f"为新激活的合同 {renewed_contract.id} (类型: {renewed_contract.type}) 同步生成初始账单...")
            engine.generate_all_bills_for_contract(renewed_contract.id, force_recalculate=True)
            current_app.logger.info(f"合同 {renewed_contract.id} 的初始账单已生成。")

        if isinstance(renewed_contract, NannyContract) and renewed_contract.is_monthly_auto_renew:
            current_app.logger.info(f"为合同 {renewed_contract.id} 触发首次自动续签检查...")
            engine.extend_auto_renew_bills(renewed_contract.id)
            current_app.logger.info(f"合同 {renewed_contract.id} 的首次自动续签检查完成。")
        # 3. 所有操作成功后，执行唯一一次提交
        old_contract_after = db.session.get(BaseContract, str(contract_id))
        old_changes = diff_snapshots(before_snapshot, snapshot_contract(old_contract_after))
        create_contract_operation_log(
            contract=old_contract_after,
            related_contract=renewed_contract,
            user_id=get_jwt_identity(),
            action="renew",
            title="续约合同",
            summary=f"续约生成新合同 {renewed_contract.id}",
            details={
                "new_contract_id": str(renewed_contract.id),
                "new_start_date": renewed_contract.start_date.isoformat() if renewed_contract.start_date else None,
                "new_end_date": renewed_contract.end_date.isoformat() if renewed_contract.end_date else None,
                "transfer_deposit": data.get("transfer_deposit", True),
            },
            changes=old_changes,
        )
        create_contract_operation_log(
            contract=renewed_contract,
            related_contract=old_contract_after,
            user_id=get_jwt_identity(),
            action="create_from_renewal",
            title="由续约创建",
            summary=f"由源合同 {contract_id} 续约创建",
            details={"source_contract_id": str(contract_id)},
            changes={"created": {"from": None, "to": snapshot_contract(renewed_contract)}},
        )
        db.session.commit()
        current_app.logger.info(f"已为合同 {renewed_contract.id} 的续约及账单生成操作提交数据库事务。")

        return jsonify({"message": "合同续约成功", "new_contract_id": str(renewed_contract.id)}), 201

    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"续约合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_bp.route("/<uuid:contract_id>/extend", methods=["PATCH"])
@jwt_required()
def extend_contract_api(contract_id):
    """
    延长月嫂合同的结束日期
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    if "new_end_date" not in data:
        return jsonify({"error": "缺少必填字段: new_end_date"}), 400

    try:
        from datetime import datetime
        new_end_date = datetime.fromisoformat(data["new_end_date"]).date()
        
        contract_service = ContractService()
        contract_before = db.session.get(BaseContract, str(contract_id))
        before_snapshot = snapshot_contract(contract_before)
        contract, bills_count, new_bills = contract_service.extend_contract(str(contract_id), new_end_date)
        changes = diff_snapshots(before_snapshot, snapshot_contract(contract))
        create_contract_operation_log(
            contract=contract,
            user_id=get_jwt_identity(),
            action="extend",
            title="延长合同",
            summary=f"合同结束日期延长至 {new_end_date}",
            details={"new_end_date": str(new_end_date), "bills_count": bills_count},
            changes=changes,
        )
        
        # 提交事务
        db.session.commit()
        current_app.logger.info(f"已为合同 {contract_id} 的延长操作提交数据库事务。")
        
        return jsonify({
            "message": "合同延长成功",
            "contract_id": str(contract.id),
            "new_end_date": contract.end_date.isoformat(),
            "bills_count": bills_count
        }), 200

    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"延长合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500

@contract_bp.route("/<uuid:contract_id>/change", methods=["POST"])
@jwt_required()
def change_contract_api(contract_id):
    """
    变更合同：终止旧合同，并创建一个继承部分信息的新合同。
    这是一个原子操作。
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体不能为空"}), 400

    # Basic validation
    required_fields = ["start_date", "end_date", "employee_level", "service_personnel_id"]
    missing_fields = [field for field in required_fields if field not in data or not data[field]]
    if missing_fields:
        return jsonify({"error": f"变更请求缺少必填字段: {', '.join(missing_fields)}"}), 400

    try:
        contract_service = ContractService()
        # This service call will be atomic
        old_contract = db.session.get(BaseContract, str(contract_id))
        before_snapshot = snapshot_contract(old_contract)
        changed_contract = contract_service.change_contract(str(contract_id), data)
        
        # Optional: trigger background tasks if needed, like for the new contract's bills
        trigger_initial_bill_generation_task.delay(str(changed_contract.id))
        
        # --- 在这里添加下面这行 ---
        old_contract_after = db.session.get(BaseContract, str(contract_id))
        old_changes = diff_snapshots(before_snapshot, snapshot_contract(old_contract_after))
        create_contract_operation_log(
            contract=old_contract_after,
            related_contract=changed_contract,
            user_id=get_jwt_identity(),
            action="change",
            title="变更合同",
            summary=f"变更生成新合同 {changed_contract.id}",
            details={
                "new_contract_id": str(changed_contract.id),
                "new_start_date": changed_contract.start_date.isoformat() if changed_contract.start_date else None,
                "new_end_date": changed_contract.end_date.isoformat() if changed_contract.end_date else None,
                "transfer_deposit": data.get("transfer_deposit", True),
            },
            changes=old_changes,
        )
        create_contract_operation_log(
            contract=changed_contract,
            related_contract=old_contract_after,
            user_id=get_jwt_identity(),
            action="create_from_change",
            title="由变更创建",
            summary=f"由源合同 {contract_id} 变更创建",
            details={"source_contract_id": str(contract_id)},
            changes={"created": {"from": None, "to": snapshot_contract(changed_contract)}},
        )
        db.session.commit()

        return jsonify({
            "message": "合同变更成功！",
            "new_contract_id": str(changed_contract.id)
        }), 201

    except ValueError as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"变更合同 {contract_id} 失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500
    


@contract_bp.route("/customer/<uuid:customer_id>/transferable-contracts", methods=["GET"])
@jwt_required()
def get_transferable_contracts_for_customer(customer_id):
    """
    查找客户名下所有可用于转移保证金的合同。
    规则：
    - 状态为 'active' 或 'pending'。
    - 或状态为 'terminated' 或 'finished' 且结束日期在12个月内。
    - 且合同的 security_deposit_paid > 0。
    """
    try:
        # --- 调试代码块开始 ---
        customer = Customer.query.get(customer_id)
        customer_name = customer.name if customer else "未知客户"
        current_app.logger.debug(f"--- [DEBUG] 开始检查可转移合同，客户: {customer_name} (ID: {customer_id}) ---")

        # 1. 检查该客户名下所有的合同，看看原始数据是什么
        all_customer_contracts = BaseContract.query.filter_by(customer_id=customer_id).order_by(BaseContract.end_date.desc()). all()
        current_app.logger.debug(f"[DEBUG] 步骤1: 找到该客户名下总共有 {len (all_customer_contracts)} 个合同。")
        if not all_customer_contracts:
            return jsonify([]) # 如果一个合同都没有，直接返回

        for c in all_customer_contracts:
            effective_end = c.termination_date or c.end_date
            current_app.logger.debug(
                f"[DEBUG]   - 原始合同: ID={c.id}, 状态='{c.status}', "
                f"已付保证金={c.security_deposit_paid}, 结束/终止于={effective_end.isoformat() if effective_end else 'N/A'}"
            )

        # 2. 检查日期过滤条件
        twelve_months_ago = datetime.utcnow().date() - relativedelta(months=12)
        current_app.logger.debug(f"[DEBUG] 步骤2: 日期过滤条件为，结束/终止日期必须晚于或等于 {twelve_months_ago.isoformat()}")

        # 3. 分步应用过滤条件并打印每一步的结果
        contract_poly = db.with_polymorphic(BaseContract, "*")
        
        # 过滤条件 a: 客户ID
        query = db.session.query(contract_poly).filter(BaseContract.customer_id == customer_id)
        
        # 过滤条件 b: 已付保证金 > 0
        query = query.filter(BaseContract.security_deposit_paid > 0)
        current_app.logger.debug(f"[DEBUG] 步骤3.1: 应用“已付保证金 > 0”后，剩下 {query.count()} 个合同。")

        # 过滤条件 c: 状态和日期
        status_and_date_filter = or_(
            BaseContract.status.in_(['active', 'pending']),
            and_(
                BaseContract.status.in_(['terminated', 'finished']),
                func.coalesce(BaseContract.termination_date, BaseContract.end_date) >= twelve_months_ago
            )
        )
        query = query.filter(status_and_date_filter)
        current_app.logger.debug(f"[DEBUG] 步骤3.2: 应用“状态和日期”过滤后，剩下 {query.count()} 个合同。")
        
        # --- 调试代码块结束 ---

        # 执行最终查询
        contracts = query.options(joinedload(contract_poly.service_personnel)).order_by(BaseContract.end_date.desc( )).all()
        current_app.logger.debug(f"[DEBUG] 最终查询结果数量: {len(contracts)}")

        results = []
        for contract in contracts:
            effective_end_date = contract.termination_date or contract.end_date
            results.append({
                "contract_id": str(contract.id),
                "service_personnel_name": contract.service_personnel.name if contract.service_personnel else "N/A",
                "employee_level": str(contract.employee_level or 0),
                "effective_end_date": effective_end_date.isoformat(),
                "transferable_deposit_amount": str(contract.security_deposit_paid or 0)
            })

        return jsonify(results)

    except Exception as e:
        current_app.logger.error(f"查找客户 {customer_id} 的可转移合同失败: {e}", exc_info=True )
        return jsonify({"error": "内部服务器错误"}), 500
    
@contract_bp.route("/<uuid:contract_id>/signature/<string:role>", methods=["GET"])
@jwt_required()
def get_contract_signature(contract_id, role):
    """
    专门用于获取单个签名图片的接口，供前端懒加载使用。
    """
    try:
        contract = BaseContract.query.get_or_404(str(contract_id))
        
        sig_record = None
        if role == "customer":
            sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='customer').first()
        elif role == "employee":
            sig_record = ContractSignature.query.filter_by(contract_id=contract.id, signature_type='employee').first()
        else:
            return jsonify({"error": "无效的角色"}), 400

        if not sig_record:
            return jsonify({"signature": None}), 404

        return jsonify({"signature": f"/api/contracts/signatures/{sig_record.id}/image"})

    except Exception as e:
        current_app.logger.error(f"获取合同 {contract_id} 的签名失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/wechat-messages", methods=["GET"])
@jwt_required()
def get_wechat_messages():
    """
    分页拉取企业微信消息通知日志，用于后台审计管理。
    支持过滤: status, message_type, touser
    """
    try:
        page = request.args.get("page", 1, type=int)
        per_page = request.args.get("per_page", 20, type=int)
        status = request.args.get("status")
        message_type = request.args.get("message_type")
        touser = request.args.get("touser")

        query = WechatMessageLog.query

        if status:
            query = query.filter_by(status=status)
        if message_type:
            query = query.filter_by(message_type=message_type)
        if touser:
            query = query.filter(WechatMessageLog.touser.like(f"%{touser}%"))

        pagination = query.order_by(WechatMessageLog.sent_at.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        return jsonify({
            "total": pagination.total,
            "page": pagination.page,
            "per_page": pagination.per_page,
            "pages": pagination.pages,
            "items": [item.to_dict() for item in pagination.items]
        }), 200

    except Exception as e:
        current_app.logger.error(f"获取微信消息日志审计列表失败: {e}", exc_info=True)
        return jsonify({"error": "内部服务器错误"}), 500


@contract_bp.route("/wechat-messages/<log_id>/retry", methods=["POST"])
@jwt_required()
def retry_wechat_message(log_id):
    """
    手动一键重新发送微信消息日志。
    """
    try:
        from backend.models import WechatMessageLog, db
        from backend.utils.wechat_notifier import send_wechat_notification
        import json

        log = WechatMessageLog.query.get(log_id)
        if not log:
            return jsonify({"error": "未找到对应的推送日志"}), 404

        title = log.title or "系统提醒"
        description = log.description or ""
        url = log.jump_url

        # 同步重试发送
        success, raw_result = send_wechat_notification(
            touser=log.touser,
            title=title,
            description=description,
            jump_url=url
        )

        # 更新数据库日志状态
        log.status = "success" if success else "failed"
        log.sent_at = db.func.now()
        log.error_details = None if success else raw_result
        db.session.commit()

        if success:
            return jsonify({"message": "重新发送成功", "status": "success"}), 200
        else:
            return jsonify({
                "error": "重新发送失败",
                "status": "failed",
                "error_details": raw_result
            }), 400

    except Exception as e:
        current_app.logger.error(f"重试发送微信消息失败: {e}", exc_info=True)
        return jsonify({"error": f"系统内部错误: {str(e)}"}), 500
