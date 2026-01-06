"""Add external_id to machines

Revision ID: add_external_id_machines
Revises: add_external_id_robots
Create Date: 2026-01-06
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel
import uuid

# revision identifiers, used by Alembic.
revision = 'add_external_id_machines'
down_revision = 'add_external_id_robots'
branch_labels = None
depends_on = None


def upgrade():
    # Add nullable first for backfill (SQLite-friendly), then backfill, then enforce not null + unique index.
    op.add_column('machines', sa.Column('external_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True))

    conn = op.get_bind()
    machines = sa.table('machines', sa.column('id', sa.Integer()), sa.column('external_id', sa.String()))
    rows = conn.execute(sa.select(machines.c.id).where(machines.c.external_id == None)).fetchall()  # noqa: E711
    for row in rows:
        conn.execute(
            sa.update(machines)
            .where(machines.c.id == row.id)
            .values(external_id=str(uuid.uuid4()))
        )

    op.alter_column('machines', 'external_id', existing_type=sqlmodel.sql.sqltypes.AutoString(), nullable=False)
    op.create_index('ix_machines_external_id', 'machines', ['external_id'], unique=True)


def downgrade():
    op.drop_index('ix_machines_external_id', table_name='machines')
    op.drop_column('machines', 'external_id')
