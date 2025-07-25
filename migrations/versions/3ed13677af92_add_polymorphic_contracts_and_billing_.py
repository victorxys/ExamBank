"""Add polymorphic contracts and billing system models

Revision ID: 3ed13677af92
Revises: 4326b1f8c4a8
Create Date: 2025-07-09 11:45:06.880109

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '3ed13677af92'
down_revision = '4326b1f8c4a8'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('service_personnel',
    sa.Column('id', sa.UUID(), nullable=False, comment='主键, UUID'),
    sa.Column('name', sa.String(length=255), nullable=False, comment='服务人员姓名'),
    sa.Column('name_pinyin', sa.String(length=255), nullable=True, comment='姓名拼音，用于模糊搜索'),
    sa.Column('phone_number', sa.String(length=50), nullable=True, comment='手机号, 可选但唯一'),
    sa.Column('id_card_number', sa.String(length=100), nullable=True, comment='身份证号, 可选'),
    sa.Column('is_active', sa.Boolean(), nullable=False, comment='是否在职'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('phone_number'),
    comment='服务人员表(月嫂/育儿嫂等非系统登录用户)'
    )
    op.create_index(op.f('ix_service_personnel_name'), 'service_personnel', ['name'], unique=False)
    op.create_index(op.f('ix_service_personnel_name_pinyin'), 'service_personnel', ['name_pinyin'], unique=False)
    op.create_table('contracts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('type', sa.String(length=50), nullable=False, comment='合同类型鉴别器 (nanny, maternity_nurse)'),
    sa.Column('customer_name', sa.String(length=255), nullable=False),
    sa.Column('contact_person', sa.String(length=255), nullable=True, comment='客户联系人'),
    sa.Column('employee_id', sa.UUID(), nullable=False),
    sa.Column('employee_level', sa.String(length=100), nullable=True, comment='级别，通常是月薪或服务价格'),
    sa.Column('status', sa.String(length=50), nullable=False, comment='active, finished, terminated'),
    sa.Column('notes', sa.Text(), nullable=True, comment='通用备注'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('end_date', sa.Date(), nullable=True),
    sa.Column('is_monthly_auto_renew', sa.Boolean(), nullable=True),
    sa.Column('management_fee_paid_months', postgresql.ARRAY(sa.String()), nullable=True, comment='已缴管理费的月份列表 (e.g., ["2024-06"])'),
    sa.Column('is_first_month_fee_paid', sa.Boolean(), nullable=True, comment='是否已缴首月10%上户费'),
    sa.Column('provisional_start_date', sa.Date(), nullable=True, comment='预产期'),
    sa.Column('actual_onboarding_date', sa.Date(), nullable=True, comment='实际上户日期'),
    sa.Column('deposit_amount', sa.Numeric(precision=10, scale=2), nullable=True, comment='定金'),
    sa.Column('security_deposit_paid', sa.Numeric(precision=10, scale=2), nullable=True, comment='客交保证金'),
    sa.Column('management_fee_rate', sa.Numeric(precision=4, scale=2), nullable=True, comment='管理费率, 0.15或0.25'),
    sa.Column('discount_amount', sa.Numeric(precision=10, scale=2), nullable=True, comment='优惠金额'),
    sa.ForeignKeyConstraint(['employee_id'], ['service_personnel.id'], ),
    sa.PrimaryKeyConstraint('id'),
    comment='合同基础信息表'
    )
    op.create_index(op.f('ix_contracts_customer_name'), 'contracts', ['customer_name'], unique=False)
    op.create_index(op.f('ix_contracts_employee_id'), 'contracts', ['employee_id'], unique=False)
    op.create_index(op.f('ix_contracts_status'), 'contracts', ['status'], unique=False)
    op.create_index(op.f('ix_contracts_type'), 'contracts', ['type'], unique=False)
    op.create_table('customer_bills',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('contract_id', sa.UUID(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('customer_name', sa.String(length=255), nullable=False),
    sa.Column('total_payable', sa.Numeric(precision=12, scale=2), nullable=False, comment='客户总应付款'),
    sa.Column('is_paid', sa.Boolean(), nullable=True, comment='是否已打款'),
    sa.Column('payment_details', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='打款日期/渠道/总额/打款人等信息'),
    sa.Column('calculation_details', postgresql.JSONB(astext_type=sa.Text()), nullable=False, comment='计算过程快照，用于展示和审计'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['contract_id'], ['contracts.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('contract_id', 'year', 'month', name='uq_bill_contract_month')
    )
    op.create_index(op.f('ix_customer_bills_contract_id'), 'customer_bills', ['contract_id'], unique=False)
    op.create_index(op.f('ix_customer_bills_customer_name'), 'customer_bills', ['customer_name'], unique=False)
    op.create_index(op.f('ix_customer_bills_is_paid'), 'customer_bills', ['is_paid'], unique=False)
    op.create_index(op.f('ix_customer_bills_month'), 'customer_bills', ['month'], unique=False)
    op.create_index(op.f('ix_customer_bills_year'), 'customer_bills', ['year'], unique=False)
    op.create_table('employee_payrolls',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('contract_id', sa.UUID(), nullable=False),
    sa.Column('year', sa.Integer(), nullable=False),
    sa.Column('month', sa.Integer(), nullable=False),
    sa.Column('employee_id', sa.UUID(), nullable=False),
    sa.Column('final_payout', sa.Numeric(precision=12, scale=2), nullable=False, comment='员工最终应领款'),
    sa.Column('is_paid', sa.Boolean(), nullable=True, comment='是否已领款'),
    sa.Column('payout_details', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='领款人/时间/途径等信息'),
    sa.Column('calculation_details', postgresql.JSONB(astext_type=sa.Text()), nullable=False, comment='计算过程快照'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['contract_id'], ['contracts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['employee_id'], ['service_personnel.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('contract_id', 'year', 'month', name='uq_payroll_contract_month')
    )
    op.create_index(op.f('ix_employee_payrolls_contract_id'), 'employee_payrolls', ['contract_id'], unique=False)
    op.create_index(op.f('ix_employee_payrolls_employee_id'), 'employee_payrolls', ['employee_id'], unique=False)
    op.create_index(op.f('ix_employee_payrolls_is_paid'), 'employee_payrolls', ['is_paid'], unique=False)
    op.create_index(op.f('ix_employee_payrolls_month'), 'employee_payrolls', ['month'], unique=False)
    op.create_index(op.f('ix_employee_payrolls_year'), 'employee_payrolls', ['year'], unique=False)
    op.create_table('invoice_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('contract_id', sa.UUID(), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False, comment='发票金额'),
    sa.Column('issue_date', sa.Date(), nullable=False, comment='开票日期'),
    sa.Column('status', sa.String(length=50), nullable=False, comment='状态 (pending, issued)'),
    sa.Column('notes', sa.Text(), nullable=True, comment='发票备注'),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['contract_id'], ['contracts.id'], ),
    sa.PrimaryKeyConstraint('id'),
    comment='发票记录表'
    )
    op.create_index(op.f('ix_invoice_records_contract_id'), 'invoice_records', ['contract_id'], unique=False)
    op.create_table('financial_adjustments',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('adjustment_type', sa.Enum('CUSTOMER_INCREASE', 'CUSTOMER_DECREASE', 'EMPLOYEE_INCREASE', 'EMPLOYEE_DECREASE', name='adjustmenttype'), nullable=False),
    sa.Column('amount', sa.Numeric(precision=10, scale=2), nullable=False, comment='调整金额'),
    sa.Column('description', sa.String(length=500), nullable=False, comment='款项说明/原因'),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('customer_bill_id', sa.UUID(), nullable=True),
    sa.Column('employee_payroll_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    sa.ForeignKeyConstraint(['customer_bill_id'], ['customer_bills.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['employee_payroll_id'], ['employee_payrolls.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    comment='财务调整项(增/减款)'
    )
    op.create_index(op.f('ix_financial_adjustments_adjustment_type'), 'financial_adjustments', ['adjustment_type'], unique=False)
    op.create_index(op.f('ix_financial_adjustments_customer_bill_id'), 'financial_adjustments', ['customer_bill_id'], unique=False)
    op.create_index(op.f('ix_financial_adjustments_date'), 'financial_adjustments', ['date'], unique=False)
    op.create_index(op.f('ix_financial_adjustments_employee_payroll_id'), 'financial_adjustments', ['employee_payroll_id'], unique=False)
    op.drop_constraint('exampapercourse_exam_paper_id_fkey', 'exampapercourse', type_='foreignkey')
    op.drop_constraint('exampapercourse_course_id_fkey', 'exampapercourse', type_='foreignkey')
    op.create_foreign_key(None, 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.create_foreign_key(None, 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], source_schema='public', ondelete='CASCADE')
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.create_foreign_key('exampapercourse_course_id_fkey', 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
    op.drop_index(op.f('ix_financial_adjustments_employee_payroll_id'), table_name='financial_adjustments')
    op.drop_index(op.f('ix_financial_adjustments_date'), table_name='financial_adjustments')
    op.drop_index(op.f('ix_financial_adjustments_customer_bill_id'), table_name='financial_adjustments')
    op.drop_index(op.f('ix_financial_adjustments_adjustment_type'), table_name='financial_adjustments')
    op.drop_table('financial_adjustments')
    op.drop_index(op.f('ix_invoice_records_contract_id'), table_name='invoice_records')
    op.drop_table('invoice_records')
    op.drop_index(op.f('ix_employee_payrolls_year'), table_name='employee_payrolls')
    op.drop_index(op.f('ix_employee_payrolls_month'), table_name='employee_payrolls')
    op.drop_index(op.f('ix_employee_payrolls_is_paid'), table_name='employee_payrolls')
    op.drop_index(op.f('ix_employee_payrolls_employee_id'), table_name='employee_payrolls')
    op.drop_index(op.f('ix_employee_payrolls_contract_id'), table_name='employee_payrolls')
    op.drop_table('employee_payrolls')
    op.drop_index(op.f('ix_customer_bills_year'), table_name='customer_bills')
    op.drop_index(op.f('ix_customer_bills_month'), table_name='customer_bills')
    op.drop_index(op.f('ix_customer_bills_is_paid'), table_name='customer_bills')
    op.drop_index(op.f('ix_customer_bills_customer_name'), table_name='customer_bills')
    op.drop_index(op.f('ix_customer_bills_contract_id'), table_name='customer_bills')
    op.drop_table('customer_bills')
    op.drop_index(op.f('ix_contracts_type'), table_name='contracts')
    op.drop_index(op.f('ix_contracts_status'), table_name='contracts')
    op.drop_index(op.f('ix_contracts_employee_id'), table_name='contracts')
    op.drop_index(op.f('ix_contracts_customer_name'), table_name='contracts')
    op.drop_table('contracts')
    op.drop_index(op.f('ix_service_personnel_name_pinyin'), table_name='service_personnel')
    op.drop_index(op.f('ix_service_personnel_name'), table_name='service_personnel')
    op.drop_table('service_personnel')
    # ### end Alembic commands ###
