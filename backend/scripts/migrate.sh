#!/bin/bash
set -e

# Detect first Alembic deployment on an existing DB:
# If app tables exist but alembic_version does not, stamp head instead of
# running the baseline migration (which would fail on the existing schema).
ACTION=$(python -c "
from sqlalchemy import create_engine, inspect
import os
url = os.environ.get('DATABASE_URL', 'postgresql+psycopg2://erp:erp@db:5432/erp').replace('+asyncpg', '+psycopg2')
engine = create_engine(url)
insp = inspect(engine)
has_alembic = insp.has_table('alembic_version')
has_app = insp.has_table('items')
print('bootstrap' if not has_app and not has_alembic else 'stamp' if has_app and not has_alembic else 'upgrade')
")

if [ "$ACTION" = "bootstrap" ]; then
    # Empty DB: the baseline migration can't build from nothing — see app/db/bootstrap.py.
    echo "Empty database — creating schema from models and stamping at head"
    python -m app.db.bootstrap
    alembic stamp head
elif [ "$ACTION" = "stamp" ]; then
    echo "First Alembic deployment on existing DB — stamping at head"
    alembic stamp head
else
    alembic upgrade head
fi
