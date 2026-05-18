# Despliegue de MauiDesk

Guía pragmática para que el restaurante use el sistema desde celular sin tener que escribir URLs, con servidor siempre activo y acceso remoto del dueño desde casa.

## Resumen ejecutivo (recomendación)

Para el caso de Cevichería MAUI (uso primario en celular, una sola PC siempre encendida con la impresora térmica USB) la combinación ideal es:

1. **PC del local con Windows** corriendo el servidor 24/7 (auto-arranque al boot).
2. **Acceso LAN via IP fija + bookmark/PWA** en cada celular del personal.
3. **Acceso remoto del dueño** vía **Tailscale** (VPN privada gratis, instalación en 2 minutos por dispositivo) o **Cloudflare Tunnel** si prefiere una URL pública estable.
4. **Backup automático diario** del archivo SQLite a Drive/Dropbox.

## 1. Servidor siempre activo (Windows)

### Build y arranque en producción

```powershell
# En la PC del local, una sola vez:
cd D:\WebDevelopment\MAUI\client
npm run build              # genera client/dist/

cd D:\WebDevelopment\MAUI\server
npm run build              # compila TS a server/dist/
```

El servidor ya está configurado para servir el `client/dist` cuando existe (ver `server/src/index.ts`). Al levantar el server, ambos están en el mismo origen (`http://<ip>:3001`).

### Auto-arranque con `pm2`

```powershell
npm i -g pm2 pm2-windows-startup
pm2-startup install
cd D:\WebDevelopment\MAUI\server
pm2 start dist/index.js --name mauidesk
pm2 save
```

Con eso, si se corta la luz y vuelve, `pm2` re-lanza el server.

### Alternativa simple: `nssm`

```powershell
choco install nssm
nssm install MauiDesk "C:\Program Files\nodejs\node.exe" "D:\WebDevelopment\MAUI\server\dist\index.js"
nssm start MauiDesk
```

Lo registra como servicio de Windows y se reinicia automáticamente.

## 2. IP fija en la red local

El router del local debe asignar siempre la misma IP a la PC servidora.

- Entrá al router (suele ser `192.168.1.1` o `192.168.0.1`).
- "DHCP reservation" / "Bind IP-MAC" → asignar `192.168.1.50` (o lo que sea) a la MAC de la PC.
- Anotá esa IP. Será siempre la misma.

## 3. Mobile UX — Instalar como app (PWA)

Ya está implementado el manifest. Para usarlo:

### Android (Chrome / Edge)
1. Abrir `http://192.168.1.50:3001` en el celular.
2. Tocá los 3 puntos del menú → **"Instalar aplicación"** (o "Agregar a la pantalla de inicio").
3. Se crea un icono de **MauiDesk** en el home. Al tocarlo abre como app standalone (sin barra de URL, fullscreen).

### iOS (Safari)
1. Abrir la URL en Safari.
2. Tocar el botón **Compartir** → **"Agregar a la pantalla de inicio"**.
3. Mismo resultado: icono en home, abre fullscreen.

Esto resuelve el problema de "no quiero escribir el enlace": **los empleados solo tocan el icono de MauiDesk y entra**.

> **Nota**: hay que crear iconos PNG 192×192 y 512×512 reales y ponerlos en `client/public/icon-192.png` e `icon-512.png` (yo dejé el manifest apuntando a esos nombres + al SVG existente como fallback). Hasta que no existan los PNG, el icono usará el SVG y en algunos Android se verá pequeño.

## 4. Acceso remoto del dueño

El dueño quiere ver usuarios, mesas e ingresos desde su casa. Tres opciones, ordenadas por simplicidad:

### Opción A — Tailscale (recomendado, gratis, privado) ⭐

Tailscale es una VPN moderna que conecta dispositivos como si estuvieran en la misma red.

1. Crear cuenta gratis en https://tailscale.com (cuenta personal: hasta 100 dispositivos).
2. Instalar Tailscale en la PC del local y en el celular del dueño.
3. Login con la misma cuenta en ambos.
4. La PC del local recibe una IP `100.x.x.x` (Tailscale). El dueño abre `http://100.x.x.x:3001` desde donde sea — funciona como si estuviera en la red local.
5. Si el dueño quiere ver desde el navegador del laptop en su casa: idem, instala Tailscale ahí y accede.

