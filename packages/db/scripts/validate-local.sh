#!/usr/bin/env bash
# Aplica todas las migraciones contra un Postgres local pelado para comprobar
# que son sintacticamente validas y coherentes entre si.
#
#   ./scripts/validate-local.sh [nombre_db]
#
# El Postgres local no trae pgvector ni el esquema auth de Supabase, asi que
# tests/harness/00_stub_supabase.sql los simula y aqui se sustituyen el tipo
# vector y el indice HNSW por equivalentes que Postgres pelado sabe crear.
# Es una comprobacion de SINTAXIS Y COHERENCIA, no de rendimiento vectorial.
set -euo pipefail
export PATH="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}:$PATH"
DB="${1:-strappy_check}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

dropdb --if-exists "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$HERE/tests/harness/00_stub_supabase.sql"

for f in "$HERE"/migrations/*.sql; do
  echo "==> $(basename "$f")"
  sed -e 's/vector(1536)/public.vector/g' \
      -e 's/using hnsw (embedding vector_cosine_ops)/using btree (id)/' \
      -e 's/with (m = 16, ef_construction = 64);/;/' \
      -e 's/^create extension if not exists vector with schema extensions;/-- vector simulado localmente/' \
      -e 's/(uuid\[\], text, vector, integer)/(uuid[], text, public.vector, integer)/' \
      "$f" | psql -v ON_ERROR_STOP=1 -q -d "$DB" -f - 2>&1 \
      | grep -viE 'NOTICE|^ *apply_tenant_rls|^-+$|^ *$|\(1 row\)' || true
done

echo "OK · migraciones aplicadas sobre $DB"
