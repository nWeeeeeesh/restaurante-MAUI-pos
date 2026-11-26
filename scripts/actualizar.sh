#!/usr/bin/env bash
# Actualiza MauiDesk en la Raspberry Pi del local a una etiqueta, con los pasos de
# DEPLOYMENT.md → «Desplegar la versión de la tesis (incrementos 1 a 3)». Se detiene en
# el primer error; si falla después de cambiar de versión, imprime el rollback.
set -euo pipefail

AYUDA="Uso: bash actualizar.sh <etiqueta> [--si]

Actualiza la Pi a <etiqueta> (por ejemplo maui-tesis-v1.0), en orden:
  1. comprueba Node 24
  2. respaldo previo pre-<etiqueta>.db.gz (sqlite3 .backup) en BACKUP_DIR y en REMOTO
  3. agrega MAUI_LOCAL_ID=1 al .env si falta
  4. git fetch --tags && git checkout <etiqueta>
  5. detiene el servicio; npm ci y npm run build en server y client
     (si npm ci falla por el lockfile, reintenta con npx npm@11 ci)
  6. db:migrate (exige [migrate] OK), db:seed, db:recetas -- --dry-run
     (muestra los platos no encontrados y pide confirmar) y db:recetas
  7. arranca el servicio y espera el 200 de /api/health

  --si      no pide confirmación antes de cargar las recetas
  --help    esta ayuda

Variables (valor por defecto):
  MAUI_DIR=/home/mauidesk/MAUI   BACKUP_DIR=/home/mauidesk/backups
  REMOTO=gdrive:MauiDeskBackups/ SERVICIO=mauidesk   PUERTO=3001"

ETIQUETA=""
SI=0
for a in "$@"; do
  case "$a" in
    -h|--help) echo "$AYUDA"; exit 0 ;;
    --si) SI=1 ;;
    -*) echo "Opción desconocida: $a" >&2; echo "$AYUDA" >&2; exit 2 ;;
    *) if [ -n "$ETIQUETA" ]; then echo "Sobra el argumento: $a" >&2; exit 2; fi; ETIQUETA="$a" ;;
  esac
done
if [ -z "$ETIQUETA" ]; then echo "$AYUDA" >&2; exit 2; fi

# git checkout puede reemplazar este archivo mientras bash lo lee: se corre una copia
if [ -z "${ACTUALIZAR_COPIA:-}" ]; then
  COPIA="$(mktemp /tmp/actualizar.XXXXXX.sh)"
  cp "$0" "$COPIA"
  ACTUALIZAR_COPIA=1 exec bash "$COPIA" "$@"
fi

MAUI_DIR="${MAUI_DIR:-/home/mauidesk/MAUI}"
BACKUP_DIR="${BACKUP_DIR:-/home/mauidesk/backups}"
REMOTO="${REMOTO:-gdrive:MauiDeskBackups/}"
SERVICIO="${SERVICIO:-mauidesk}"
PUERTO="${PUERTO:-3001}"
ENV_FILE="$MAUI_DIR/server/.env"

paso() { echo; echo "── [$1] $2"; }
falla() { echo "ERROR: $*" >&2; exit 1; }

ANTERIOR=""
CAMBIADO=0
rollback() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$CAMBIADO" -eq 1 ]; then
    cat >&2 <<EOF

La actualización falló después de cambiar de versión. Para volver a la anterior
(DEPLOYMENT.md → rollback):
  cd $MAUI_DIR && git checkout $ANTERIOR
  cd server && npm ci && npm run build
  cd ../client && npm ci && npm run build
  sudo systemctl restart $SERVICIO
Las migraciones son aditivas: la versión anterior funciona con la base nueva. Restaura
$BACKUP_DIR/pre-$ETIQUETA.db.gz (restore-backup.sh, caso B) solo si los datos se dañaron.
EOF
  fi
}
trap rollback EXIT

npm_ci() {
  if ! npm ci; then
    echo "npm ci falló; se reintenta con npm 11 (npx npm@11 ci)"
    npx --yes npm@11 ci
  fi
}

