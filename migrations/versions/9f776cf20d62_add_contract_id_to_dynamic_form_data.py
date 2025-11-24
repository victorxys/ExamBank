"""add_contract_id_to_dynamic_form_data

Revision ID: 9f776cf20d62
Revises: 9e6add6cd51e
Create Date: 2025-11-23 11:27:05.746892

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '9f776cf20d62'
down_revision = '9e6add6cd51e'
branch_labels = None
depends_on = None


def upgrade():
    # Add contract_id column to dynamic_form_data table
    op.add_column('dynamic_form_data', 
        sa.Column('contract_id', postgresql.UUID(as_uuid=True), nullable=True, comment='关联的合同ID'))
    
    # Add foreign key constraint
    op.create_foreign_key(
        'fk_dynamic_form_data_contract_id',
        'dynamic_form_data', 'contracts',
        ['contract_id'], ['id'],
        ondelete='SET NULL'
    )
    
    # Add index for performance
    op.create_index(
        'idx_dynamic_form_data_contract_id',
        'dynamic_form_data',
        ['contract_id']
    )


def downgrade():
    # Remove index
    op.drop_index('idx_dynamic_form_data_contract_id', table_name='dynamic_form_data')
    
    # Remove foreign key constraint
    op.drop_constraint('fk_dynamic_form_data_contract_id', 'dynamic_form_data', type_='foreignkey')
    
    # Remove column
    op.drop_column('dynamic_form_data', 'contract_id')
