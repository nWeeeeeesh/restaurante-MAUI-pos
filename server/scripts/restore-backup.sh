#!/usr/bin/env bash
# Restaura un backup de MauiDesk (mauidisk-AAAAMMDD-HHMM.db.gz o un .db de
# `sqlite3 .backup`) en la ruta indicada, SIN pisar nada: si el destino ya
# existe, aborta. Para reemplazar la base activa primero se aparta la actual
# (ver DEPLOYMENT.md → "Restaurar un backup").
#
# Uso:  server/scripts/restore-backup.sh <backup.db.gz|backup.db> <destino.db>
# Ej.:  server/scripts/restore-backup.sh ~/backups/mauidisk-20261014-0300.db.gz /tmp/prueba.db
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <backup.db.gz|backup.db> <destino.db>" >&2
  exit 2
fi
SRC=$1
DEST=$2

command -v sqlite3 >/dev/null || { echo "Falta sqlite3 (sudo apt install -y sqlite3)" >&2; exit 1; }
[ -f "$SRC" ] || { echo "No existe el backup: $SRC" >&2; exit 1; }

# Nunca sobrescribir: ni la base ni sus auxiliares de WAL (si quedara un -wal
# viejo junto al destino, SQLite lo aplicaría sobre el backup restaurado).
for f in "$DEST" "$DEST-wal" "$DEST-shm"; do
  if [ -e "$f" ]; then
    echo "El destino ya existe: $f" >&2
    echo "Elige otra ruta o aparta la base actual primero (ver DEPLOYMENT.md)." >&2
    exit 1
  fi
done
DEST_DIR=$(dirname "$DEST")
[ -d "$DEST_DIR" ] || { echo "No existe la carpeta de destino: $DEST_DIR" >&2; exit 1; }

# Se descomprime a un temporal en la misma carpeta y solo se mueve al destino
# si pasa la verificación: así nunca queda una base a medias en la ruta final.
TMP=$(mktemp "$DEST_DIR/.restore-XXXXXX")
trap 'rm -f "$TMP" "$TMP-wal" "$TMP-shm"' EXIT

case "$SRC" in
  *.gz)
    gzip -t "$SRC" || { echo "El archivo .gz está dañado: $SRC" >&2; exit 1; }
    gunzip -c "$SRC" > "$TMP"
    ;;
  *)
    cp "$SRC" "$TMP"
    ;;
esac

CHECK=$(sqlite3 "$TMP" "PRAGMA integrity_check;" 2>&1 || true)
if [ "$CHECK" != "ok" ]; then
  echo "El backup no pasó la verificación de integridad:" >&2
  echo "$CHECK" | head -20 >&2
  exit 1
fi

echo "Integridad: ok"
echo "Resumen del backup (compáralo con el Historial y los Reportes del local):"
sqlite3 -header -column "$TMP" "
  SELECT
    (SELECT COUNT(*) FROM bills)                       AS boletas,
    (SELECT printf('%.2f', COALESCE(SUM(total), 0)) FROM bills) AS total_cobrado,
    (SELECT MAX(paid_at) FROM bills)                   AS ultima_boleta_utc,
    (SELECT COUNT(*) FROM orders)                      AS pedidos,
    (SELECT COUNT(*) FROM users WHERE active = 1)      AS usuarios_activos;"

# ln falla si el destino apareció mientras tanto (mv lo pisaría)
ln "$TMP" "$DEST" || { echo "No se pudo crear $DEST (¿ya existe?)" >&2; exit 1; }
echo "Restaurado en: $DEST"
