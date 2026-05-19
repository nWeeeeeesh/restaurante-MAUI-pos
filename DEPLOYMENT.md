# Deploy en Raspberry Pi 5 — MauiDesk

Guía paso a paso para desplegar MauiDesk en la Cevichería MAUI. Hardware objetivo: Raspberry Pi 5 + SSD USB + impresora POS-D Basic 200 por Ethernet.

## Hardware necesario

| Item | Detalle | Precio aprox. (Perú) |
|---|---|---|
| Raspberry Pi 5 4GB | El servidor | S/.400-500 |
| SSD USB 64-128 GB | **No usar microSD** — se corrompe con la DB en 1-2 años | S/.150-200 |
| Caja **para Pi 5** con disipador + ventilador | La caja del Pi 4 no calza | S/.50-100 |
| Fuente oficial 5V/**5A** | El Pi 5 necesita 5A (la del Pi 4 no alcanza) | S/.80-100 |
| Cable Ethernet (Pi → router) | Más estable que WiFi para el server | S/.10-30 |
| Cable Ethernet (impresora → router) | Para la POS-D Basic 200 | S/.10-30 |
| UPS mini (opcional) | Aguanta apagones de 10-30 min | S/.150-250 |

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

## Fase 1 — Preparar el SSD y bootear el Pi

1. En tu PC, descargar **Raspberry Pi Imager** desde https://www.raspberrypi.com/software/
2. Conectar el SSD USB a la PC.
3. En Imager seleccionar:
   - Device: **Raspberry Pi 5**
   - OS: **Raspberry Pi OS Lite (64-bit)** — sin escritorio, más liviano
   - Storage: el SSD USB
4. Antes de "Write", abrir **Edit Settings**:
   - Hostname: `mauidesk`
   - Username: `mauidesk` / Password: una fuerte que recuerdes
   - Configurar WiFi (como backup, aunque usaremos Ethernet)
   - Locale: `America/Lima`
   - **Habilitar SSH** con password
5. Flashear y esperar.
6. Conectar el SSD al **puerto USB 3.0 (azul)** del Pi 5.
7. Conectar el Pi por cable Ethernet al router.
8. Enchufar la fuente. El Pi arranca desde el SSD automáticamente.

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

# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar
node --version    # v20.x.x
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
npm run db:push    # crea tablas
npm run db:seed    # inserta usuarios y menú demo
```

**Importante:** después del primer arranque, **entrá por la web y cambiá las contraseñas seed (`admin123`, `cajero123`, `mozo123`)**.

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

Debería aparecer `MauiDesk server running on port 3001`.

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

**Opcional — Sincronizar backups a Google Drive con `rclone`** (muy recomendado: el SSD se puede quemar):
```bash
sudo apt install -y rclone
rclone config         # seguir el wizard, configurar "gdrive" como remote
```

Luego al final del `backup.sh` agregar:
```bash
rclone copy "$DEST.gz" gdrive:MauiDeskBackups/
```

## Fase 12 — Mantenimiento

| Tarea | Comando |
|---|---|
| Ver logs en vivo | `journalctl -u mauidesk -f` |
| Reiniciar el server | `sudo systemctl restart mauidesk` |
| Actualizar código (git) | `cd ~/MAUI && git pull && cd server && npm ci && npm run build && cd ../client && npm ci && npm run build && sudo systemctl restart mauidesk` |
| Backup manual | `/home/mauidesk/backup.sh` |
| Probar puerto impresora | `nc -zv 192.168.1.100 9100` |
| Espacio en disco | `df -h` |
| Limpiar logs viejos | `sudo journalctl --vacuum-time=30d` |

## Checklist final pre-producción

- [ ] El Pi arranca solo después de cortar la luz y volverla
- [ ] El server arranca automáticamente al bootear (`systemctl is-enabled mauidesk` → enabled)
- [ ] El server se reinicia solo si crashea (probar con `sudo kill -9 $(pgrep -f 'node dist/index.js')`)
- [ ] El cajero puede cobrar y la boleta sale por la impresora
- [ ] Los mozos pueden tomar pedidos desde celular y la comanda sale en cocina
- [ ] Las contraseñas seed (admin123, cajero123, mozo123) fueron cambiadas
- [ ] El dueño accede desde fuera vía Tailscale
- [ ] Hay un backup en `/home/mauidesk/backups/` con fecha de hoy
- [ ] Si tenés UPS, probar apagón y verificar que el sistema vuelve solo

## Troubleshooting

**El server no arranca**: `journalctl -u mauidesk -n 100 --no-pager`. Causas frecuentes:
- `JWT_SECRET` falta o < 32 chars → el código aborta intencionalmente
- Ruta de `DATABASE_URL` inaccesible
- Puerto 3001 ya en uso

**La impresora no imprime**: probar `nc -zv 192.168.1.100 9100`. Si falla, problema de red/IP/impresora apagada. La app muestra el error en pantalla al fallar el pre-check.

**El celular no conecta**: debe estar en la **misma WiFi** que el Pi. Verificar `ping 192.168.1.50` desde otro dispositivo conectado a la misma red.

**Después de un corte de luz la DB se corrompió**: por eso usamos `.backup` (atómico) en el script de backup, no `cp`. Restaurar el último backup:
```bash
sudo systemctl stop mauidesk
gunzip -c /home/mauidesk/backups/mauidisk-<fecha>.db.gz > /home/mauidesk/MAUI/server/mauidisk.db
sudo systemctl start mauidesk
```

**Logs llenan el SSD**: journalctl rota solo, pero podés limitarlo: `sudo journalctl --vacuum-time=30d`.

**Cambiar la IP del Pi o de la impresora**: actualizar el `.env`, `sudo systemctl restart mauidesk`, y recordar actualizar también los bookmarks de los celulares.
