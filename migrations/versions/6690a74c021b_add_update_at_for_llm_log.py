"""add_update_at for llm log

Revision ID: 6690a74c021b
Revises: f278973e3574
Create Date: 2025-06-09 15:17:53.621833

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '6690a74c021b'
down_revision = 'f278973e3574'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_constraint('exampapercourse_exam_paper_id_fkey', 'exampapercourse', type_='foreignkey')
    op.drop_constraint('exampapercourse_course_id_fkey', 'exampapercourse', type_='foreignkey')
    op.create_foreign_key(None, 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.create_foreign_key(None, 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], source_schema='public', ondelete='CASCADE')
    op.add_column('llm_call_logs', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True))
    op.add_column('llm_call_logs', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True))
    op.alter_column('llm_call_logs', 'timestamp',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               comment='调用开始时间',
               existing_nullable=True,
               existing_server_default=sa.text('now()'))
    op.alter_column('llm_call_logs', 'status',
               existing_type=sa.VARCHAR(length=50),
               comment='success, error, pending',
               existing_nullable=False)
    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    op.alter_column('llm_call_logs', 'status',
               existing_type=sa.VARCHAR(length=50),
               comment=None,
               existing_comment='success, error, pending',
               existing_nullable=False)
    op.alter_column('llm_call_logs', 'timestamp',
               existing_type=postgresql.TIMESTAMP(timezone=True),
               comment=None,
               existing_comment='调用开始时间',
               existing_nullable=True,
               existing_server_default=sa.text('now()'))
    op.drop_column('llm_call_logs', 'updated_at')
    op.drop_column('llm_call_logs', 'created_at')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.drop_constraint(None, 'exampapercourse', schema='public', type_='foreignkey')
    op.create_foreign_key('exampapercourse_course_id_fkey', 'exampapercourse', 'trainingcourse', ['course_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('exampapercourse_exam_paper_id_fkey', 'exampapercourse', 'exampaper', ['exam_paper_id'], ['id'], ondelete='CASCADE')
    # ### end Alembic commands ###
