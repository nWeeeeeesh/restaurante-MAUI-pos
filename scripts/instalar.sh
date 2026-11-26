#!/usr/bin/env bash
# Instalador de MauiDesk en una Raspberry Pi recién grabada (E4 del artículo, Tabla I).
# Ejecuta sin intervención las fases 3 a 11 de DEPLOYMENT.md y cronometra cada una. Las
# fases 1 y 2 (imagen con el usuario mauidesk e IP fija en el router) se hacen a mano y
# su tiempo entra con --fases12-min. Si una fase falla, se detiene, dice cuál y deja
# instalar.log; --desde <fase> retoma.
set -Eeuo pipefail

AYUDA="Uso: bash instalar.sh --repo <url> --etiqueta <etiqueta> [opciones]

  --repo <url>                repositorio git (si ya está clonado en --dir, se usa ese)
  --etiqueta <etiqueta>       versión a instalar, por ejemplo maui-tesis-v1.0
  --modo-pruebas              banco de pruebas: MAUI_MODO_PRUEBAS=1, base simulada
                              (db:sim), impresora simulada, usuario desarrollador y
                              respaldos de mauidisk-sim.db a gdrive:MauiDeskPrueba/
  --dev-usuario <nombre>      usuario desarrollador (obligatorio con --modo-pruebas)
  --dev-clave <clave>         su contraseña, 8 caracteres o más
  --impresora <ip>            IP de la ticketera (obligatorio sin --modo-pruebas)
  --rclone-conf <archivo>     rclone.conf con el remoto «gdrive» (copia externa de los respaldos)
  --tailscale-authkey <clave> clave de Tailscale; sin ella, la fase 10 se omite
  --fases12-min <min>         tiempo de las fases 1 y 2 (cronómetro del celular): un número
                              para las dos juntas o «f1,f2»
  --desde <fase>              retoma desde esa fase (3 a 11)
  --dir <ruta>                carpeta del sistema (por defecto /home/mauidesk/MAUI)
  --help                      esta ayuda

Fases: 3 dependencias · 4 código y compilación · 5 .env · 6 impresora · 7 base de datos ·
8 systemd · 9 prueba de extremo a extremo · 10 Tailscale · 11 respaldos.
Al final escribe server/data/dev/instalacion-tiempos.json y lo imprime."

