# backend/services/data_sync_service.py (健壮化人员查找与错误处理)

import httpx
import time
from flask import current_app
from datetime import datetime
from pypinyin import pinyin, Style
import decimal
from sqlalchemy.exc import IntegrityError
from datetime import date

from backend.models import db, User, BaseContract, NannyContract, MaternityNurseContract, ServicePersonnel
from backend.security_utils import decrypt_data
from backend.models import LlmApiKey

class JinshujuAPIError(Exception):
    pass

class DataSyncService:
    BASE_URL = "https://jinshuju.net/api/v1"

    # _load_credentials, get_form_entries, _parse_numeric, _parse_date 函数保持不变
    def __init__(self): # 完整函数体
        self.api_key, self.api_secret = None, None
        self._load_credentials()
    def _load_credentials(self): # 完整函数体
        api_key_record = LlmApiKey.query.filter_by(key_name="Jinshuju-Main-API", status='active').first()
        if not api_key_record: raise JinshujuAPIError("未找到名为 'Jinshuju-Main-API' 的活动API Key记录。")
        self.api_key = decrypt_data(api_key_record.api_key_encrypted)
        self.api_secret = api_key_record.notes 
        if not self.api_key or not self.api_secret: raise JinshujuAPIError("API Key 或 Secret 为空。")
    def get_form_entries(self, form_token: str): # 完整函数体
        path, all_entries, next_cursor, auth = f"/forms/{form_token}/entries", [], None, (self.api_key, self.api_secret)
        while True:
            params = {'next': next_cursor} if next_cursor else {}
            try:
                with httpx.Client(auth=auth, timeout=30.0) as client:
                    response = client.get(f"{self.BASE_URL}{path}", params=params)
                    response.raise_for_status()
                data = response.json()
                entries_this_page = data.get('data', [])
                if not isinstance(entries_this_page, list): break
                if not entries_this_page: break
                all_entries.extend(entries_this_page)
                next_cursor = data.get('next')
                if not next_cursor: break
                time.sleep(1)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401: raise JinshujuAPIError("金数据认证失败 (401)。请检查API凭证。") from e
                raise JinshujuAPIError(f"API请求错误: {e.response.text}") from e
            except Exception as e: raise JinshujuAPIError(f"未知错误: {e}") from e
        return all_entries
    def _parse_numeric(self, value, default=0): # 完整函数体
        if value is None or value == '': return decimal.Decimal(default)
        try: return decimal.Decimal(value)
        except (decimal.InvalidOperation, TypeError): return decimal.Decimal(default)
    def _parse_date(self, date_string): # 完整函数体
        if not date_string: return None
        try: return datetime.strptime(date_string, '%Y-%m-%d').date()
        except (ValueError, TypeError): return None
    # --- 以上函数保持不变 ---

    def _get_or_create_personnel_ref(self, name: str, phone: str = None):
        """
        健壮的人员查找/创建逻辑，返回一个包含类型和ID的元组。
        查找顺序: User by phone -> User by name -> ServicePersonnel by phone -> ServicePersonnel by name -> Create new ServicePersonnel.
        """
        if not name or not name.strip():
            return None, None # 返回 (None, None) 表示人员信息缺失

        name = name.strip()
        phone = phone.strip() if phone else None
        
        # 1. 在 User 表中查找
        if phone:
            user = User.query.filter_by(phone_number=phone).first()
            if user: return 'user', user.id
        user = User.query.filter(db.func.lower(User.username) == name.lower()).first()
        if user: return 'user', user.id

        # 2. 在 ServicePersonnel 表中查找
        if phone:
            personnel = ServicePersonnel.query.filter_by(phone_number=phone).first()
            if personnel: return 'service_personnel', personnel.id
        personnel = ServicePersonnel.query.filter(db.func.lower(ServicePersonnel.name) == name.lower()).first()
        if personnel: return 'service_personnel', personnel.id

        # 3. 创建新的 ServicePersonnel
        try:
            pinyin_str = "".join(p[0] for p in pinyin(name, style=Style.NORMAL)) + " " + "".join(p[0] for p in pinyin(name, style=Style.FIRST_LETTER))
        except Exception: pinyin_str = None
            
        new_personnel = ServicePersonnel(name=name, phone_number=phone, name_pinyin=pinyin_str)
        db.session.add(new_personnel)
        db.session.flush() # 必须 flush 来获取 ID
        current_app.logger.info(f"创建了新的外部服务人员记录: {name} (ID: {new_personnel.id})")
        return 'service_personnel', new_personnel.id

    def sync_contracts_from_form(self, form_token: str, contract_type: str, mapping_rules: dict):
        current_app.logger.info(f"开始同步表单 {form_token} ({contract_type}) 的合同数据...")
        entries = self.get_form_entries(form_token)
        synced_count, skipped_count, error_count = 0, 0, 0
        for entry in entries:
            try:
                with db.session.begin_nested():
                    entry_serial_number = entry.get('serial_number')
                    if not entry_serial_number: skipped_count += 1; continue
                    if BaseContract.query.filter_by(jinshuju_entry_id=str(entry_serial_number)).first(): skipped_count += 1; continue

                    contract_data = {} # ... (数据解析逻辑保持不变)
                    for db_field, jinshuju_config in mapping_rules.items():
                        jinshuju_field_id = jinshuju_config['field_id']
                        value = None
                        if jinshuju_config.get('is_association'):
                            associated_field_id = jinshuju_config['associated_field_id']
                            key_to_lookup = f"{jinshuju_field_id}_associated_{associated_field_id}"
                            value = entry.get(key_to_lookup)
                        else: value = entry.get(jinshuju_field_id)
                        if isinstance(value, dict):
                            if all(k in value for k in ['province', 'city', 'district', 'street']):
                                value = f"{value.get('province','')}{value.get('city','')}{value.get('district','')}{value.get('street','')}"
                            else: value = value.get('value')
                        contract_data[db_field] = str(value) if value is not None else None

                    employee_name = contract_data.get('employee_name')
                    employee_phone = contract_data.get('employee_phone')
                    
                    # --- 核心修正：调用新的查找函数并处理返回结果 ---
                    personnel_type, personnel_id = self._get_or_create_personnel_ref(employee_name, employee_phone)
                    
                    if not personnel_id:
                        error_count += 1
                        current_app.logger.warning(f"条目 {entry_serial_number} 因员工信息(姓名/电话)缺失或查找失败而被跳过。")
                        continue

                    customer_name_from_data = contract_data.get('customer_name')
                    customer_name_final = str(customer_name_from_data).strip() if customer_name_from_data and str(customer_name_from_data).strip() else f"客户(SN:{entry_serial_number})"
                    

                    # 动态设置合同状态，只有结束日期在未来时才是 '执行中'
                    end_date = self._parse_date(contract_data.get('end_date'))
                    if end_date and end_date > date.today():
                        contract_status = 'active'  # 在您的資料表中是 'active'
                    else:
                        contract_status = 'finished'  # 在您的資料表中是 'finished'
                    common_data = {
                        'type': contract_type, 'customer_name': customer_name_final,
                        'employee_level': str(self._parse_numeric(contract_data.get('employee_level'), 0)),
                        'status': contract_status, 'jinshuju_entry_id': str(entry_serial_number),
                    }
                    
                    # 根据 personnel_type 填充正确的 ID 字段
                    if personnel_type == 'user':
                        common_data['user_id'] = personnel_id
                    else: # 'service_personnel'
                        common_data['service_personnel_id'] = personnel_id
                    # ---------------------------------------------
                    
                    if contract_type == 'maternity_nurse':
                        new_contract = MaternityNurseContract(
                            **common_data,
                            provisional_start_date=self._parse_date(contract_data.get('provisional_start_date')),
                            start_date=self._parse_date(contract_data.get('provisional_start_date')),
                            end_date=self._parse_date(contract_data.get('end_date')),
                            deposit_amount=self._parse_numeric(contract_data.get('deposit_amount'), 0),
                            security_deposit_paid=self._parse_numeric(contract_data.get('security_deposit_paid'), 0),
                            management_fee_amount=self._parse_numeric(contract_data.get('management_fee_amount'), 0),
                            management_fee_rate=self._parse_numeric(contract_data.get('management_fee_rate'), 0.25), # 假设默认25%
                            discount_amount=self._parse_numeric(contract_data.get('discount_amount'), 0)
                        )
                    else: continue
                    
                    db.session.add(new_contract)
                    synced_count += 1
            
            except IntegrityError as e_integrity:
                error_count += 1
                current_app.logger.error(f"处理条目 {entry.get('serial_number', 'N/A')} 时发生数据库完整性错误: {e_integrity.orig}")
            except Exception as e:
                error_count += 1
                current_app.logger.error(f"处理条目 {entry.get('serial_number', 'N/A')} 时发生未知错误: {e}", exc_info=True)
        
        if error_count == 0: db.session.commit()
        else: db.session.rollback()

        current_app.logger.info(f"表单 {form_token} 同步完成。成功处理 {synced_count} 条，跳过 {skipped_count} 条，失败 {error_count} 条。")
        return synced_count, skipped_count