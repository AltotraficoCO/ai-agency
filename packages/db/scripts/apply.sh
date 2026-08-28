#!/usr/bin/env bash
# Aplica todas las migraciones, en orden, contra la base indicada.
#
#   ./scripts/apply.sh "postgresql://postgres:postgres@localhost:54322/postgres"
#   DATABASE_URL=... ./scripts/apply.sh
#
# Cada fichero es idempotente (create ... if not exists / on conflict do nothing),
# asi que reaplicar la serie completa es inocuo.
set -euo pipefail
URL="${1:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "Falta la URL de la base: ./scripts/apply.sh <DATABASE_URL>" >&2
  exit 2
fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"

for f in "$HERE"/migrations/*.sql; do
  echo "==> $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f" "$URL"
done
echo "OK · esquema aplicado"