REPO=""; ETIQUETA=""; MODO_PRUEBAS=0; DEV_USUARIO=""; DEV_CLAVE=""; IMPRESORA=""
RCLONE_CONF=""; TS_AUTHKEY=""; FASES12=""; DESDE=3
MAUI_DIR="/home/mauidesk/MAUI"
falta_valor() { echo "Falta el valor de $1" >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) echo "$AYUDA"; exit 0 ;;
    --repo) [ $# -ge 2 ] || falta_valor "$1"; REPO="$2"; shift 2 ;;
    --etiqueta) [ $# -ge 2 ] || falta_valor "$1"; ETIQUETA="$2"; shift 2 ;;
    --modo-pruebas) MODO_PRUEBAS=1; shift ;;
    --dev-usuario) [ $# -ge 2 ] || falta_valor "$1"; DEV_USUARIO="$2"; shift 2 ;;
    --dev-clave) [ $# -ge 2 ] || falta_valor "$1"; DEV_CLAVE="$2"; shift 2 ;;
    --impresora) [ $# -ge 2 ] || falta_valor "$1"; IMPRESORA="$2"; shift 2 ;;
    --rclone-conf) [ $# -ge 2 ] || falta_valor "$1"; RCLONE_CONF="$2"; shift 2 ;;
    --tailscale-authkey) [ $# -ge 2 ] || falta_valor "$1"; TS_AUTHKEY="$2"; shift 2 ;;
    --fases12-min) [ $# -ge 2 ] || falta_valor "$1"; FASES12="$2"; shift 2 ;;
    --desde) [ $# -ge 2 ] || falta_valor "$1"; DESDE="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || falta_valor "$1"; MAUI_DIR="$2"; shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; echo "$AYUDA" >&2; exit 2 ;;
  esac
done

error_uso() { echo "ERROR: $*" >&2; echo "Ayuda: bash instalar.sh --help" >&2; exit 2; }
[ -n "$ETIQUETA" ] || error_uso "falta --etiqueta"
[[ "$DESDE" =~ ^([3-9]|1[01])$ ]] || error_uso "--desde debe ser una fase de 3 a 11"
if [ "$MODO_PRUEBAS" -eq 1 ]; then
  [ -n "$DEV_USUARIO" ] && [ -n "$DEV_CLAVE" ] || error_uso "--modo-pruebas necesita --dev-usuario y --dev-clave"
  [ "${#DEV_CLAVE}" -ge 8 ] || error_uso "--dev-clave debe tener al menos 8 caracteres"
else
  [ -n "$IMPRESORA" ] || error_uso "sin --modo-pruebas hace falta --impresora <ip>"
fi
[ -n "$RCLONE_CONF" ] || error_uso "falta --rclone-conf (la copia de los respaldos fuera del equipo es obligatoria)"
[ -f "$RCLONE_CONF" ] || error_uso "no existe $RCLONE_CONF"
RCLONE_CONF="$(cd "$(dirname "$RCLONE_CONF")" && pwd)/$(basename "$RCLONE_CONF")"
if [ -n "$FASES12" ] && ! [[ "$FASES12" =~ ^[0-9]+(\.[0-9]+)?(,[0-9]+(\.[0-9]+)?)?$ ]]; then
  error_uso "--fases12-min es un número de minutos o «f1,f2»"
fi

HOME_DIR="$(dirname "$MAUI_DIR")"
SERVER="$MAUI_DIR/server"
LOG="$HOME_DIR/instalar.log"
ESTADO="$HOME_DIR/.maui-instalar-tiempos"
BACKUP_DIR="$HOME_DIR/backups"
BACKUP_SH="$HOME_DIR/backup.sh"
PUERTO=3001
if [ "$MODO_PRUEBAS" -eq 1 ]; then
  BASE="$SERVER/mauidisk-sim.db"; REMOTO="gdrive:MauiDeskPrueba/"; PREFIJO="mauidisk-sim"
else
  BASE="$SERVER/mauidisk.db"; REMOTO="gdrive:MauiDeskBackups/"; PREFIJO="mauidisk"
fi

mkdir -p "$HOME_DIR"
exec > >(tee -a "$LOG") 2>&1
echo
echo "=== instalar.sh $(date '+%Y-%m-%d %H:%M:%S') · $ETIQUETA · $([ "$MODO_PRUEBAS" -eq 1 ] && echo 'modo de pruebas' || echo 'local') · desde la fase $DESDE"

FASE_ACTUAL=""
trap 'echo; echo "ERROR en la fase ${FASE_ACTUAL:-?} (línea $LINENO). Revisa $LOG y retoma con: bash instalar.sh … --desde ${FASE_ACTUAL:-3}" >&2' ERR

[ "$DESDE" -gt 3 ] || : > "$ESTADO"
touch "$ESTADO"
guardar() { grep -v "^$1=" "$ESTADO" > "$ESTADO.tmp" || true; echo "$1=$2" >> "$ESTADO.tmp"; mv "$ESTADO.tmp" "$ESTADO"; }
leido() { grep "^$1=" "$ESTADO" | tail -n1 | cut -d= -f2 || true; }
minutos() { awk -v s="$1" 'BEGIN { printf "%.1f", s / 60 }'; }

fase() {
  local n=$1 nombre=$2
  if [ "$n" -lt "$DESDE" ]; then echo "── Fase $n: $nombre (ya hecha; se conserva su tiempo)"; return; fi
  FASE_ACTUAL=$n
  echo; echo "── Fase $n: $nombre"
  local t0; t0=$(date +%s)
  "fase$n"
  local s=$(( $(date +%s) - t0 ))
  guardar "fase$n" "$s"
  echo "   Fase $n lista en $(minutos "$s") min"
}

esperar_salud() {
  for _ in $(seq 1 90); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PUERTO/api/health" || true)" = "200" ]; then return 0; fi
    sleep 2
  done
  journalctl -u mauidesk -n 50 --no-pager || true
  echo "El servicio no respondió 200 en /api/health" >&2
  return 1
}

