# Deploy en Raspberry Pi 5 — MauiDesk

Guía paso a paso para desplegar MauiDesk en la Cevichería MAUI. Hardware objetivo: Raspberry Pi 5 + SSD USB + impresora POS-D Basic 200 por Ethernet.

## Hardware

| Item | Estado | Detalle |
|---|---|---|
| Raspberry Pi 5 4GB | ✓ disponible | El servidor |
| Caja con ventilador | ✓ disponible | Refrigeración del SoC |
| microSD | ✓ disponible | Solo para el primer arranque: **reemplazar por SSD** (ver nota) |
| SSD USB / NVMe | **requerido** (v1.1) | Disco de producción del sistema y la base de datos |
| Fuente 5V/5A USB-C | a confirmar | El Pi 5 falla con fuentes < 5A o no oficiales |
| Cable Ethernet × 2 | a confirmar | Uno para el Pi al router, otro para la impresora |
| UPS mini (opcional) | opcional | Aguanta apagones de 10-30 min |

### Nota sobre microSD vs SSD USB

La microSD tiene ciclos limitados de escritura. SQLite hace muchos writes
(cada pedido = varios). En operación normal (50 pedidos/día) una microSD
barata dura 6-18 meses; una buena (SanDisk High Endurance, Samsung Pro
Endurance) llega a 2-3 años.

**Mitigación**: el backup diario automatizado en Fase 11 cubre este riesgo —
si la SD muere, restaurás el último backup en una SD nueva y volvés a operar
en ~30 min.

**Migración a SSD USB** (requerida desde v1.1: es la base de datos de las ventas):
1. Apagar el Pi.
2. Conectar SSD USB a tu PC.
3. Clonar la SD al SSD con Raspberry Pi Imager (opción "Use custom image" →
   apuntar a la imagen de la SD) o con `dd`/`rpi-clone`.
4. Cambiar `BOOT_ORDER` del Pi para que priorice USB sobre SD (opcional).
5. Reemplazar la SD por el SSD en el Pi. Listo.

## Arquitectura del despliegue

```
┌── LAN del restaurante (WiFi del router) ─────────────────────────┐
│                                                                  │
│  📱 Mozo ─────┐                                                  │
│  📱 Cajero ───┤                                                  │
│  📱 Dueño ────┤                                                  │
│              │                                                   │
│         ┌────▼────────┐     LAN cable     ┌─────────────────┐    │
│         │ Pi 5        │ ───────────────── │ POS-D Basic 200 │    │
│         │ 192.168.1.50│      9100/tcp     │ 192.168.1.100   │    │
│         │ + SSD USB   │                   └─────────────────┘    │
│         │ + Node.js   │                                          │
│         └─────┬───────┘                                          │
│               │                                                  │
│         Tailscale (VPN privada — solo el dueño)                  │
└───────────────┼──────────────────────────────────────────────────┘
                │
                ▼
       🌐 Internet (solo para Tailscale; el local opera sin internet)
                │
                ▼
       📱 Dueño desde fuera del local
```

---

## Fase 1 — Flashear la microSD y bootear el Pi

1. En tu PC, descargar **Raspberry Pi Imager** desde https://www.raspberrypi.com/software/
2. Insertar la microSD en la PC (adaptador USB o ranura SD).
3. En Imager seleccionar:
   - Device: **Raspberry Pi 5**
   - OS: **Raspberry Pi OS Lite (64-bit)** — sin escritorio, más liviano
   - Storage: la microSD
4. Antes de "Write", abrir **Edit Settings**:
   - Hostname: `mauidesk`
   - Username: `mauidesk` / Password: una fuerte que recuerdes
   - Configurar WiFi (como backup, aunque usaremos Ethernet)
   - Locale: `America/Lima`
   - **Habilitar SSH** con password
5. Flashear y esperar.
6. Insertar la microSD en el slot del Pi 5.
7. Conectar el Pi por cable Ethernet al router.
8. Enchufar la fuente. El Pi arranca desde la SD automáticamente.

## Fase 2 — IP estática y SSH

1. Entrar al admin del router (típicamente `http://192.168.1.1`).
2. Buscar el Pi por hostname `mauidesk` o por MAC.
3. **Reservar la IP** del Pi en una fija — por ejemplo `192.168.1.50`.
4. **Reservar también la IP** de la impresora POS-D Basic 200 — por ejemplo `192.168.1.100`.
5. Desde tu PC, conectar por SSH:
   ```bash
   ssh mauidesk@192.168.1.50
   ```

