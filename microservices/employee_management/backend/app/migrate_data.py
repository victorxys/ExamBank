import uuid
from sqlalchemy import create_engine, MetaData, Table, select
from sqlalchemy.orm import sessionmaker
from app.models.employee import Employee, EmployeeSalaryHistory
from app.db import engine as micro_engine

# Legacy DB URL
LEGACY_DB_URL = "postgresql://postgres:xys131313@localhost:5432/ExamDB"

# Setup legacy engine and session
legacy_engine = create_engine(LEGACY_DB_URL)
LegacySession = sessionmaker(bind=legacy_engine)
legacy_session = LegacySession()

# Setup microservice session
MicroSession = sessionmaker(bind=micro_engine)
micro_session = MicroSession()

def migrate():
    # Reflect legacy tables
    metadata = MetaData()
    legacy_personnel = Table('service_personnel', metadata, autoload_with=legacy_engine)
    legacy_salary = Table('employee_salary_history', metadata, autoload_with=legacy_engine)
    
    print("Migrating employees...")
    stmt = select(legacy_personnel)
    personnel_results = legacy_session.execute(stmt).all()
    for row in personnel_results:
        existing = micro_session.query(Employee).filter(Employee.id == row.id).first()
        if not existing:
            micro_session.add(Employee(
                id=row.id, name=row.name, name_pinyin=row.name_pinyin,
                phone_number=row.phone_number, id_card_number=row.id_card_number,
                address=row.address, is_active=row.is_active,
                created_at=row.created_at, updated_at=row.updated_at
            ))

    print("Migrating salary history...")
    stmt = select(legacy_salary)
    salary_results = legacy_session.execute(stmt).all()
    count = 0
    for row in salary_results:
        existing = micro_session.query(EmployeeSalaryHistory).filter(EmployeeSalaryHistory.id == row.id).first()
        if not existing:
            micro_session.add(EmployeeSalaryHistory(
                id=row.id, employee_id=row.employee_id, contract_id=row.contract_id,
                effective_date=row.effective_date, base_salary=row.base_salary,
                commission_rate=row.commission_rate, bonus=row.bonus,
                notes=row.notes, created_at=row.created_at, updated_at=row.updated_at
            ))
            count += 1
    
    micro_session.commit()
    print(f"Migration completed. {count} salary records migrated.")

if __name__ == "__main__":
    try:
        migrate()
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        legacy_session.close()
        micro_session.close()