[ -d "$MAUI_DIR/.git" ] || falla "no hay un repositorio en $MAUI_DIR"
[ -f "$ENV_FILE" ] || falla "no existe $ENV_FILE"

paso 1 "Node 24"
command -v node >/dev/null || falla "Node no está instalado (Fase 3 de DEPLOYMENT.md)"
NODE_MAYOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAYOR" -ge 24 ] || falla "la Pi tiene Node $(node --version); se necesita Node 24 (Fase 3 de DEPLOYMENT.md)"
echo "Node $(node --version)"

paso 2 "Respaldo previo"
command -v sqlite3 >/dev/null || falla "falta sqlite3 (sudo apt install -y sqlite3)"
DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true)"
DB_PATH="${DB_URL#file:}"
[ -n "$DB_PATH" ] || DB_PATH="./mauidisk.db"
case "$DB_PATH" in /*) ;; *) DB_PATH="$MAUI_DIR/server/${DB_PATH#./}" ;; esac
[ -f "$DB_PATH" ] || falla "no existe la base $DB_PATH (DATABASE_URL de $ENV_FILE)"
mkdir -p "$BACKUP_DIR"
RESPALDO="$BACKUP_DIR/pre-$ETIQUETA.db"
rm -f "$RESPALDO" "$RESPALDO.gz"
sqlite3 "$DB_PATH" ".backup '$RESPALDO'"
gzip -f "$RESPALDO"
command -v rclone >/dev/null || falla "falta rclone: el respaldo previo también va fuera del local (Fase 11)"
rclone copy "$RESPALDO.gz" "$REMOTO"
echo "Respaldo: $RESPALDO.gz (copiado a $REMOTO)"

paso 3 "Número de local"
if grep -q '^MAUI_LOCAL_ID=' "$ENV_FILE"; then
  echo "Ya está: $(grep '^MAUI_LOCAL_ID=' "$ENV_FILE" | tail -n1)"
else
  echo 'MAUI_LOCAL_ID=1' >> "$ENV_FILE"
  echo "Agregado MAUI_LOCAL_ID=1"
fi

paso 4 "Versión $ETIQUETA"
cd "$MAUI_DIR"
ANTERIOR="$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)"
git fetch --tags
git rev-parse -q --verify "refs/tags/$ETIQUETA" >/dev/null || falla "la etiqueta $ETIQUETA no existe"
git checkout "$ETIQUETA"
CAMBIADO=1
echo "De $ANTERIOR a $ETIQUETA"

paso 5 "Compilar (servicio detenido)"
sudo systemctl stop "$SERVICIO"
cd "$MAUI_DIR/server" && npm_ci && npm run build
cd "$MAUI_DIR/client" && npm_ci && npm run build

paso 6 "Base de datos y recetas"
cd "$MAUI_DIR/server"
SALIDA="$(npm run db:migrate 2>&1)" || { echo "$SALIDA"; falla "db:migrate falló"; }
echo "$SALIDA" | tail -n 3
echo "$SALIDA" | grep -q '\[migrate\] OK' || falla "db:migrate no terminó en [migrate] OK"
npm run db:seed
npm run db:recetas -- --dry-run
if [ "$SI" -ne 1 ]; then
  read -r -p "¿Cargar estas recetas? Revisa arriba los platos no encontrados [s/N] " r
  case "$r" in s|S|si|SI|sí|Sí) ;; *) falla "recetas no cargadas; el servicio sigue detenido. Arráncalo con: sudo systemctl start $SERVICIO" ;; esac
fi
npm run db:recetas

paso 7 "Arrancar"
sudo systemctl start "$SERVICIO"
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PUERTO/api/health" || true)" = "200" ]; then
    echo "/api/health responde 200"
    journalctl -u "$SERVICIO" -n 20 --no-pager || true
    echo
    echo "Listo: $ETIQUETA. En el log deben estar «[startup] Local 1» y, la primera vez, «[nightly] puesta al día»."
    trap - EXIT
    exit 0
  fi
  sleep 2
done
journalctl -u "$SERVICIO" -n 50 --no-pager || true
falla "/api/health no respondió 200 en 2 minutos"
