"""implement payout record and status for employee payroll

Revision ID: 769f98bd8301
Revises: 7421d77df6d9
Create Date: 2025-08-19 12:16:21.033810

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import table, column
import uuid
from datetime import datetime

# revision identifiers, used by Alembic.
revision = '769f98bd8301'
down_revision = '7421d77df6d9'
branch_labels = None
depends_on = None


def upgrade():
    # ### 模式迁移 ###

    # 1. 创建 payout_records 表
    op.create_table('payout_records',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('employee_payroll_id', sa.UUID(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False, comment='本次支付金额'),
        sa.Column('payout_date', sa.Date(), nullable=False, comment='支付日期'),
        sa.Column('method', sa.String(length=100), nullable=True, comment='支付方式'),
        sa.Column('notes', sa.Text(), nullable=True, comment='备注'),
        sa.Column('created_by_user_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['user.id'], ),
        sa.ForeignKeyConstraint(['employee_payroll_id'], ['employee_payrolls.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        comment='针对员工薪酬单的支付记录表'
    )
    with op.batch_alter_table('payout_records', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_payout_records_employee_payroll_id'), ['employee_payroll_id'], unique=False)

    # 2. 显式创建 ENUM 类型
    payout_status_enum = sa.Enum('UNPAID', 'PARTIALLY_PAID', 'PAID', name='payoutstatus')
    payout_status_enum.create(op.get_bind(), checkfirst=False)

    # 3. 修改 employee_payrolls 表
    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('total_due', sa.Numeric(precision=10, scale=2), server_default='0', nullable=False, comment='员工总应发金额'))
        batch_op.add_column(sa.Column('payout_status', payout_status_enum, nullable=True)) # 允许为空
        batch_op.add_column(sa.Column('total_paid_out', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False,comment='已支付总额'))
        batch_op.create_index(batch_op.f('ix_employee_payrolls_payout_status'), ['payout_status'], unique=False)

    # ### 数据迁移 ###
    bind = op.get_bind()
    session = sa.orm.Session(bind=bind)

    user_table = sa.Table('user', sa.MetaData(), sa.Column('id', sa.UUID), sa.Column('role', sa.String))
    employee_payrolls_table_v1 = sa.Table('employee_payrolls', sa.MetaData(),
        sa.Column('id', sa.UUID),
        sa.Column('final_payout', sa.Numeric(10, 2)),
        sa.Column('is_paid', sa.Boolean)
    )
    payout_records_table = sa.Table('payout_records', sa.MetaData(),
        sa.Column('id', sa.UUID), sa.Column('employee_payroll_id', sa.UUID),
        sa.Column('amount', sa.Numeric(12, 2)), sa.Column('payout_date', sa.Date),
        sa.Column('notes', sa.Text), sa.Column('created_by_user_id', sa.UUID),
        sa.Column('created_at', sa.DateTime(timezone=True))
    )

    try:
        admin_user_id_result = session.execute(sa.select(user_table.c.id).where(user_table.c.role == 'admin').limit(1)).scalar_one_or_none()
        if not admin_user_id_result:
            admin_user_id_result = session.execute(sa.select(user_table.c.id).limit(1)).scalar_one()
        admin_user_id = admin_user_id_result

        payrolls_to_migrate = session.execute(sa.select(employee_payrolls_table_v1.c.id,employee_payrolls_table_v1.c.final_payout, employee_payrolls_table_v1.c.is_paid)).fetchall()

        payouts_to_insert = []
        for payroll_id, final_payout, is_paid in payrolls_to_migrate:
            final_payout = final_payout or 0
            if is_paid:
                op.execute(
                    sa.update(sa.table('employee_payrolls', sa.column('id'), sa.column('payout_status'), sa.column('total_due'),sa.column('total_paid_out')))
                    .where(sa.column('id') == payroll_id)
                    .values(payout_status='PAID', total_paid_out=final_payout, total_due=final_payout)
                )
                payouts_to_insert.append({
                    'id': uuid.uuid4(), 'employee_payroll_id': payroll_id, 'amount': final_payout,
                    'payout_date': datetime.utcnow().date(), 'notes': '系统迁移前已支付的历史记录',
                    'created_by_user_id': admin_user_id, 'created_at': datetime.utcnow()
                })
            else:
                op.execute(
                    sa.update(sa.table('employee_payrolls', sa.column('id'), sa.column('total_due'), sa.column('payout_status')))
                    .where(sa.column('id') == payroll_id)
                    .values(total_due=final_payout, payout_status='UNPAID')
                )

        if payouts_to_insert:
            op.bulk_insert(payout_records_table, payouts_to_insert)

        session.commit()
    except Exception as e:
        session.rollback()
        raise e

    # ### 模式迁移（收尾） ###
    # 【最终修复】移除 server_default
    op.alter_column('employee_payrolls', 'payout_status',
               existing_type=payout_status_enum,
               nullable=False)

    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.drop_column('final_payout')
        batch_op.drop_column('is_paid')

    # 其他无关的修改保持不变
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.create_foreign_key('fk_exampapercourse_exam_paper_id_3', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('fk_exampapercourse_course_id_3', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')


def downgrade():
    # Downgrade 逻辑
    with op.batch_alter_table('employee_payrolls', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_paid', sa.BOOLEAN(), autoincrement=False, nullable=False))
        batch_op.add_column(sa.Column('final_payout', sa.NUMERIC(precision=10, scale=2), autoincrement=False, nullable=False))
        batch_op.drop_index(batch_op.f('ix_employee_payrolls_payout_status'))
        batch_op.drop_column('total_paid_out')
        batch_op.drop_column('payout_status')
        batch_op.drop_column('total_due')

    with op.batch_alter_table('payout_records', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_payout_records_employee_payroll_id'))

    op.drop_table('payout_records')
    sa.Enum(name='payoutstatus').drop(op.get_bind(), checkfirst=False)

    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.drop_constraint(None, type_='foreignkey')
        batch_op.create_foreign_key('exampapercourse_course_id_fkey', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('fk_exampapercourse_exam_paper_id', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')


    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.alter_column('payment_details',
               existing_type=postgresql.JSONB(astext_type=sa.Text()),
               comment='打款日期/渠道/总额/打款人等信息',
               existing_comment='[V1遗留] 打款日期/渠道/总额/打款人等信息',
               existing_nullable=False,
               existing_server_default=sa.text("'{}'::jsonb"))


    # ### end Alembic commands ###
