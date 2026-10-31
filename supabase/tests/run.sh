#!/usr/bin/env bash
# Run the database test suite against a throwaway local PostgreSQL + PostGIS cluster.
#   supabase/tests/run.sh
# Requires PostgreSQL 15+ server binaries with PostGIS installed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pgbin="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
work="$(mktemp -d)"
port="${PGTEST_PORT:-54329}"
# PostgreSQL refuses to run as root; use the postgres OS account when needed.
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$work"
trap 'as_pg "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

as_pg "$pgbin/initdb" -D "$work/data" -U postgres -A trust >/dev/null
as_pg "$pgbin/pg_ctl" -D "$work/data" -o "-p $port -k $work -c listen_addresses=''" -l "$work/log" -w start >/dev/null
psql_() { psql -h "$work" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_ -d postgres -c "create database parade_test"

sed "s/current_database_placeholder/parade_test/" "$here/supabase_shim.sql" | psql_ -d parade_test
for f in "$root"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  psql_ -d parade_test -f "$f"
done
echo "seed: seed.sql"
psql_ -d parade_test -f "$root/supabase/seed.sql"
for f in "$here"/test_*.sql; do
  echo "test: $(basename "$f")"
  psql_ -d parade_test -o /dev/null -f "$f"
done
echo "All database tests passed."
