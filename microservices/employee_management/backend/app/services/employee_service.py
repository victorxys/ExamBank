from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.models.employee import Employee
from app.schemas.employee import EmployeeCreate, EmployeeUpdate

def get_employee(db: Session, employee_id: UUID) -> Optional[Employee]:
    return db.query(Employee).filter(Employee.id == employee_id).first()

def get_employees(
    db: Session, skip: int = 0, limit: int = 100, search: Optional[str] = None
) -> List[Employee]:
    query = db.query(Employee)
    if search:
        query = query.filter(
            or_(
                Employee.name.ilike(f"%{search}%"),
                Employee.name_pinyin.ilike(f"%{search}%"),
                Employee.phone_number.ilike(f"%{search}%")
            )
        )
    return query.offset(skip).limit(limit).all()

def create_employee(db: Session, employee_in: EmployeeCreate) -> Employee:
    db_employee = Employee(
        name=employee_in.name,
        name_pinyin=employee_in.name_pinyin,
        phone_number=employee_in.phone_number,
        id_card_number=employee_in.id_card_number,
        address=employee_in.address,
        is_active=employee_in.is_active,
    )
    db.add(db_employee)
    db.commit()
    db.refresh(db_employee)
    return db_employee

def update_employee(
    db: Session, db_employee: Employee, employee_in: EmployeeUpdate
) -> Employee:
    update_data = employee_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_employee, field, value)
    db.add(db_employee)
    db.commit()
    db.refresh(db_employee)
    return db_employee

def delete_employee(db: Session, employee_id: UUID) -> Optional[Employee]:
    db_employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if db_employee:
        db.delete(db_employee)
        db.commit()
    return db_employee
