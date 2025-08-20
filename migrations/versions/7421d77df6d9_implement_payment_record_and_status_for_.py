"""implement payment record and status for v2 design

Revision ID: 7421d77df6d9
Revises: 7789538d82d4
Create Date: 2025-08-18 16:33:44.471409

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import table, column
import uuid
from datetime import datetime

# revision identifiers, used by Alembic.
revision = '7421d77df6d9'
down_revision = '7789538d82d4'
branch_labels = None
depends_on = None


def upgrade():
    # ### 模式迁移 ###

    payment_status_enum = sa.Enum('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID', name='paymentstatus')
    payment_status_enum.create(op.get_bind(), checkfirst=False)

    op.create_table('payment_records',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('customer_bill_id', sa.UUID(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False, comment='本次支付金额'),
        sa.Column('payment_date', sa.Date(), nullable=False, comment='支付日期'),
        sa.Column('method', sa.String(length=100), nullable=True, comment='支付方式'),
        sa.Column('notes', sa.Text(), nullable=True, comment='备注'),
        sa.Column('image_url', sa.String(length=512), nullable=True, comment='支付凭证图片URL'),
        sa.Column('created_by_user_id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['user.id'], ),
        sa.ForeignKeyConstraint(['customer_bill_id'], ['customer_bills.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        comment='针对客户账单的支付记录表'
    )
    with op.batch_alter_table('payment_records', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_payment_records_customer_bill_id'), ['customer_bill_id'], unique=False)

    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.add_column(sa.Column('payment_status', payment_status_enum, nullable=True))
        batch_op.add_column(sa.Column('total_due', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False, comment='总应付金额 (由BillingEngine计算)'))
        batch_op.add_column(sa.Column('total_paid', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False,comment='已支付总额 (根据PaymentRecord实时更新)'))
        batch_op.create_index(batch_op.f('ix_customer_bills_payment_status'), ['payment_status'], unique=False)

    # ### 数据迁移 ###
    bind = op.get_bind()
    session = sa.orm.Session(bind=bind)

    user_table = sa.Table('user', sa.MetaData(), sa.Column('id', sa.UUID), sa.Column('role', sa.String))
    customer_bills_table_v1 = sa.Table('customer_bills', sa.MetaData(),
        sa.Column('id', sa.UUID),
        sa.Column('total_due', sa.Numeric(12, 2)),
        sa.Column('is_paid', sa.Boolean)
    )
    payment_records_table = sa.Table('payment_records', sa.MetaData(),
        sa.Column('id', sa.UUID), sa.Column('customer_bill_id', sa.UUID),
        sa.Column('amount', sa.Numeric(12, 2)), sa.Column('payment_date', sa.Date),
        sa.Column('notes', sa.Text), sa.Column('created_by_user_id', sa.UUID),
        sa.Column('created_at', sa.DateTime(timezone=True))
    )

    try:
        admin_user_id_result = session.execute(sa.select(user_table.c.id).where(user_table.c.role == 'admin').limit(1)).scalar_one_or_none()
        if not admin_user_id_result:
            admin_user_id_result = session.execute(sa.select(user_table.c.id).limit(1)).scalar_one()
        admin_user_id = admin_user_id_result

        bills_to_migrate = session.execute(sa.select(customer_bills_table_v1.c.id, customer_bills_table_v1.c.total_due,customer_bills_table_v1.c.is_paid)).fetchall()

        payments_to_insert = []
        for bill_id, total_due, is_paid in bills_to_migrate:
            total_due = total_due or 0
            if is_paid:
                op.execute(
                    sa.update(sa.table('customer_bills', sa.column('id'), sa.column('payment_status'), sa.column('total_due'),sa.column('total_paid')))
                    .where(sa.column('id') == bill_id)
                    .values(payment_status='PAID', total_paid=total_due, total_due=total_due)
                )
                payments_to_insert.append({
                    'id': uuid.uuid4(), 'customer_bill_id': bill_id, 'amount': total_due,
                    'payment_date': datetime.utcnow().date(), 'notes': '系统迁移前已支付的历史记录',
                    'created_by_user_id': admin_user_id, 'created_at': datetime.utcnow()
                })
            else:
                op.execute(
                    sa.update(sa.table('customer_bills', sa.column('id'), sa.column('total_due'), sa.column('payment_status')))
                    .where(sa.column('id') == bill_id)
                    .values(total_due=total_due, payment_status='UNPAID')
                )

        if payments_to_insert:
            op.bulk_insert(payment_records_table, payments_to_insert)

        session.commit()
    except Exception as e:
        session.rollback()
        raise e

    # ### 模式迁移（收尾） ###
    # 【最终修复】只设置 nullable=False，移除 server_default
    op.alter_column('customer_bills', 'payment_status',
               existing_type=payment_status_enum,
               nullable=False)

    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.drop_column('is_paid')
        batch_op.drop_column('total_due')
        batch_op.drop_column('is_deferred')

    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.create_foreign_key('fk_exampapercourse_exam_paper_id', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
        batch_op.create_foreign_key('fk_exampapercourse_course_id', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')


def downgrade():
    # Downgrade 逻辑通常更复杂，这里只做结构恢复，不恢复数据
    with op.batch_alter_table('customer_bills', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_deferred', sa.BOOLEAN(), server_default=sa.text('false'), autoincrement=False, nullable=False))
        batch_op.add_column(sa.Column('total_due', sa.NUMERIC(precision=12, scale=2), server_default=sa.text('0'),autoincrement=False, nullable=False))
        batch_op.add_column(sa.Column('is_paid', sa.BOOLEAN(), server_default=sa.text('false'), autoincrement=False, nullable=False))
        batch_op.drop_index(batch_op.f('ix_customer_bills_payment_status'))
        batch_op.drop_column('total_paid')
        batch_op.drop_column('total_due')
        batch_op.drop_column('payment_status')

    with op.batch_alter_table('payment_records', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_payment_records_customer_bill_id'))

    op.drop_table('payment_records')
    sa.Enum(name='paymentstatus').drop(op.get_bind(), checkfirst=False)

    with op.batch_alter_table('exampapercourse', schema=None) as batch_op:
        batch_op.drop_constraint('fk_exampapercourse_exam_paper_id', type_='foreignkey')
        batch_op.drop_constraint('fk_exampapercourse_course_id', type_='foreignkey')