fase3() {
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl build-essential sqlite3 rclone netcat-openbsd
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  fi
  echo "Node $(node --version) · npm $(npm --version)"
}

npm_ci() { npm ci || { echo "npm ci falló; se reintenta con npm 11"; npx --yes npm@11 ci; }; }

fase4() {
  if [ -d "$MAUI_DIR/.git" ]; then
    git -C "$MAUI_DIR" fetch --tags
  else
    [ -n "$REPO" ] || { echo "falta --repo para clonar en $MAUI_DIR" >&2; return 1; }
    git clone "$REPO" "$MAUI_DIR"
  fi
  git -C "$MAUI_DIR" checkout "$ETIQUETA"
  local t0 s1 s2
  cd "$SERVER" && npm_ci
  t0=$(date +%s); npm run build; s1=$(( $(date +%s) - t0 ))
  cd "$MAUI_DIR/client" && npm_ci
  t0=$(date +%s); npm run build; s2=$(( $(date +%s) - t0 ))
  guardar compilacion $(( s1 + s2 ))
  echo "Compilación: server $(minutos "$s1") min + client $(minutos "$s2") min"
}

fase5() {
  local ip jwt
  ip="$(hostname -I | awk '{print $1}')"
  jwt="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  [ ! -f "$SERVER/.env" ] || cp "$SERVER/.env" "$SERVER/.env.antes-de-instalar"
  {
    echo "PORT=$PUERTO"
    echo "NODE_ENV=production"
    echo "JWT_SECRET=$jwt"
    echo "ALLOWED_ORIGINS=http://$ip:$PUERTO,http://mauidesk.local:$PUERTO"
    echo "DATABASE_URL=file:$BASE"
    echo "MAUI_LOCAL_ID=1"
    echo "PRINTER_TYPE=tcp"
    if [ "$MODO_PRUEBAS" -eq 1 ]; then
      echo "# Modo de pruebas: base simulada, impresora simulada en 127.0.0.1:9100 y perfil de desarrollador"
      echo "MAUI_MODO_PRUEBAS=1"
      echo "PRINTER_HOST=127.0.0.1"
      echo "PRINTER_PORT=9100"
      echo "BACKUP_SCRIPT=$BACKUP_SH"
      echo "MAUI_BACKUP_DIR=$BACKUP_DIR"
      echo "MAUI_RCLONE_REMOTO=$REMOTO"
    else
      echo "PRINTER_HOST=$IMPRESORA"
      echo "PRINTER_PORT=9100"
    fi
  } > "$SERVER/.env"
  chmod 600 "$SERVER/.env"
  echo "server/.env escrito (DATABASE_URL=file:$BASE)"
}

fase6() {
  if [ "$MODO_PRUEBAS" -eq 1 ]; then
    echo "Modo de pruebas: la impresora es la simulada del servidor (127.0.0.1:9100); no hay nada que configurar"
    return 0
  fi
  ping -c 3 "$IMPRESORA"
  nc -zv -w 5 "$IMPRESORA" 9100
}

