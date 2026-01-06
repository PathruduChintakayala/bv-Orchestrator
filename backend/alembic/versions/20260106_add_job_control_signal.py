"""Add control_signal to jobs

Revision ID: add_job_control_signal
Revises: queue_item_status_error_contract
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision = 'add_job_control_signal'
down_revision = 'queue_item_status_error_contract'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('jobs', sa.Column('control_signal', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade():
    op.drop_column('jobs', 'control_signal')