## Fase 3 — Instalar dependencias del sistema

Por SSH en el Pi:

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y git curl build-essential

# Node.js 24 LTS via NodeSource (Node 20 quedó fuera de soporte en abril de 2026;
# los package.json exigen >= 22)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar
node --version    # v24.x.x
npm --version
```

## Fase 4 — Subir el código

**Opción A — Vía rsync desde tu PC** (recomendada mientras no haya repo en GitHub):

Desde PowerShell en tu PC Windows:
```powershell
scp -r D:\WebDevelopment\MAUI mauidesk@192.168.1.50:/home/mauidesk/
```

**Opción B — Vía git** (cuando subas el proyecto a GitHub):
```bash
cd /home/mauidesk
git clone <tu-repo-url> MAUI
```

Compilar:
```bash
cd /home/mauidesk/MAUI/server
npm ci
npm run build

cd ../client
npm ci
npm run build       # genera client/dist
```

## Fase 5 — Configurar variables de entorno

```bash
cd /home/mauidesk/MAUI/server
cp .env.example .env

# Generar un JWT_SECRET nuevo
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# Copiar la salida y pegarla como JWT_SECRET en .env

nano .env
```

Configurar:

```env
PORT=3001
NODE_ENV=production

JWT_SECRET=<el hex de 96 chars generado>

ALLOWED_ORIGINS=http://192.168.1.50:3001

DATABASE_URL=file:/home/mauidesk/MAUI/server/mauidisk.db

# Número del local: 1 en el principal, 2 en el segundo (cada uno con su Pi y su base)
MAUI_LOCAL_ID=1

PRINTER_TYPE=tcp
PRINTER_HOST=192.168.1.100
PRINTER_PORT=9100
```

Guardar con `Ctrl+O`, salir con `Ctrl+X`.

## Fase 6 — Configurar la impresora POS-D Basic 200

1. Conectar la impresora por cable Ethernet al router.
2. Encenderla.
3. **Imprimir la hoja de configuración**: mantener apretado el botón FEED al encender (varía según el modelo — consultar el manual de la impresora). La impresora imprime su IP actual.
4. En el router, reservar esa MAC a `192.168.1.100` (el valor que pusiste en `.env`).
5. Reiniciar la impresora para que tome la IP fija.
6. Verificar conectividad desde el Pi:
   ```bash
   ping -c 3 192.168.1.100
   nc -zv 192.168.1.100 9100      # debe decir "succeeded"
   ```

## Fase 7 — Inicializar la base de datos

```bash
cd /home/mauidesk/MAUI/server
npm run db:push    # crea tablas — SOLO en la primera instalación
npm run db:seed    # inserta usuarios, menú demo e insumos iniciales
npm run db:migrate # aplica las migraciones de arranque (índices, auditoría, WAL)
```

**Importante:**
- después del primer arranque, **entrá por la web y cambiá las contraseñas seed (`admin123`, `cajero123`, `mozo123`)**. Mientras no lo hagas, el server lo avisa en el log al arrancar.
- **Nunca** ejecutes `db:push` en actualizaciones: los cambios de esquema los aplica `migrate.ts` (ver Fase 12).

## Fase 8 — systemd: arranque automático

```bash
sudo nano /etc/systemd/system/mauidesk.service
```

Pegar:

```ini
[Unit]
Description=MauiDesk POS Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mauidesk
WorkingDirectory=/home/mauidesk/MAUI/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
# "Hoy", los reportes y las horas de los tickets usan la zona del proceso
Environment=TZ=America/Lima
EnvironmentFile=/home/mauidesk/MAUI/server/.env

# Limitar reinicios para evitar loops infinitos si hay un crash recurrente
StartLimitBurst=5
StartLimitIntervalSec=60

[Install]
WantedBy=multi-user.target
```

Activar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable mauidesk      # arrancar al boot
sudo systemctl start mauidesk       # arrancar ahora
sudo systemctl status mauidesk      # verificar
```

Ver logs en vivo:
```bash
journalctl -u mauidesk -f
```

Debería aparecer `MauiDesk server running on port 3001` y **ninguna** línea `[startup] ATENCIÓN` (zona horaria distinta de Lima o contraseñas por defecto).

## Fase 9 — Probar end-to-end

Desde un celular conectado al WiFi del local:

