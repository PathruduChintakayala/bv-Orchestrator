"""Add external_id to packages

Revision ID: add_external_id_packages
Revises: add_external_id_processes
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_packages'
down_revision = 'add_external_id_processes'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('packages', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    packages_table = sa.table('packages', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(packages_table.c.id).where(packages_table.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(packages_table)
            .where(packages_table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('packages', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_packages_external_id', 'packages', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_packages_external_id', table_name='packages')
    op.drop_column('packages', 'external_id')
