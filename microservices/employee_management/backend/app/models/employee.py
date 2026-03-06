import uuid
from sqlalchemy import Column, String, Boolean, DateTime, Text, func, ForeignKey, Numeric
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship
from app.db import Base

class Employee(Base):
    __tablename__ = "employees"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False, index=True)
    name_pinyin = Column(String(255), index=True)
    phone_number = Column(String(50), nullable=True, unique=True)
    id_card_number = Column(String(100), nullable=True, unique=True)
    address = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    salary_history = relationship("EmployeeSalaryHistory", back_populates="employee", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Employee {self.name}>"

class EmployeeSalaryHistory(Base):
    __tablename__ = "employee_salary_history"

    id = Column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id = Column(PG_UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    contract_id = Column(PG_UUID(as_uuid=True), nullable=False) # No FK to other DB
    effective_date = Column(DateTime, nullable=False)
    base_salary = Column(Numeric(10, 2), nullable=False)
    commission_rate = Column(Numeric(5, 4), nullable=True)
    bonus = Column(Numeric(10, 2), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    employee = relationship("Employee", back_populates="salary_history")
