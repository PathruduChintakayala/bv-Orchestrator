"""Add machine_name to jobs table

Revision ID: add_machine_name_jobs
Revises: aa75a0770c97
Create Date: 2026-01-04 13:43:41.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision = 'add_machine_name_jobs'
down_revision = 'aa75a0770c97'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('jobs', sa.Column('machine_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade():
    op.drop_column('jobs', 'machine_name')

