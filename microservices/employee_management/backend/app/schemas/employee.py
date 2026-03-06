from datetime import datetime, date
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, ConfigDict
from decimal import Decimal

class SalaryHistoryBase(BaseModel):
    employee_id: UUID
    contract_id: UUID
    effective_date: date
    base_salary: Decimal
    commission_rate: Optional[Decimal] = None
    bonus: Optional[Decimal] = None
    notes: Optional[str] = None

class SalaryHistoryCreate(SalaryHistoryBase):
    pass

class SalaryHistory(SalaryHistoryBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class EmployeeBase(BaseModel):
    name: str
    name_pinyin: Optional[str] = None
    phone_number: Optional[str] = None
    id_card_number: Optional[str] = None
    address: Optional[str] = None
    is_active: bool = True

class EmployeeCreate(EmployeeBase):
    pass

class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    name_pinyin: Optional[str] = None
    phone_number: Optional[str] = None
    id_card_number: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None

class EmployeeInDBBase(EmployeeBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class Employee(EmployeeInDBBase):
    pass

class EmployeeWithHistory(Employee):
    salary_history: List[SalaryHistory] = []
