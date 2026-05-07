from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app import db, schemas
from app.services import employee_service
from app.api.dependencies import get_current_user
from app.clients.contract_client import ContractServiceUnavailable, contract_client

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

@router.get("/lookup", response_model=List[schemas.employee.Employee])
def lookup_employees(
    db_session: Session = Depends(db.get_db),
    search: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Lightweight employee lookup for integrated systems such as contract
    management. Supports name, pinyin, and phone number search.
    """
    return employee_service.get_employees(db_session, skip=0, limit=limit, search=search)

@router.get("/{employee_id}/contracts")
async def read_employee_contracts(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Retrieve contracts related to this employee from the Contract Management
    System. This is an optional integration and does not read contract tables
    directly.
    """
    employee = employee_service.get_employee(db_session, employee_id=employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    try:
        return await contract_client.get_contracts_by_employee(
            employee_id=employee_id,
            employee_name=employee.name,
            employee_phone=employee.phone_number,
            access_token=current_user.get("access_token"),
        )
    except ContractServiceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

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

@router.post(
    "/{employee_id}/salary-history",
    response_model=schemas.employee.SalaryHistory,
    status_code=status.HTTP_201_CREATED,
)
def create_employee_salary_history(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    salary_in: schemas.employee.SalaryHistoryCreate,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Create a salary history record for an employee.
    """
    employee = employee_service.get_employee(db_session, employee_id=employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    return employee_service.create_salary_history(
        db_session,
        employee_id=employee_id,
        salary_in=salary_in,
    )

@router.put(
    "/{employee_id}/salary-history/{salary_history_id}",
    response_model=schemas.employee.SalaryHistory,
)
def update_employee_salary_history(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    salary_history_id: UUID,
    salary_in: schemas.employee.SalaryHistoryUpdate,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Update a salary history record for an employee.
    """
    db_salary = employee_service.get_salary_history(
        db_session,
        employee_id=employee_id,
        salary_history_id=salary_history_id,
    )
    if not db_salary:
        raise HTTPException(status_code=404, detail="Salary history not found")
    return employee_service.update_salary_history(
        db_session,
        db_salary=db_salary,
        salary_in=salary_in,
    )

@router.delete(
    "/{employee_id}/salary-history/{salary_history_id}",
    response_model=schemas.employee.SalaryHistory,
)
def delete_employee_salary_history(
    *,
    db_session: Session = Depends(db.get_db),
    employee_id: UUID,
    salary_history_id: UUID,
    current_user: dict = Depends(get_current_user),
) -> Any:
    """
    Delete a salary history record for an employee.
    """
    db_salary = employee_service.get_salary_history(
        db_session,
        employee_id=employee_id,
        salary_history_id=salary_history_id,
    )
    if not db_salary:
        raise HTTPException(status_code=404, detail="Salary history not found")
    return employee_service.delete_salary_history(db_session, db_salary=db_salary)

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
