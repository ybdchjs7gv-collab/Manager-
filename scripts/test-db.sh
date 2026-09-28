#!/usr/bin/env bash
# Testet die Datenbank-Migrationen gegen ein lokales Postgres.
# Aufruf: PGHOST=/tmp/pgtest PGPORT=54329 scripts/test-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DB="manager_test_$$"
export PGUSER="${PGUSER:-postgres}"

psql -q -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT

run() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1"; }

run supabase/tests/stubs.sql
for f in supabase/migrations/*.sql; do
  echo "Migration: $f"
  run "$f"
done
run supabase/tests/rls_test.sql
