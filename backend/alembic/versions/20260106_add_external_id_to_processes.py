"""Add external_id to processes

Revision ID: add_external_id_processes
Revises: add_job_control_signal
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_processes'
down_revision = 'add_job_control_signal'
branch_labels = None
depends_on = None


def upgrade():
    # Add column nullable first for backfill compatibility (SQLite-friendly).
    op.add_column('processes', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    processes_table = sa.table('processes', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))

    results = conn.execute(sa.select(processes_table.c.id).where(processes_table.c.external_id == None)).fetchall()  # noqa: E711
    for row in results:
        conn.execute(
            sa.update(processes_table)
            .where(processes_table.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('processes', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_processes_external_id', 'processes', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_processes_external_id', table_name='processes')
    op.drop_column('processes', 'external_id')
