#!/usr/bin/env bash
# Ejecuta el test de aislamiento multi-tenant (criterio de aceptacion).
# Termina en ROLLBACK: no deja datos.
set -euo pipefail
URL="${1:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "Falta la URL de la base: ./scripts/test-isolation.sh <DATABASE_URL>" >&2
  exit 2
fi
HERE="$(cd "$(dirname "$0")/.." && pwd)"
psql -v ON_ERROR_STOP=1 -q -f "$HERE/tests/isolation.sql" "$URL"
