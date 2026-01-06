"""Add external_id to assets

Revision ID: add_external_id_assets
Revises: add_external_id_machines
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_assets'
down_revision = 'add_external_id_machines'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('asset', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    assets_table = sa.table('asset', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(assets_table.c.id).where(assets_table.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(assets_table)
            .where(assets_table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('asset', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_asset_external_id', 'asset', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_asset_external_id', table_name='asset')
    op.drop_column('asset', 'external_id')