1. Abrir el navegador → `http://192.168.1.50:3001`
2. Login con `admin` / `admin123`
3. **Cambiar contraseñas seed inmediatamente** desde `/admin/users`
4. Crear un pedido de prueba en una mesa
5. Verificar que la impresora imprime la comanda
6. Cobrar y verificar que imprime la boleta

## Fase 10 — Tailscale (acceso remoto del dueño)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Se imprime un link en pantalla → abrirlo en cualquier dispositivo y loguear con la cuenta del dueño. El Pi ahora tiene una IP estable `100.x.x.x` accesible desde cualquier lado con la app Tailscale instalada y logueada con la misma cuenta.

El dueño instala Tailscale en su celular (Play Store / App Store) y desde fuera del local accede vía `http://100.x.x.x:3001`.

**Importante:** los mozos siguen accediendo por `192.168.1.50:3001` desde la WiFi local. Tailscale es solo para el dueño.

## Fase 11 — Backups diarios

Instalar sqlite3 y crear el script:

```bash
sudo apt install -y sqlite3
mkdir -p /home/mauidesk/backups
nano /home/mauidesk/backup.sh
```

Contenido:

```bash
#!/bin/bash
set -e
DATE=$(date +%Y%m%d-%H%M)
DEST=/home/mauidesk/backups/mauidisk-$DATE.db

# Copia atómica de SQLite (más seguro que cp mientras el server está corriendo)
sqlite3 /home/mauidesk/MAUI/server/mauidisk.db ".backup '$DEST'"
gzip "$DEST"

# Borrar backups con más de 30 días
find /home/mauidesk/backups/ -name "mauidisk-*.db.gz" -mtime +30 -delete
```

Permisos y cron:
```bash
chmod +x /home/mauidesk/backup.sh
crontab -e
```

Agregar:
```
0 3 * * * /home/mauidesk/backup.sh >> /home/mauidesk/backups/backup.log 2>&1
```

Corre todos los días a las 3 AM y mantiene 30 días de historia.

**Obligatorio — Copia fuera del local con `rclone`** (un backup que vive en el mismo disco no sirve si el disco muere, se roban el equipo o hay un incendio):
```bash
sudo apt install -y rclone
rclone config         # seguir el wizard, configurar "gdrive" (o Backblaze B2) como remote
```

Luego al final del `backup.sh` agregar:
```bash
rclone copy "$DEST.gz" gdrive:MauiDeskBackups/
```

> La base usa modo WAL desde v1.1: además de `mauidisk.db` existen `mauidisk.db-wal` y `mauidisk.db-shm`. `sqlite3 .backup` los consolida en un único archivo, por eso el script no cambia.

### Restaurar un backup

El script `server/scripts/restore-backup.sh` restaura un backup (`.db.gz` del backup diario o `.db` como `pre-update.db`) en la ruta que le indiques. **Nunca sobrescribe**: si el destino (o un `-wal`/`-shm` con ese nombre) ya existe, aborta. Antes de dejar el archivo en su lugar verifica el gzip, corre `PRAGMA integrity_check` y muestra un resumen (boletas, total cobrado, última boleta, pedidos) para compararlo con el local.

```bash
chmod +x /home/mauidesk/MAUI/server/scripts/restore-backup.sh   # una vez
```

**A. Probar un backup sin tocar la base activa** (hacerlo al menos una vez al mes y después de cada cambio de equipo; un backup nunca restaurado no está probado):

```bash
cd /home/mauidesk/MAUI/server
./scripts/restore-backup.sh /home/mauidesk/backups/mauidisk-<fecha>.db.gz /tmp/prueba.db
# Opcional: ver los reportes de esa copia con una segunda instancia en otro puerto
# (aplica las migraciones a la COPIA; no imprimir nada desde ella)
DATABASE_URL=file:/tmp/prueba.db PORT=3002 node dist/index.js
# → abrir http://192.168.1.50:3002, revisar Historial y Reportes, luego Ctrl+C
rm /tmp/prueba.db
```

Para probarlo en otra máquina: bajar el `.gz` desde la copia externa (`rclone copy gdrive:MauiDeskBackups/mauidisk-<fecha>.db.gz .`) y correr el mismo script allí.

**B. Reemplazar la base activa** (base dañada, equipo nuevo o datos perdidos). La base actual no se borra: se aparta con sus archivos de WAL, por si hace falta rescatar algo de ella.

