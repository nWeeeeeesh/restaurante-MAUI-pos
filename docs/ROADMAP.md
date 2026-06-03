# ROADMAP.md — MauiDesk: del código al restaurante operando

> Plan por **hitos** para llevar MauiDesk desde el estado actual (producto
> funcional, sin desplegar) hasta su **objetivo final**: operación diaria de la
> Cevichería MAUI sobre una Raspberry Pi 5, con mozos, cajero y dueño usándolo
> desde sus celulares en la LAN del local.
>
> Contexto técnico: [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md),
> [BUSINESS_RULES.md](BUSINESS_RULES.md), [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md),
> [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md). Guía de despliegue base:
> [../DEPLOYMENT.md](../DEPLOYMENT.md).

---

## 🎯 Objetivo final (Definition of Done global)

El restaurante opera **100% en la LAN, sin depender de internet**:

- ✅ El servidor corre en una **Raspberry Pi 5**, arranca solo al encender y se
  reinicia solo si crashea (systemd).
- ✅ Los **mozos** toman pedidos desde su celular; la **comanda se imprime sola** en
  cocina (impresora térmica por Ethernet).
- ✅ El **cajero** cobra (efectivo/Yape/Plin), divide cuentas y la **boleta sale por
  la impresora**.
- ✅ El **dueño** ve reportes y administra menú/usuarios; puede entrar **desde fuera
  del local vía Tailscale**.
- ✅ Hay **backup diario automático** y un procedimiento de restauración probado.
- ✅ Las **contraseñas seed fueron cambiadas** y la app está instalada como **PWA**
  (ícono en la pantalla de inicio) en cada celular.

---

## Vista general de hitos

| Hito | Nombre | Objetivo | Bloquea a |
|---|---|---|---|
| **H0** | Documentación y base | Mapa técnico del sistema (✔ hecho) | — |
| **H1** | Correctitud y seguridad | Que cobrar sea correcto y autorizado | H5 |
| **H2** | Calidad y red de seguridad | Tests + limpieza antes de producción | H5 |
| **H3** | Robustez operacional | Índices, CRUD faltante, DX | — (paralelo) |
| **H4** | Preparación de hardware y red | Pi + impresora + IPs fijas listas | H5 |
| **H5** | Despliegue en la Pi | App corriendo en el Pi con systemd | H6 |
| **H6** | Puesta en marcha en sitio | E2E real + Tailscale + backups | H7 |
| **H7** | Operación con celulares | PWA + capacitación + rutina diaria | — (cierre) |

> **Camino crítico al objetivo:** H1 → H4 → H5 → H6 → H7. H2 y H3 elevan la
> calidad pero no bloquean un primer despliegue si se asume el riesgo.

---

## H0 — Documentación y base ✔ (completado)

- [x] Análisis técnico completo del repo en `docs/` (project, database, business, architecture).
- [x] Mapa de conocimiento y gotchas guardados en memoria del proyecto.

**Criterio de aceptación:** existe documentación que permite a cualquiera entender
el sistema sin leer todo el código. ✔

---

## H1 — Correctitud y seguridad (camino crítico)

> El cobro es lo que toca dinero. Antes de producción debe ser correcto y estar
> bien autorizado.

- [ ] **P1 — Numeración de boleta en el servidor.** Mover la generación de
  `receiptNumber` (`B001-NNNNN`) al backend, dentro de la transacción de cobro
  ([bills.ts](../server/src/routes/bills.ts)), eliminando el contador en
  `localStorage` ([store/receipt.ts](../client/src/store/receipt.ts)). Conservar el
  manejo de colisión (409 `RECEIPT_TAKEN`).
- [ ] **P2 — Unificar "hoy".** Crear un helper de rangos de fecha y usar límites de
  día **locales** consistentes en [bills.ts](../server/src/routes/bills.ts) y
  [reports.ts](../server/src/routes/reports.ts). Hoy reports usa UTC → corre ~5h.
