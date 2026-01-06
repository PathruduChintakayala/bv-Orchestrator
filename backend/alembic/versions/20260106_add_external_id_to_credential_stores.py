"""Add external_id to credential_store

Revision ID: add_external_id_credential_stores
Revises: add_external_id_assets
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_credential_stores'
down_revision = 'add_external_id_assets'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('credential_store', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    stores = sa.table('credential_store', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(stores.c.id).where(stores.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(stores)
            .where(stores.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('credential_store', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_credential_store_external_id', 'credential_store', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_credential_store_external_id', table_name='credential_store')
    op.drop_column('credential_store', 'external_id')
