#!/usr/bin/env bash
# Runs the Supabase migrations on a plain PostgreSQL and checks every permission rule.
# Usage: tests/db/run.sh  (needs psql and a database URL in DATABASE_URL, e.g. postgres://postgres:postgres@localhost:5432/postgres)
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${DATABASE_URL:?set DATABASE_URL}"
cat tests/db/supabase_stub.sql supabase/migrations/*.sql | psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" > /dev/null
cat supabase/migrations/*.sql | psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" > /dev/null   # safe to run twice
out=$(psql -q "$DATABASE_URL" -f tests/db/permissions.sql 2>&1)
echo "$out" | grep -E "ok  |FAILED|ERROR" | sed 's/^NOTICE:  //'
echo "$out" | grep -q "ALL PERMISSION TESTS PASSED" || { echo "Permission tests failed"; exit 1; }
echo "All permission tests passed."