```bash
sudo systemctl stop mauidesk
cd /home/mauidesk/MAUI/server
# 1. Apartar la base actual completa (la .db y sus auxiliares van juntos)
APARTE=/home/mauidesk/backups/danada-$(date +%Y%m%d-%H%M)
mkdir -p "$APARTE"
mv mauidisk.db mauidisk.db-wal mauidisk.db-shm "$APARTE"/ 2>/dev/null || true
# 2. Restaurar el backup elegido en la ruta de DATABASE_URL (ahora libre)
./scripts/restore-backup.sh /home/mauidesk/backups/mauidisk-<fecha>.db.gz /home/mauidesk/MAUI/server/mauidisk.db
# 3. Migrar (por si el backup es de una versión anterior) y arrancar
npm run db:migrate          # debe terminar en "[migrate] OK"
sudo systemctl start mauidesk
journalctl -u mauidesk -n 50 --no-pager
```

Después: entrar como dueño y revisar que el Historial y los Reportes muestran lo esperado. Lo vendido entre la hora del backup y la falla **no está** en la base restaurada: anotarlo a partir de las boletas impresas.

## Fase 12 — Mantenimiento

| Tarea | Comando |
|---|---|
| Ver logs en vivo | `journalctl -u mauidesk -f` |
| Reiniciar el server | `sudo systemctl restart mauidesk` |
| Actualizar a una versión nueva | Ver *Actualizar a una versión nueva* (abajo) |
| Backup manual | `/home/mauidesk/backup.sh` |
| Probar puerto impresora | `nc -zv 192.168.1.100 9100` |
| Espacio en disco | `df -h` |
| Limpiar logs viejos | `sudo journalctl --vacuum-time=30d` |

### Actualizar a una versión nueva (con rollback)

Hacerlo en un momento sin servicio. Los cambios de base de datos de cada versión son **aditivos**, así que volver a la versión anterior del código funciona con la base nueva.

```bash
# 1. Backup previo, guardado también fuera del Pi
sqlite3 /home/mauidesk/MAUI/server/mauidisk.db ".backup '/home/mauidesk/backups/pre-update.db'"

# 2. Bajar la versión nueva (ej. la etiqueta maui-v1.1)
cd /home/mauidesk/MAUI && git fetch --tags && git checkout maui-v1.1

# 3. Detener el servicio (npm ci reemplaza node_modules) y compilar
sudo systemctl stop mauidesk
cd server && npm ci && npm run build
cd ../client && npm ci && npm run build

# 4. Aplicar y validar el esquema (NO usar db:push)
cd ../server && npm run db:migrate      # debe terminar en "[migrate] OK"
# Solo al actualizar a la versión con inventario: carga los insumos iniciales si
# aún no hay ninguno; con menú ya cargado no toca menú, mesas ni usuarios
npm run db:seed

# 5. Arrancar y revisar el log
sudo systemctl start mauidesk
journalctl -u mauidesk -n 50 --no-pager
```

Después: prueba de humo con un dispositivo por rol (pedido → comanda con el número de mesa correcto → cobro → boleta → reportes).

### Desplegar la entrega E1 del inventario (antes del 2026-11-09)

La E1 (plan de la tesis v3) agrega la «Compra del día» en dos partes, la configuración del estudio y el export final. Debe quedar desplegada **antes del inicio de la línea base (2026-11-09)**. Las migraciones son aditivas.

```bash
# 0. En una PC, probar primero la migración sobre una COPIA de la base de producción
#    (bajada del backup diario) — nunca sobre la del local:
#    gunzip -c mauidisk-<fecha>.db.gz > /tmp/copia.db
#    cd server && DATABASE_URL=file:/tmp/copia.db npm run db:migrate   # "[migrate] OK"
#    DATABASE_URL=file:/tmp/copia.db npm run db:seed                   # insumos, si no hay

# 1. En la Pi: backup previo (también fuera del local)
sqlite3 /home/mauidesk/MAUI/server/mauidisk.db ".backup '/home/mauidesk/backups/pre-e1.db'"

# 2. Agregar el número de local al .env (si falta, vale 1)
grep -q '^MAUI_LOCAL_ID=' /home/mauidesk/MAUI/server/.env || echo 'MAUI_LOCAL_ID=1' >> /home/mauidesk/MAUI/server/.env

# 3. Bajar la versión (la etiqueta que se cree para E1, p. ej. maui-v1.2) y compilar
cd /home/mauidesk/MAUI && git fetch --tags && git checkout <etiqueta-e1>
sudo systemctl stop mauidesk
cd server && npm ci && npm run build
cd ../client && npm ci && npm run build

# 4. Migrar y cargar los insumos del estudio (solo si la tabla está vacía)
cd ../server && npm run db:migrate      # debe terminar en "[migrate] OK"
npm run db:seed                          # "Supplies seeded." o nada si ya existían

# 5. Arrancar y revisar el log: debe decir "[startup] Local 1 (MAUI_LOCAL_ID)"
sudo systemctl start mauidesk
journalctl -u mauidesk -n 50 --no-pager
```

