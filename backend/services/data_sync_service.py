# backend/services/data_sync_service.py (健壮化人员查找与错误处理)

import httpx
import time
from flask import current_app
from datetime import datetime
from pypinyin import pinyin, Style
import decimal
from sqlalchemy.exc import IntegrityError
from datetime import date

from backend.extensions import db
from backend.models import (
    User,
    BaseContract,
    NannyContract,
    MaternityNurseContract,
    ServicePersonnel,
    LlmApiKey,
    NannyTrialContract,
)
from backend.security_utils import decrypt_data
from backend.services.contract_service import (
    upsert_introduction_fee_adjustment,
    create_maternity_nurse_contract_adjustments,
)

D = decimal.Decimal


class JinshujuAPIError(Exception):
    pass


class DataSyncService:
    BASE_URL = "https://jinshuju.net/api/v1"

    def __init__(self):
        self.api_key, self.api_secret = None, None
        self._load_credentials()

    def _load_credentials(self):
        api_key_record = LlmApiKey.query.filter_by(
            key_name="Jinshuju-Main-API", status="active"
        ).first()
        if not api_key_record:
            raise JinshujuAPIError("未找到名为 'Jinshuju-Main-API' 的活动API Key记录。")
        self.api_key = decrypt_data(api_key_record.api_key_encrypted)
        self.api_secret = api_key_record.notes
        if not self.api_key or not self.api_secret:
            raise JinshujuAPIError("API Key 或 Secret 为空。")

    def get_form_entries(self, form_token: str):
        path, all_entries, next_cursor, auth = (
            f"/forms/{form_token}/entries",
            [],
            None,
            (self.api_key, self.api_secret),
        )
        while True:
            params = {"next": next_cursor} if next_cursor else {}
            try:
                with httpx.Client(auth=auth, timeout=30.0) as client:
                    response = client.get(f"{self.BASE_URL}{path}", params=params)
                    response.raise_for_status()
                data = response.json()
                entries_this_page = data.get("data", [])
                if not isinstance(entries_this_page, list) or not entries_this_page:
                    break
                all_entries.extend(entries_this_page)
                next_cursor = data.get("next")
                if not next_cursor:
                    break
                time.sleep(1)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    raise JinshujuAPIError(
                        "金数据认证失败 (401)。请检查API凭证。"
                    ) from e
                raise JinshujuAPIError(f"API请求错误: {e.response.text}") from e
            except Exception as e:
                raise JinshujuAPIError(f"未知错误: {e}") from e
        return all_entries

    def _parse_numeric(self, value, default=0):
        if value is None or value == "":
            return decimal.Decimal(default)
        try:
            return decimal.Decimal(value)
        except (decimal.InvalidOperation, TypeError):
            return decimal.Decimal(default)

    def _parse_date(self, date_string):
        if not date_string:
            return None
        try:
            return datetime.strptime(date_string, "%Y-%m-%d")
        except (ValueError, TypeError):
            return None

    def _get_or_create_personnel_ref(self, name: str, phone: str = None):
        if not name or not name.strip():
            return None, None
        name = name.strip()
        phone = phone.strip() if phone else None

        # --- 核心修复：移除对内部用户(User)表的查找逻辑 ---
        # 在同步合同场景下，我们只关心外部服务人员(ServicePersonnel)

        # 1. 优先使用手机号在 ServicePersonnel 表中查找
        if phone:
            personnel = ServicePersonnel.query.filter_by(phone_number=phone).first()
            if personnel:
                return "service_personnel", personnel.id
        
        # 2. 如果手机号找不到，再使用姓名在 ServicePersonnel 表中查找
        personnel = ServicePersonnel.query.filter(
            db.func.lower(ServicePersonnel.name) == name.lower()
        ).first()
        if personnel:
            return "service_personnel", personnel.id

        # 3. 如果都找不到，则创建新的 ServicePersonnel
        try:
            pinyin_str = (
                "".join(p[0] for p in pinyin(name, style=Style.NORMAL))
                + " "
                + "".join(p[0] for p in pinyin(name, style=Style.FIRST_LETTER))
            )
        except Exception:
            pinyin_str = None

        new_personnel = ServicePersonnel(
            name=name, phone_number=phone, name_pinyin=pinyin_str
        )
        db.session.add(new_personnel)
        db.session.flush()
        current_app.logger.info(
            f"创建了新的外部服务人员记录: {name} (ID: {new_personnel.id})"
        )
        return "service_personnel", new_personnel.id

    def sync_contracts_from_form(
        self, form_token: str, contract_type: str, mapping_rules: dict
    ):
        current_app.logger.info(
            f"开始同步表单 {form_token} ({contract_type}) 的合同数据..."
        )
        entries = self.get_form_entries(form_token)
        synced_count, skipped_count, error_count = 0, 0, 0
        newly_synced_contract_ids = []

        for entry in entries:
            try:
                with db.session.begin_nested():
                    entry_serial_number = entry.get("serial_number")
                    if not entry_serial_number:
                        skipped_count += 1
                        continue

                    if BaseContract.query.filter_by(
                        jinshuju_entry_id=str(entry_serial_number), type=contract_type
                    ).first():
                        skipped_count += 1
                        continue

                    contract_data = {}
                    for db_field, jinshuju_config in mapping_rules.items():
                        jinshuju_field_id = jinshuju_config["field_id"]
                        value = None
                        if jinshuju_config.get("is_association"):
                            associated_field_id = jinshuju_config["associated_field_id"]
                            key_to_lookup = (
                                f"{jinshuju_field_id}_associated_{associated_field_id}"
                            )
                            value = entry.get(key_to_lookup)
                        else:
                            value = entry.get(jinshuju_field_id)
                        if isinstance(value, dict):
                            if all(
                                k in value
                                for k in ["province", "city", "district", "street"]
                            ):
                                value = f"{value.get('province','')}{value.get('city','')}{value.get('district','')}{value.get('street','')}"
                            else:
                                value = value.get("value")
                        contract_data[db_field] = (
                            str(value) if value is not None else None
                        )

                    personnel_type, personnel_id = self._get_or_create_personnel_ref(
                        contract_data.get("employee_name"),
                        contract_data.get("employee_phone"),
                    )

                    if not personnel_id:
                        error_count += 1
                        current_app.logger.warning(
                            f"条目 {entry_serial_number} 因员工信息缺失或查找失败而被跳过。"
                        )
                        continue

                    customer_name_final = (
                        str(contract_data.get("customer_name")).strip()
                        or f"客户(SN:{entry_serial_number})"
                    )
                    end_date = self._parse_date(contract_data.get("end_date"))

                    is_auto_renew = False
                    if contract_type == "nanny":
                        supplementary_clause = entry.get("field_16", "")
                        supplementary_clause_str = str(supplementary_clause)
                        is_auto_renew = ("延续一个月" in supplementary_clause_str or
                                       "续约" in supplementary_clause_str or
                                       "自动" in supplementary_clause_str)

                    # 2. 然后，根据是否自动续约来决定状态判断逻辑
                    if is_auto_renew:
                        # 对于自动续约的合同，状态始终为 'active'
                        contract_status = 'active'
                    elif contract_type == "nanny_trial":
                        # 对于试工合同，初始状态为 'trial_active'
                        contract_status = "trial_active"
                    else:
                        # 对于所有其他非自动续约的合同，使用日期比较
                        contract_status = (
                            "active" if end_date and end_date.date() >= date.today() else "finished"
                        )

                    # For nanny_trial, employee_level is daily rate * 30, as per form description.
                    employee_level_raw = self._parse_numeric(
                        contract_data.get("employee_level"), 0
                    )
                    if contract_type == "nanny_trial":
                        # 试工合同中填写的是日级别
                        employee_level_final = employee_level_raw
                    else:
                        employee_level_final = employee_level_raw

                    # 将客户名的拼音写入拼音字段。
                    try:
                        customer_name_pinyin_full = "".join(p[0] for p in pinyin(customer_name_final, style=Style.NORMAL))
                        customer_name_pinyin_initials = "".join(p[0] for p in pinyin(customer_name_final, style=Style.FIRST_LETTER))
                        customer_name_pinyin_final = f"{customer_name_pinyin_full} {customer_name_pinyin_initials}"
                    except Exception:
                        customer_name_pinyin_final = None

                    common_data = {
                        "type": contract_type,
                        "customer_name": customer_name_final,
                        "customer_name_pinyin": customer_name_pinyin_final,
                        "employee_level": str(employee_level_final),
                        "status": contract_status,
                        "jinshuju_entry_id": str(entry_serial_number),
                        "notes": contract_data.get("notes"),
                        "user_id": personnel_id if personnel_type == "user" else None,
                        "service_personnel_id": personnel_id
                        if personnel_type == "service_personnel"
                        else None,
                    }
                    new_contract = None
                    if contract_type == "maternity_nurse":
                        # 计算月嫂合同的管理费和管理费率
                        security_deposit = self._parse_numeric(contract_data.get("security_deposit_paid"), 0)
                        employee_level = self._parse_numeric(contract_data.get("employee_level"), 0)

                        calculated_management_fee = security_deposit - employee_level

                        calculated_management_fee_rate = D('0.00')
                        if security_deposit > 0:
                            calculated_management_fee_rate = (calculated_management_fee / security_deposit).quantize(D('0.00'))

                        new_contract = MaternityNurseContract(
                            **common_data,
                            provisional_start_date=self._parse_date(
                                contract_data.get("provisional_start_date")
                            ),
                            start_date=self._parse_date(
                                contract_data.get("provisional_start_date")
                            ),
                            end_date=end_date,
                            # 合同中没有月嫂定金字段，默认定金为3000
                            # deposit_amount=self._parse_numeric(
                            #     contract_data.get("deposit_amount"), 0
                            # ),
                            deposit_amount=D('3000'),
                            security_deposit_paid=security_deposit, # 使用计算后的值
                            management_fee_amount=calculated_management_fee, # 使用计算后的值
                            management_fee_rate=calculated_management_fee_rate, # 使用计算后的值
                            discount_amount=self._parse_numeric(
                                contract_data.get("discount_amount"), 0
                            ),
                        )
                    elif contract_type == "nanny":

                        parsed_start_date = self._parse_date(
                            contract_data.get("start_date")
                        )
                        # 管理费从合同中获取
                        management_fee_amount = self._parse_numeric(
                            contract_data.get("management_fee_amount")
                        )
                        new_contract = NannyContract(
                            **common_data,
                            start_date=parsed_start_date,
                            actual_onboarding_date=parsed_start_date,
                            end_date=end_date,
                            management_fee_amount = management_fee_amount,
                            is_monthly_auto_renew=is_auto_renew,
                            security_deposit_paid=self._parse_numeric(
                                contract_data.get("security_deposit_paid"), 0
                            ),
                        )
                    elif contract_type == "nanny_trial":
                        parsed_start_date = self._parse_date(
                            contract_data.get("start_date")
                        )

                        # --- 关键修复：增加日期校验 ---
                        if not parsed_start_date or not end_date:
                            current_app.logger.warning(
                                f"条目 {entry_serial_number} (试工合同) 因缺少有效的开始或结束日期而被跳过。"
                            )
                            error_count += 1 # 别忘了把错误计数加一
                            continue # 跳过当前循环，继续处理下一条
                        # --- 修复结束 ---

                        introduction_fee = self._parse_numeric(contract_data.get("introduction_fee"), 0)
                        new_contract = NannyTrialContract(
                            **common_data,
                            start_date=parsed_start_date,
                            actual_onboarding_date=parsed_start_date,
                            end_date=end_date,
                            introduction_fee = introduction_fee,
                        )

                    if new_contract:
                        db.session.add(new_contract)
                        db.session.flush()  # 第一次 flush, 获取 contract ID

                        # --- BEGIN: 我们新增的核心业务逻辑 ---
                        if isinstance(new_contract, MaternityNurseContract):
                            # 如果是月嫂合同，调用专属函数处理定金和介绍费
                            create_maternity_nurse_contract_adjustments(new_contract)
                        else:
                            # 对于其他合同（育儿嫂、试工），只处理介绍费
                            upsert_introduction_fee_adjustment(new_contract)

                        db.session.flush() # 第二次 flush, 保存上面创建的财务调整项
                        # --- END: 新增逻辑结束 ---

                        newly_synced_contract_ids.append(str(new_contract.id))
                        synced_count += 1

                        # --- Gemini Final Fix: Start ---
                        # 无论是育儿嫂合同还是试工合同，都需要调用账单引擎
                        if isinstance(new_contract, (NannyContract, NannyTrialContract)):
                            from .billing_engine import BillingEngine
                            engine = BillingEngine()

                            current_app.logger.info(f"为合同 {new_contract.id} 生成初始账单...")
                            # 【调试代码 1】
                            current_app.logger.info(f"[SYNC-DEBUG] Calling engine for contract ID: {new_contract.id}, Type: {type(new_contract.id)}")
                            engine.generate_all_bills_for_contract(new_contract.id, force_recalculate=True)
                            current_app.logger.info(f"合同 {new_contract.id} 的初始账单已生成。")

                            # 只有育儿嫂正式合同才需要检查自动续约
                            if isinstance(new_contract, NannyContract) and new_contract.is_monthly_auto_renew:
                                current_app.logger.info(f"为合同 {new_contract.id} 触发首次自动续签检查...")
                                engine.extend_auto_renew_bills(new_contract.id)
                                current_app.logger.info(f"合同 {new_contract.id} 的首次自动续签检查完成。")
                        # --- Gemini Final Fix: End ---

            except IntegrityError as e_integrity:
                error_count += 1
                db.session.rollback()
                current_app.logger.error(
                    f"处理条目 {entry.get('serial_number', 'N/A')} 时发生数据库完整性错误: {e_integrity.orig}",
                    exc_info=True,
                )
            except Exception as e:
                error_count += 1
                db.session.rollback()
                current_app.logger.error(
                    f"处理条目 {entry.get('serial_number', 'N/A')} 时发生未知错误: {e}",
                    exc_info=True,
                )

        # --- 关键修复：无论是否有错误，都提交已成功处理的记录 ---
        current_app.logger.info(f"准备提交 {synced_count} 条成功处理的合同...")
        db.session.commit()

        current_app.logger.info(
            f"表单 {form_token} 同步完成。成功处理 {synced_count} 条，跳过 {skipped_count} 条，失败 {error_count} 条。"
        )
        if error_count > 0:
            current_app.logger.warning(
                f"有 {error_count} 条记录因数据不完整等原因处理失败，详情请查看上面的日志。"
            )
        # --- 修复结束 ---
        return synced_count, skipped_count, newly_synced_contract_ids
