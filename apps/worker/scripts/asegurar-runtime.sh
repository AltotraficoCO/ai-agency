#!/bin/bash
# Comprueba que el Node del VPS no es vulnerable a CVE-2026-111497 (Node2Shell)
# y, si lo es, lo actualiza. Lo llama desplegar.sh ANTES de parar el worker:
# si no se puede arreglar, el despliegue falla y el worker viejo sigue en pie.
#
# Por qué aquí y no «ya lo haré»: el worker descarga páginas e imágenes de
# sitios que no controlamos, y ese `fetch` es exactamente la vía de entrada
# del fallo. Un VPS sin parche es un servidor ajeno a una petición de distancia.
set -euo pipefail

# Versiones arregladas por rama. Fuera de estas ramas no hay parche.
parcheada() {
  local v="$1" mayor menor parche
  IFS=. read -r mayor menor parche <<<"${v#v}"
  case "$mayor" in
    22) [ "$menor" -gt 23 ] || { [ "$menor" -eq 23 ] && [ "$parche" -ge 4 ]; } ;;
    24) [ "$menor" -gt 22 ] || { [ "$menor" -eq 22 ] && [ "$parche" -ge 1 ]; } ;;
    26) [ "$menor" -gt 12 ] || { [ "$menor" -eq 12 ] && [ "$parche" -ge 1 ]; } ;;
    *) [ "$mayor" -gt 26 ] ;;
  esac
}

# Sin gestor conocido: el tarball oficial de nodejs.org, con la suma
# verificada, en /opt/node/<version>, y los binarios de node/npm/npx
# sustituidos ALLÍ DONDE ESTÉN (lo que resuelve `command -v node`), para que
# la unidad de systemd y el PATH sigan encontrándolos. Los viejos quedan con
# sufijo .pre-node2shell por si hay que volver.
instalar_tarball_oficial() {
  local actual="$1" mayor objetivo arq dir tar ruta_node bindir f
  mayor="${actual#v}"; mayor="${mayor%%.*}"
  case "$mayor" in
    22) objetivo="22.23.4" ;;
    24) objetivo="24.22.1" ;;
    *)  objetivo="26.12.1" ;;
  esac
  case "$(uname -m)" in
    x86_64) arq="x64" ;;
    aarch64|arm64) arq="arm64" ;;
    *) echo "Arquitectura $(uname -m) sin tarball oficial; actualiza Node a mano." >&2; exit 1 ;;
  esac
  ruta_node="$(readlink -f "$(command -v node)")"
  bindir="$(dirname "$ruta_node")"
  echo "==> node viene de $ruta_node (sin gestor reconocido): instalando el tarball oficial $objetivo"
  dir="/opt/node/v$objetivo"
  tar="node-v$objetivo-linux-$arq.tar.xz"
  mkdir -p /opt/node
  (
    cd /opt/node
    curl -fsSLO "https://nodejs.org/dist/v$objetivo/$tar"
    curl -fsSLO "https://nodejs.org/dist/v$objetivo/SHASUMS256.txt"
    grep " $tar\$" SHASUMS256.txt | sha256sum -c - >/dev/null
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xJf "$tar" -C "$dir" --strip-components=1
    rm -f "$tar" SHASUMS256.txt
  )
  for f in node npm npx corepack; do
    if [ -e "$bindir/$f" ] || [ -L "$bindir/$f" ]; then
      [ -e "$bindir/$f.pre-node2shell" ] || mv "$bindir/$f" "$bindir/$f.pre-node2shell"
    fi
    [ -e "$dir/bin/$f" ] && ln -sfn "$dir/bin/$f" "$bindir/$f"
  done
  # pnpm lo trae corepack (el shim que haya en el PATH sigue valiendo).
  echo "==> binarios de $bindir apuntando a $dir"
}

actual="$(node --version)"
if parcheada "$actual"; then
  echo "==> node $actual: sin CVE-2026-111497"
else
  echo "==> node $actual es VULNERABLE a CVE-2026-111497: actualizando"
  if [ -f /etc/apt/sources.list.d/nodesource.list ]; then
    # NodeSource: la rama la fija el repo apt; apt trae el último parche.
    apt-get update -qq
    apt-get install -y -qq --only-upgrade nodejs >/dev/null
  elif command -v n >/dev/null 2>&1; then
    n 26.12.1
  elif [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 26.12.1 && nvm alias default 26.12.1
  else
    instalar_tarball_oficial "$actual"
  fi
  hash -r
  actual="$(node --version)"
  if ! parcheada "$actual"; then
    echo "Node sigue en $actual tras intentar actualizar; revisa el gestor de paquetes." >&2
    exit 1
  fi
  echo "==> node actualizado a $actual"
fi

# El Chrome del Webmaster lleva el mismo descompresor Brotli de Google.
for paquete in google-chrome-stable chromium chromium-browser; do
  if dpkg -s "$paquete" >/dev/null 2>&1; then
    echo "==> actualizando $paquete"
    apt-get update -qq
    apt-get install -y -qq --only-upgrade "$paquete" >/dev/null || echo "no se pudo actualizar $paquete; revísalo a mano" >&2
  fi
done