- [ ] **P3 — Autorización de cobro.** Agregar `requireRole('owner','cashier')` a
  `POST /api/bills` y revisar mutaciones de `orders` sin rol.
- [ ] Alinear la validación de contraseña UI(4)/server(8) ([admin/Users.tsx](../client/src/pages/admin/Users.tsx) ↔ [schemas/users.ts](../server/src/schemas/users.ts)).

**Criterio de aceptación:** dos cajeros en celulares distintos pueden cobrar sin
colisión de número; un mozo NO puede cobrar por API; los reportes "hoy" coinciden
con el día local; la app no genera números de boleta en el cliente.

---

## H2 — Calidad y red de seguridad

> Sin esto el sistema funciona, pero cada cambio futuro es riesgoso.

- [ ] Extraer capa de servicio para **cobro/split** (`billing.service.ts`) desde
  los routers.
- [ ] **Tests de integración** del flujo de cobro/split sobre SQLite en memoria
  (cobro simple, parcial, división, colisión de boleta, cierre de orden).
- [ ] Representar **dinero en centavos** (`integer`) o utilidades de redondeo
  consistentes (hoy `real`/float).
- [ ] Eliminar **código muerto**: [mockData.ts](../client/src/data/mockData.ts),
  [Placeholder.tsx](../client/src/pages/Placeholder.tsx). Decidir el futuro de
  [Kitchen.tsx](../client/src/pages/Kitchen.tsx) (borrar o documentar como dormida).

**Criterio de aceptación:** `npm test` cubre el flujo de cobro y pasa; el repo no
tiene archivos muertos sin documentar.

---

## H3 — Robustez operacional (paralelo, no bloqueante)

- [ ] Índices en `order_items(order_id)`, `order_items(bill_id)`, `bills(paid_at)`,
  `orders(table_id, status)`.
- [ ] Usar `validateQuery` en `reports`/`bills`.
- [ ] CRUD de **gastos** (editar/borrar) — hoy solo alta y listado.
- [ ] Linter/formatter para el `server/` (el cliente ya tiene ESLint) + CI mínimo
  (typecheck + build + tests en push).

**Criterio de aceptación:** consultas frecuentes con índice; un gasto mal cargado
se puede corregir desde la app; el push corre verificación automática.

---

## H4 — Preparación de hardware y red (camino crítico)

> Ref: [../DEPLOYMENT.md](../DEPLOYMENT.md) Hardware + Fases 1, 2, 6.

