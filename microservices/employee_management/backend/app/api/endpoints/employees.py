from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app import db, schemas
from app.services import employee_service
from app.api.dependencies import get_current_user

router = APIRouter()

@router.post("/", response_model=schemas.employee.Employee, status_code=status.HTTP_201_CREATED)
def create_employee(
    *,
    db_session: Session = Depends(db.get_db),
    employee_in: schemas.employee.EmployeeCreate,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Create new employee.
    """
    return employee_service.create_employee(db_session, employee_in=employee_in)

@router.get("/", response_model=List[schemas.employee.Employee])
def read_employees(
    db_session: Session = Depends(db.get_db),
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Retrieve employees.
    """
    return employee_service.get_employees(db_session, skip=skip, limit=limit, search=search)

@router.get("/{employee_id}", response_model=schemas.employee.EmployeeWithHistory)
def read_employee(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Get employee by ID including salary history.
    """
    employee = employee_service.get_employee(db_session, employee_id=employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    
    # Sort history by effective date descending
    employee.salary_history.sort(key=lambda x: x.effective_date, reverse=True)
    return employee

@router.put("/{employee_id}", response_model=schemas.employee.Employee)
def update_employee(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    employee_in: schemas.employee.EmployeeUpdate,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Update an employee.
    """
    db_employee = employee_service.get_employee(db_session, employee_id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee_service.update_employee(db_session, db_employee=db_employee, employee_in=employee_in)

@router.delete("/{employee_id}", response_model=schemas.employee.Employee)
def delete_employee(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Delete an employee.
    """
    db_employee = employee_service.get_employee(db_session, employee_id=employee_id)
    if not db_employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee_service.delete_employee(db_session, employee_id=employee_id)
