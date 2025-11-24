# backend/api/staff_api.py
from flask import Blueprint, jsonify, request
from backend.models import ServicePersonnel, EmployeeSalaryHistory, BaseContract, DynamicFormData, DynamicForm
from backend.extensions import db
from sqlalchemy.orm import joinedload
from sqlalchemy import or_, func as sql_func
from datetime import datetime
import logging

staff_api = Blueprint('staff_api', __name__, url_prefix='/api/staff')

# 合同类型到职位的映射
CONTRACT_TYPE_TO_POSITION = {
    'nanny': '育儿嫂',
    'maternity_nurse': '月嫂',
    'nanny_trial': '育儿嫂',
    'external_substitution': '育儿嫂'
}

# 合同类型中文名称
CONTRACT_TYPE_DISPLAY = {
    'nanny': '育儿嫂合同',
    'maternity_nurse': '月嫂合同',
    'nanny_trial': '育儿嫂试岗合同',
    'external_substitution': '外部代班合同'
}