fase7() {
  cd "$SERVER"
  if [ "$MODO_PRUEBAS" -eq 1 ]; then
    DATABASE_URL="file:$BASE" npm run db:sim
    npm run dev:usuario -- "$DEV_USUARIO" "$DEV_CLAVE"
  else
    [ ! -f "$BASE" ] || { echo "Ya existe $BASE: la base nueva no pisa una existente" >&2; return 1; }
    npm run db:push -- --force
    npm run db:seed
    local salida
    salida="$(npm run db:migrate 2>&1)"
    echo "$salida" | tail -n 3
    [[ "$salida" == *"[migrate] OK"* ]] || { echo "db:migrate no terminó en [migrate] OK" >&2; return 1; }
    npm run db:recetas
  fi
}

fase8() {
  sudo tee /etc/systemd/system/mauidesk.service > /dev/null <<EOF
[Unit]
Description=MauiDesk POS Server
After=network-online.target
Wants=network-online.target
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$SERVER
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=TZ=America/Lima
EnvironmentFile=$SERVER/.env

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable mauidesk
  sudo systemctl restart mauidesk
  esperar_salud
  journalctl -u mauidesk -n 15 --no-pager || true
}

# Pedido, comanda, cobro y boleta por la API. Fuera del modo de pruebas no imprime en la
# ticketera real ni deja ventas en la base del local: solo comprueba sesión, menú e impresora.
fase9() {
  local usuario clave completa
  if [ "$MODO_PRUEBAS" -eq 1 ]; then usuario=sim-cajero; clave=sim12345; completa=1; else usuario=admin; clave=admin123; completa=0; fi
  BASE_URL="http://127.0.0.1:$PUERTO" USUARIO="$usuario" CLAVE="$clave" COMPLETA="$completa" node --input-type=module <<'EOF'
const base = process.env.BASE_URL
const ok = (cond, msg) => { if (!cond) { console.error(`FALLA: ${msg}`); process.exit(1) } console.log(`   ok  ${msg}`) }
const json = async r => { try { return await r.json() } catch { return null } }
const pedir = (metodo, ruta, token, body) => fetch(base + ruta, {
  method: metodo,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
})
let r = await pedir('POST', '/api/auth/login', null, { username: process.env.USUARIO, password: process.env.CLAVE })
ok(r.status === 200, `inicio de sesión como ${process.env.USUARIO}`)
const { token } = await json(r)
r = await pedir('GET', '/api/menu', token)
ok(r.status === 200, 'menú')
const plato = (await json(r)).flatMap(c => c.dishes).find(d => d.available !== false)
ok(!!plato, 'hay un plato disponible')
if (process.env.COMPLETA === '1') {
  const mesa = ((await json(await pedir('GET', '/api/tables', token))) ?? []).find(m => m.active !== false && m.status === 'free')
  const items = [{ dishId: plato.id, quantity: 1 }]
  r = await pedir('POST', '/api/orders', token, mesa ? { type: 'dine_in', tableId: mesa.id, items } : { type: 'delivery', customerName: 'Prueba de instalación', items })
  ok(r.status === 201, 'pedido')
  const pedido = await json(r)
  await new Promise(s => setTimeout(s, 2000))
  const completo = await json(await pedir('GET', `/api/orders/${pedido.id}`, token))
  ok(completo.items.every(i => i.kitchenPrinted), 'comanda impresa (impresora simulada)')
  const total = completo.items.reduce((s, i) => s + i.unitPrice * (i.quantity ?? 1), 0)
  r = await pedir('POST', '/api/bills', token, { orderId: pedido.id, paymentMethod: 'cash', cashReceived: total })
  ok(r.status === 201, 'cobro')
  const boleta = await json(r)
  r = await pedir('POST', `/api/print/reprint/${boleta.id}`, token)
  ok(r.status === 200, 'boleta impresa (impresora simulada)')
} else {
  const st = await json(await pedir('GET', '/api/print/status', token))
  ok(st?.ok === true, 'la ticketera responde (sin imprimir nada)')
  console.log('   La prueba con un pedido real (comanda, cobro y boleta en papel) es la Fase 9 de DEPLOYMENT.md, con el propietario.')
}
EOF
}