- [ ] Confirmar **fuente 5V/5A USB-C oficial** y **2 cables Ethernet** (marcados "a
  confirmar" en DEPLOYMENT.md).
- [ ] Flashear **Raspberry Pi OS Lite 64-bit** con hostname `mauidesk`, SSH y
  locale `America/Lima` (Fase 1).
- [ ] **IP fija** del Pi (`192.168.1.50`) y de la **impresora** (`192.168.1.100`) por
  reserva DHCP en el router (Fase 2).
- [ ] Impresora **POS-D Basic 200 por Ethernet**, IP fija, verificar puerto 9100
  (`nc -zv 192.168.1.100 9100`) (Fase 6).
- [ ] (Opcional, recomendado) **UPS mini** para cortes de luz.

**Criterio de aceptación:** desde el Pi, `ping` al router y a la impresora OK, y el
puerto 9100 responde.

---

## H5 — Despliegue en la Pi (camino crítico)

> Ref: [../DEPLOYMENT.md](../DEPLOYMENT.md) Fases 3-8.

- [ ] Instalar Node.js 20 LTS + build-essential (Fase 3).
- [ ] Subir código (git clone o rsync) y compilar `server` + `client`
  (`npm ci && npm run build`) (Fase 4).
- [ ] Configurar `.env`: `JWT_SECRET` generado (≥32), `ALLOWED_ORIGINS`,
  `DATABASE_URL` absoluto, `PRINTER_TYPE=tcp` + host/puerto (Fase 5).
- [ ] Inicializar BD: `npm run db:push` + `npm run db:seed` (Fase 7).
- [ ] **systemd** `mauidesk.service`: `enable` + `start`, arranque al boot,
  `Restart=always` (Fase 8).

**Criterio de aceptación:** `systemctl status mauidesk` activo; en el log aparece
`MauiDesk server running on port 3001`; `http://192.168.1.50:3001` responde desde
otro dispositivo de la LAN.

---

## H6 — Puesta en marcha en sitio (camino crítico)

> Ref: [../DEPLOYMENT.md](../DEPLOYMENT.md) Fases 9-11 + checklist.

- [ ] **Prueba end-to-end real** (Fase 9): login → pedido en mesa → comanda impresa
  → agregar items → cobrar → boleta impresa → ver en reportes.
- [ ] **Cambiar contraseñas seed** (`admin123`/`cajero123`/`mozo123`) desde
  `/admin/users`.
- [ ] **Tailscale** para acceso remoto del dueño (Fase 10).
- [ ] **Backup diario** por cron + `.backup` atómico; (opcional) sincronizar a
  Google Drive con rclone (Fase 11).
- [ ] Probar **restauración** de un backup en limpio.
- [ ] Recorrer el **checklist pre-producción** completo de DEPLOYMENT.md (arranque
  tras corte de luz, reinicio tras crash, etc.).

**Criterio de aceptación:** el checklist final de [../DEPLOYMENT.md](../DEPLOYMENT.md)
queda 100% tildado.

---

## H7 — Operación con celulares (cierre)

> La app ya es **mobile-first**: bottom-nav móvil, `inputMode` decimal/tel,
> `safe-area-inset`, y **PWA instalable** ([manifest.webmanifest](../client/public/manifest.webmanifest),
> íconos 192/512, `display: standalone`, `start_url: /tables`).

- [ ] En cada celular: conectar al **WiFi del local**, abrir
  `http://192.168.1.50:3001`, **"Agregar a pantalla de inicio"** (queda como app
  standalone con su ícono), iniciar sesión y dejar la sesión guardada.
- [ ] Crear un **bookmark/ícono** por dispositivo (mozos y cajero) — recordar que la
  URL depende de la IP del Pi.
- [ ] **Capacitación corta por rol**:
  - Mozo: tomar pedido por mesa/delivery, agregar items, marcar para cobro.
  - Cajero: cobrar simple/parcial, dividir cuenta, pre-cuenta, reimprimir.
  - Dueño: reportes, gastos, menú, usuarios, acceso remoto Tailscale.
- [ ] (Mejora opcional) Corregir `apple-touch-icon` en
  [../client/index.html](../client/index.html) para que apunte a `icon-192.png`
  (hoy usa el SVG; iOS prefiere PNG).
- [ ] (Mejora opcional) Service worker para tolerar microcortes de WiFi (hoy la PWA
  es instalable pero **no offline**; aceptable porque el servidor está en la LAN).
- [ ] **Rutina diaria** acordada: al abrir, verificar que el Pi y la impresora
  respondan (pill de impresora en la app); al cerrar, confirmar que hubo backup.

**Criterio de aceptación:** mozos, cajero y dueño operan un servicio completo
**solo desde sus celulares**, con la app instalada como ícono y la comanda/boleta
saliendo por la impresora.

---

## Secuencia recomendada

```
H0 ✔ ──► H1 ──► H4 ──► H5 ──► H6 ──► H7  ◄── objetivo final
                 │
        (H2, H3 en paralelo cuando haya margen;
         idealmente H2 antes de tocar el código de cobro de nuevo)
```

**Sugerencia de mínimo viable a producción:** H1 (correctitud/seguridad) + H4 + H5
+ H6 + H7. H2 y H3 se pueden iterar con el sistema ya en uso, pero conviene cerrar
al menos los tests de cobro (H2) antes del primer servicio real con dinero.