**Ventajas**: gratis, sin abrir puertos del router, encriptado, sin URL pública expuesta.
**Contra**: cada dispositivo del dueño necesita Tailscale instalado.

### Opción B — Cloudflare Tunnel (URL pública estable, gratis)

Si el dueño prefiere algo como `https://maui.ejemplo.com` accesible sin instalar nada:

1. Crear cuenta gratis en https://dash.cloudflare.com (necesita un dominio; podés comprar uno barato en Namecheap, ~$10/año).
2. Instalar `cloudflared` en la PC del local.
3. `cloudflared tunnel login` → seguir el flow web.
4. `cloudflared tunnel create mauidesk` → crea el tunnel.
5. Configurar archivo `~/.cloudflared/config.yml` apuntando a `localhost:3001`.
6. `cloudflared tunnel route dns mauidesk maui.tudominio.com`.
7. `cloudflared tunnel run mauidesk` (o instalarlo como servicio).

**Ventajas**: URL pública, HTTPS gratis, no necesita IP fija ni abrir puertos.
**Contra**: requiere comprar dominio. Cuidado con qué exponés (recomiendo combinar con un middleware de IP whitelist o auth básica HTTP además del JWT).

### Opción C — Port forwarding del router (no recomendado)

Abrir el puerto 3001 del router al WAN. Funciona pero:
- Expone el server a internet sin filtros.
- Necesita IP pública estática o DDNS (No-IP, DuckDNS).
- Mayor superficie de ataque.

Solo si las otras dos no son posibles.

## 5. Backup automático del SQLite

El archivo `server/mauidisk.db` tiene todos los datos del negocio. **Sin backup, una falla del disco pierde todo el historial.**

Script PowerShell (correr a las 23:00 cada día):

```powershell
# backup-mauidesk.ps1
$src = "D:\WebDevelopment\MAUI\server\mauidisk.db"
$dst = "$env:USERPROFILE\Google Drive\MauiDesk-backups"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
$ts  = Get-Date -Format "yyyyMMdd-HHmm"
Copy-Item $src "$dst\mauidisk-$ts.db"
# Mantener solo los últimos 30 días
Get-ChildItem "$dst\mauidisk-*.db" | Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 30 | Remove-Item -Force
```

Programalo en Task Scheduler de Windows, trigger diario 23:00. Si el dueño tiene Drive/Dropbox sincronizando esa carpeta, el backup queda en la nube automáticamente.

## 6. Checklist de despliegue

- [ ] Build cliente: `npm run build` en `/client`
- [ ] Build server: `npm run build` en `/server`
- [ ] Cambiar `JWT_SECRET` en `.env` por algo único (no el de development)
- [ ] Cambiar las contraseñas iniciales (`admin/admin123`, etc.) → entrar como admin → Usuarios → cambiar.
- [ ] IP fija en el router para la PC del local
- [ ] `pm2` o `nssm` para auto-arranque
- [ ] Backup diario configurado en Task Scheduler
- [ ] Tailscale instalado en PC + celular del dueño
- [ ] PWA instalada en cada celular del personal (icono en home)
- [ ] Probar print desde 1 celular del staff conectado a wifi del local
- [ ] Probar acceso remoto del dueño (vía Tailscale) a `/admin/users` y `/reports`

## 7. Limitaciones conocidas

- **La impresora térmica solo funciona desde la PC del local** (USB), no desde el celular del dueño. Los celulares solo envían el "imprimir" al server, que dispara el print. Si el server está apagado, nadie imprime.
- **El acceso remoto requiere que la PC del local esté encendida**. Sin Internet en el local, ni el local ni el dueño pueden usar el sistema (es local-first).
- **Si querés cero dependencia del local** (que el sistema funcione aunque la PC esté apagada), hay que migrar a hosting cloud (Railway, Render). Eso implica:
  - Mover SQLite a Postgres o Turso (sqlite cloud).
  - La impresora deja de funcionar — habría que poner un mini-cliente en la PC del local que escuche eventos de impresión.
  - Costo: ~$5-10/mes.

  Por ahora **no lo recomiendo** para este caso. La PC del local prendida 12-14 horas con `pm2` cubre todo.