Después, con el dueño (no es código):
1. Entrar como dueño → Inventario → Insumos → **Estudio**: cargar las fechas del sorteo (línea base 2026-11-09, primer grupo 2027-01-11, segundo 2027-02-01, fin 2027-04-04, mariscos 2027-04-05, segundo local ~2026-12-28) y el orden sorteado.
2. Revisar que PESCADO, CALAMAR, PULPO, LANGOSTINO y CONCHAS figuren como críticos, activos y con su grupo.
3. Hacer una «Compra del día» de prueba con fecha de ayer y corregirla una vez (debe reemplazarse, no duplicarse).
4. El 2026-11-09, en «Al abrir», nota «Otro»: «Inicio de la línea base».

Si los insumos ya existían sin código o sin grupo, la migración los asigna por código (PESCADO → pescado, CALAMAR → calamar, PULPO/LANGOSTINO/CONCHAS → mariscos).

**Rollback:** `git checkout <versión anterior>` → `npm ci && npm run build` en server y client → `sudo systemctl restart mauidesk`. Restaurar `pre-update.db` solo si los datos se dañaron.

## Checklist final pre-producción

- [ ] El Pi arranca solo después de cortar la luz y volverla
- [ ] El server arranca automáticamente al bootear (`systemctl is-enabled mauidesk` → enabled)
- [ ] El server se reinicia solo si crashea (probar con `sudo kill -9 $(pgrep -f 'node dist/index.js')`)
- [ ] El cajero puede cobrar y la boleta sale por la impresora
- [ ] Los mozos pueden tomar pedidos desde celular y la comanda sale en cocina
- [ ] Las contraseñas seed (admin123, cajero123, mozo123) fueron cambiadas
- [ ] El dueño accede desde fuera vía Tailscale
- [ ] Hay un backup en `/home/mauidesk/backups/` con fecha de hoy **y su copia fuera del local**
- [ ] Se probó restaurar un backup con `restore-backup.sh` en otro equipo y los totales coinciden
- [ ] El sistema corre desde el SSD (no desde la microSD)
- [ ] El log de arranque no muestra avisos `[startup] ATENCIÓN`
- [ ] Si tenés UPS, probar apagón y verificar que el sistema vuelve solo

## Troubleshooting

**El server no arranca**: `journalctl -u mauidesk -n 100 --no-pager`. Causas frecuentes:
- `JWT_SECRET` falta o < 32 chars → el código aborta intencionalmente
- Ruta de `DATABASE_URL` inaccesible
- Puerto 3001 ya en uso
- `[FATAL] Falló una migración requerida` → el esquema no se pudo actualizar; correr `npm run db:migrate` para ver el detalle, o volver a la versión anterior (rollback)

**El log avisa "mesas con varios pedidos activos"**: hay mesas con más de un pedido abierto (datos anteriores a v1.1). El sistema funciona, pero conviene que el cajero cancele el pedido sobrante; al reiniciar, el índice de protección se crea solo.

**La impresora no imprime**: probar `nc -zv 192.168.1.100 9100`. Si falla, problema de red/IP/impresora apagada. La app muestra el error en pantalla al fallar el pre-check.

**El celular no conecta**: debe estar en la **misma WiFi** que el Pi. Verificar `ping 192.168.1.50` desde otro dispositivo conectado a la misma red.

**Después de un corte de luz la DB se corrompió**: por eso usamos `.backup` (atómico) en el script de backup, no `cp`. Restaurar el último backup como se indica en *Fase 11 → Restaurar un backup, caso B* (apartar la base dañada con su `-wal` y `-shm`, restaurar con el script, migrar y arrancar). No borrar el `-wal` a mano: puede contener las últimas ventas confirmadas.

**Logs llenan el SSD**: journalctl rota solo, pero podés limitarlo: `sudo journalctl --vacuum-time=30d`.

**Cambiar la IP del Pi o de la impresora**: actualizar el `.env`, `sudo systemctl restart mauidesk`, y recordar actualizar también los bookmarks de los celulares.