fase10() {
  if [ -z "$TS_AUTHKEY" ]; then
    echo "Sin --tailscale-authkey: se omite (se puede hacer después con la Fase 10 de DEPLOYMENT.md)"
    guardar fase10_omitida 1
    return 0
  fi
  command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up --authkey "$TS_AUTHKEY" --hostname mauidesk
  tailscale ip -4 || true
}

fase11() {
  mkdir -p "$BACKUP_DIR" "$HOME_DIR/.config/rclone"
  cp "$RCLONE_CONF" "$HOME_DIR/.config/rclone/rclone.conf"
  chmod 600 "$HOME_DIR/.config/rclone/rclone.conf"
  cat > "$BACKUP_SH" <<EOF
#!/bin/bash
# Respaldo diario de MauiDesk (instalar.sh, Fase 11 de DEPLOYMENT.md)
set -e
DATE=\$(date +%Y%m%d-%H%M)
DEST=$BACKUP_DIR/$PREFIJO-\$DATE.db
# Copia atómica de SQLite (más seguro que cp mientras el servidor corre)
sqlite3 $BASE ".backup '\$DEST'"
gzip "\$DEST"
rclone copy "\$DEST.gz" $REMOTO
# Borrar respaldos con más de 30 días
find $BACKUP_DIR/ -name "$PREFIJO-*.db.gz" -mtime +30 -delete
EOF
  chmod +x "$BACKUP_SH"
  ( crontab -l 2>/dev/null | grep -v "$BACKUP_SH" || true; echo "0 3 * * * $BACKUP_SH >> $BACKUP_DIR/backup.log 2>&1" ) | crontab -
  "$BACKUP_SH"
  ls -l "$BACKUP_DIR" | tail -n 3
  rclone lsl "$REMOTO" | tail -n 3
}

fase 3 "Dependencias del sistema y Node 24"
fase 4 "Código ($ETIQUETA) y compilación"
fase 5 "Variables de entorno (server/.env)"
fase 6 "Impresora"
fase 7 "Base de datos"
fase 8 "systemd: arranque automático"
fase 9 "Prueba de extremo a extremo por la API"
fase 10 "Tailscale"
fase 11 "Respaldos diarios"
FASE_ACTUAL=""

# Tiempos: fases 1 y 2 a mano, 3 a 11 cronometradas; null = sin dato
f1="null"; f2="null"
if [ -n "$FASES12" ]; then
  if [[ "$FASES12" == *,* ]]; then f1="${FASES12%%,*}"; f2="${FASES12##*,}"; else f1="$FASES12"; fi
fi
lista="$f1, $f2"
for n in 3 4 5 6 7 8 9 10 11; do
  s="$(leido "fase$n")"
  if [ "$n" -eq 10 ] && [ -n "$(leido fase10_omitida)" ]; then lista="$lista, null"
  elif [ -n "$s" ]; then lista="$lista, $(minutos "$s")"
  else lista="$lista, null"; fi
done
comp="$(leido compilacion)"
mkdir -p "$SERVER/data/dev"
cat > "$SERVER/data/dev/instalacion-tiempos.json" <<EOF
{
  "fases_min": [$lista],
  "compilacion_min": $([ -n "$comp" ] && minutos "$comp" || echo null),
  "fecha": "$(date '+%Y-%m-%dT%H:%M:%S')",
  "etiqueta": "$ETIQUETA"
}
EOF
echo
echo "=== Instalación terminada: $SERVER/data/dev/instalacion-tiempos.json"
cat "$SERVER/data/dev/instalacion-tiempos.json"
if [ "$MODO_PRUEBAS" -eq 1 ]; then
  echo "Entra como $DEV_USUARIO en http://$(hostname -I | awk '{print $1}'):$PUERTO → Desarrollador."
else
  echo "Cambia las contraseñas seed (admin123, cajero123, mozo123) desde Usuarios y haz la Fase 9 con el propietario."
fi
