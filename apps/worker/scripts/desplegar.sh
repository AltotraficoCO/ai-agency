#!/bin/bash
# Despliega el worker de Strappy en el VPS: trae main, instala, reinicia y
# comprueba que arranca ESTABLE, no solo que arrancó (la lección del 11-sep).
#
# Lo ejecuta GitHub Actions por SSH con una clave que solo puede correr este
# script (ver .github/workflows/desplegar-worker.yml). También sirve a mano:
#   ssh root@VPS /opt/strappy/apps/worker/scripts/desplegar.sh
set -euo pipefail
cd /opt/strappy
echo "==> antes: $(git log -1 --oneline)"
git fetch --quiet origin main
git reset --hard --quiet origin/main
echo "==> ahora: $(git log -1 --oneline)"
pnpm install --frozen-lockfile --silent
systemctl restart strappy-worker
sleep 30
estado=$(systemctl show strappy-worker -p ActiveState --value)
reinicios=$(systemctl show strappy-worker -p NRestarts --value)
echo "==> estado: $estado · reinicios desde el arranque: $reinicios"
journalctl -u strappy-worker -n 3 --no-pager
if [ "$estado" != "active" ] || [ "$reinicios" != "0" ]; then
  echo "EL WORKER NO ARRANCA ESTABLE" >&2
  exit 1
fi
echo "OK · worker desplegado"
