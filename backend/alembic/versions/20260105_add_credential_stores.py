"""Add credential stores

Revision ID: add_credential_stores
Revises: add_user_avatar
Create Date: 2026-01-05
"""

from alembic import op
import sqlalchemy as sa
from datetime import datetime

# revision identifiers, used by Alembic.
revision = 'add_credential_stores'
down_revision = 'add_user_avatar'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'credential_store',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False, unique=True),
        sa.Column('type', sa.String(length=64), nullable=False, index=True),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('0')),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('config', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_credential_store_is_default', 'credential_store', ['is_default'], unique=False)
    op.create_index('ix_credential_store_type', 'credential_store', ['type'], unique=False)

    conn = op.get_bind()
    now = datetime.utcnow()
    conn.execute(
        sa.text(
            "INSERT INTO credential_store (name, type, is_default, is_active, description, config, created_at, updated_at) "
            "VALUES (:name, :type, 1, 1, :description, NULL, :created_at, :updated_at)"
        ),
        {
            "name": "Orchestrator Store",
            "type": "INTERNAL_DB",
            "description": "Built-in credential store backed by the orchestrator database",
            "created_at": now,
            "updated_at": now,
        },
    )
    default_id = conn.execute(sa.text("SELECT id FROM credential_store WHERE is_default = 1 LIMIT 1")).scalar()

    op.add_column('asset', sa.Column('credential_store_id', sa.Integer(), nullable=True))
    op.create_index('ix_asset_credential_store_id', 'asset', ['credential_store_id'], unique=False)
    op.create_foreign_key('fk_asset_credential_store', 'asset', 'credential_store', ['credential_store_id'], ['id'])

    if default_id:
        conn.execute(sa.text("UPDATE asset SET credential_store_id = :cid WHERE lower(type) in ('secret','credential')"), {"cid": default_id})


def downgrade():
    op.drop_constraint('fk_asset_credential_store', 'asset', type_='foreignkey')
    op.drop_index('ix_asset_credential_store_id', table_name='asset')
    op.drop_column('asset', 'credential_store_id')
    op.drop_index('ix_credential_store_type', table_name='credential_store')
    op.drop_index('ix_credential_store_is_default', table_name='credential_store')
    op.drop_table('credential_store')
