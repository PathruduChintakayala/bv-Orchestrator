"""Add completed_at to queue_items

Revision ID: 20260107_add_queue_item_completed_at
Revises: aa75a0770c97
Create Date: 2026-01-07
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260107_add_queue_item_completed_at'
down_revision = 'aa75a0770c97'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('queue_items', sa.Column('completed_at', sa.String(), nullable=True))
    op.create_index(op.f('ix_queue_items_completed_at'), 'queue_items', ['completed_at'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_queue_items_completed_at'), table_name='queue_items')
    op.drop_column('queue_items', 'completed_at')
