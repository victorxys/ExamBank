"""
从入职登记动态表单创建/更新 ServicePersonnel。

入职表 token: N0Il9H（萌嫂入职登记表）
提交或更新表单数据后可自动调用；也支持管理端手动触发。
"""
from __future__ import annotations

import logging
from typing import Any, Optional, Tuple

from backend.extensions import db
from backend.models import DynamicFormData, ServicePersonnel

logger = logging.getLogger(__name__)

# 与 staff_api / 员工详情页保持一致
ENTRY_FORM_TOKEN = "N0Il9H"


def _clean_optional_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
    else:
        value = str(value).strip()
    return value or None


def _first_present(data: dict, keys: list) -> Any:
    for key in keys:
        value = data.get(key)
        if value is not None and value != "":
            return value
    return None


def extract_staff_fields_from_form_data(data: dict) -> dict:
    """从入职登记表 JSON 中提取员工字段（支持多种历史字段名）。"""
    if not data:
        return {}

    name = _first_present(data, ["field_1", "姓名", "name"])
    phone_number = _first_present(
        data, ["field_2", "手机号", "phone_number", "联系电话", "手机"]
    )
    id_card_number = _first_present(
        data, ["field_93", "身份证号", "id_card_number", "身份证号码"]
    )
    address = _first_present(
        data, ["field_3", "现居住地址", "address", "住址", "身份证上地址"]
    )
    salary_card_holder_name = _first_present(
        data,
        [
            "问题3",
            "工资卡持卡人",
            "工资卡持卡人姓名",
            "持卡人姓名",
            "salary_card_holder_name",
            "salary_card_holder",
        ],
    )
    salary_card_bank_name = _first_present(
        data,
        [
            "问题4",
            "工资卡开户行",
            "工资卡开户行名称",
            "开户行",
            "开户行名称",
            "salary_card_bank_name",
            "salary_card_bank",
        ],
    )
    salary_card_number = _first_present(
        data,
        [
            "问题5",
            "工资卡卡号",
            "工资卡银行卡号",
            "银行卡号",
            "salary_card_number",
            "bank_card_number",
        ],
    )

    if phone_number is not None and not isinstance(phone_number, str):
        phone_number = str(phone_number)

    return {
        "name": _clean_optional_string(name),
        "phone_number": _clean_optional_string(phone_number),
        "id_card_number": _clean_optional_string(id_card_number),
        "address": _clean_optional_string(address),
        "salary_card_holder_name": _clean_optional_string(salary_card_holder_name),
        "salary_card_bank_name": _clean_optional_string(salary_card_bank_name),
        "salary_card_number": _clean_optional_string(salary_card_number),
    }


def find_existing_employee(
    phone_number: Optional[str], id_card_number: Optional[str]
) -> Optional[ServicePersonnel]:
    """手机号可能变更，优先用身份证号作为稳定身份查找。"""
    existing = None
    if id_card_number:
        existing = ServicePersonnel.query.filter_by(
            id_card_number=id_card_number
        ).first()
    if not existing and phone_number:
        existing = ServicePersonnel.query.filter_by(phone_number=phone_number).first()
    return existing


def create_or_update_staff_from_form_data(
    form_data: DynamicFormData,
    *,
    commit: bool = False,
) -> Tuple[ServicePersonnel, bool, str]:
    """
    根据 DynamicFormData 创建或更新员工。

    Args:
        form_data: 已加载的表单数据实例（data 字段应已就绪）
        commit: 是否在本函数内 commit。表单提交事务中应传 False。

    Returns:
        (employee, created, message)

    Raises:
        ValueError: 缺少必填字段等业务校验失败
    """
    data = form_data.data
    if not data:
        raise ValueError("表单数据为空")

    fields = extract_staff_fields_from_form_data(data)
    name = fields["name"]
    phone_number = fields["phone_number"]
    id_card_number = fields["id_card_number"]
    address = fields["address"]
    salary_card_holder_name = fields["salary_card_holder_name"]
    salary_card_bank_name = fields["salary_card_bank_name"]
    salary_card_number = fields["salary_card_number"]

    logger.info(
        "[CREATE_STAFF] data_id=%s 姓名=%s 手机号=%s 身份证=%s",
        form_data.id,
        name,
        phone_number,
        id_card_number,
    )

    if not name:
        raise ValueError("缺少必填字段：姓名")
    if not phone_number:
        raise ValueError("缺少必填字段：手机号")

    existing_employee = find_existing_employee(phone_number, id_card_number)

    if existing_employee:
        existing_employee.name = name
        existing_employee.phone_number = phone_number
        if id_card_number:
            existing_employee.id_card_number = id_card_number
        if address:
            existing_employee.address = address
        if salary_card_holder_name:
            existing_employee.salary_card_holder_name = salary_card_holder_name
        if salary_card_bank_name:
            existing_employee.salary_card_bank_name = salary_card_bank_name
        if salary_card_number:
            existing_employee.salary_card_number = salary_card_number

        form_data.service_personnel_id = existing_employee.id
        db.session.add(existing_employee)
        db.session.add(form_data)

        if commit:
            db.session.commit()
        else:
            db.session.flush()

        return existing_employee, False, "员工信息已更新"

    new_employee = ServicePersonnel(
        name=name,
        phone_number=phone_number,
        id_card_number=id_card_number,
        address=address,
        salary_card_holder_name=salary_card_holder_name,
        salary_card_bank_name=salary_card_bank_name,
        salary_card_number=salary_card_number,
        is_active=True,
    )
    db.session.add(new_employee)
    db.session.flush()

    form_data.service_personnel_id = new_employee.id
    db.session.add(form_data)

    if commit:
        db.session.commit()
    else:
        db.session.flush()

    return new_employee, True, "员工信息创建成功"


def maybe_auto_create_staff_from_entry_form(
    form_data: DynamicFormData,
    form_token: Optional[str],
) -> Optional[dict]:
    """
    若为入职登记表，则自动创建/更新员工。
    失败时记录日志但不抛出，避免阻断表单提交。

    Returns:
        成功时返回 {id, name, created, message}；跳过或失败返回 None。
    """
    if form_token != ENTRY_FORM_TOKEN:
        return None

    try:
        employee, created, message = create_or_update_staff_from_form_data(
            form_data, commit=False
        )
        logger.info(
            "[CREATE_STAFF] 入职表自动%s员工 %s (%s), form_data=%s",
            "创建" if created else "更新",
            employee.name,
            employee.id,
            form_data.id,
        )
        return {
            "id": str(employee.id),
            "name": employee.name,
            "created": created,
            "message": message,
        }
    except ValueError as e:
        logger.warning(
            "[CREATE_STAFF] 入职表自动创建跳过 form_data=%s: %s",
            form_data.id,
            e,
        )
        return None
    except Exception:
        logger.exception(
            "[CREATE_STAFF] 入职表自动创建失败 form_data=%s", form_data.id
        )
        return None
