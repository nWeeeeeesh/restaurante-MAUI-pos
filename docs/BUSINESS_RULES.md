# BUSINESS_RULES.md — MauiDesk

> Reglas de negocio **detectadas en el código** (no inventadas). Cada regla cita
> el archivo y, cuando aplica, la línea donde se implementa. Relacionado:
> [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md), [DATABASE_ANALYSIS.md](DATABASE_ANALYSIS.md),
> [ARCHITECTURE_MAP.md](ARCHITECTURE_MAP.md).

---

## 1. Roles y permisos

Tres roles: **owner** (dueño), **cashier** (cajero), **waiter** (mozo)
([middleware/auth.ts:7](../server/src/middleware/auth.ts)).

| Capacidad | owner | cashier | waiter |
|---|:---:|:---:|:---:|
| Ver/operar Mesas y Pedidos | ✅ | ✅ | ✅ |
| Cobrar en Caja (UI) | ✅ | ✅ | ❌ (oculto en UI) |
| Ver Historial de boletas | ✅ (cualquier fecha) | ✅ (solo hoy) | ✅ (solo hoy) |
| Reportes | ✅ | ❌ | ❌ |
| Admin Menú | ✅ | ❌ | ❌ |
| Admin Usuarios | ✅ | ❌ | ❌ |
| Gastos (alta/listado) | ✅ | ✅ | ❌ |
| Crear/editar mesas y plano | ✅ | ❌ | ❌ |

Fuentes: navegación por rol en [components/Layout.tsx:12-20](../client/src/components/Layout.tsx),
guardias de ruta en [App.tsx](../client/src/App.tsx) +
[components/ProtectedRoute.tsx:28](../client/src/components/ProtectedRoute.tsx),
y `requireRole(...)` en el servidor.

**Reglas de autorización en el servidor:**
- Todo endpoint salvo `/api/auth/*` y `/api/health` exige JWT (`requireAuth`).
- `requireRole('owner')`: gestión de menú, usuarios, mesas/plano.
- `requireRole('owner','cashier')`: reportes, gastos, limpiar cola de impresora.
- **Excepción / brecha:** `POST /api/bills` (cobrar) solo usa `requireAuth`, **no**
  `requireRole` — la restricción es solo de UI ([bills.ts:125](../server/src/routes/bills.ts)).
  Ver P3 en [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md).

---

## 2. Autenticación y sesión

- Login con `username` + `password`; bcrypt compara hash
  ([routes/auth.ts:22](../server/src/routes/auth.ts)).
- **Un usuario inactivo no puede iniciar sesión** (`!user.active` → 401)
  ([auth.ts:17](../server/src/routes/auth.ts)).
- JWT firmado con expiración **12h** ([auth.ts:31](../server/src/routes/auth.ts)),
  guardado en `localStorage` (`mauideskToken`).
- Cualquier respuesta **401** borra el token y redirige a `/login`
  ([api/client.ts:17-20](../client/src/api/client.ts)).
- El socket exige el **mismo JWT** en el handshake; sin token válido la conexión se
  rechaza ([index.ts:74-86](../server/src/index.ts), [api/socket.ts:10-13](../client/src/api/socket.ts)).
- **Arranque seguro:** el server **aborta** si `JWT_SECRET` falta o es < 32 chars
  ([index.ts:27-36](../server/src/index.ts)).

---

## 3. Pedidos (orders)

### 3.1 Creación
- Un pedido es **dine_in** (con `tableId`) o **delivery** (con datos de cliente)
  ([schemas/orders.ts:19-27](../server/src/schemas/orders.ts)).
- **Una sola orden activa por mesa:** al crear, si la mesa ya tiene una orden no
  pagada/cancelada → **409** ("La mesa ya tiene un pedido activo")
  ([orders.ts:117-124](../server/src/routes/orders.ts)). Es regla de aplicación,
  no constraint de BD.
- Al crear una orden dine_in, la mesa pasa a `occupied`
  ([orders.ts:155-157](../server/src/routes/orders.ts)).
- Para **enviar** un pedido nuevo desde la UI se exige: dine_in → mesa seleccionada;
  delivery → nombre **y** teléfono **y** dirección ([POS.tsx:278-280](../client/src/pages/POS.tsx)).

### 3.2 Items y modificadores
- Cada item lleva `dishName` y `unitPrice` como **snapshot** (no cambian si el
  menú cambia después).
- Un plato con `hasSpiceLevel` exige elegir **Nivel de Picante** (grupo `spice`,
  requerido) antes de agregarlo ([POS.tsx:102](../client/src/pages/POS.tsx),
  `canConfirm`).
- "Preferencias" (grupo `preference`) es **texto libre opcional** del mozo.
- "Nota para cocina" por item es libre y opcional; se imprime con `!` en la comanda.
- El `priceAdjustment` de los modificadores **no** se suma al total actualmente
  (el total es `unitPrice * quantity`).

### 3.3 Estados del pedido
`pending → preparing → ready → paid` (o `cancelled`).
- `paying` es un estado **solo de UI** para señalar "en caja"; **no se persiste**:
  el server lo mapea a `preparing` en BD ([orders.ts:286-289](../server/src/routes/orders.ts)).
- Marcar un item como listo/no-listo alterna su `status`; si **todos** los items
  quedan `ready`, la orden pasa a `ready`; si no, vuelve a `preparing`
  ([orders.ts:320-328](../server/src/routes/orders.ts)).
- **IDOR mitigado (C9):** al alternar un item se valida que el item pertenezca a la
  orden ([orders.ts:316-318](../server/src/routes/orders.ts)).

### 3.4 Cancelación
- Cancelar una orden la marca `cancelled` y libera la mesa (`free`)
  ([orders.ts:346-354](../server/src/routes/orders.ts)). La UI pide confirmación
  ([POS.tsx:331](../client/src/pages/POS.tsx)).

### 3.5 Sincronización de estado de mesa
La mesa refleja la orden ([orders.ts:294-298](../server/src/routes/orders.ts)):
`paying` → `paying`; `paid`/`cancelled` → `free`; cualquier otro → `occupied`.

---

## 4. Cocina e impresión

- **La cocina no tiene pantalla.** La ruta `/kitchen` está deshabilitada
  intencionalmente ([App.tsx:43](../client/src/App.tsx)); opera solo con la
  **comanda impresa**.
- **Auto-impresión de comanda** al crear orden ("COMANDA NUEVA") y al agregar items
  ("++ ITEMS AGREGADOS ++", solo los nuevos)
  ([orders.ts:20-82](../server/src/routes/orders.ts)).
- **Si la impresora falla, el pedido se guarda igual** (no se bloquea el flujo) y se
  emite `kitchen:print-result` con `ok:false` → toast de error en todos los
  dispositivos ([orders.ts:70-81](../server/src/routes/orders.ts),
  [store/orders.ts:147-164](../client/src/store/orders.ts)).
- **Pre-check obligatorio:** antes de enviar cualquier buffer ESC/POS se verifica
  conectividad; si la impresora no responde, error inmediato (**no se encolan
  trabajos**) ([printer.ts:299-305](../server/src/utils/printer.ts)).
- **Reimpresión manual de comanda:** solo items **no** `ready`; si no hay pendientes
  → 400 ([orders.ts:230-238](../server/src/routes/orders.ts)).
- Tipos de impresión: **comanda** (cocina), **pre-cuenta** ("No es comprobante de
  pago") y **boleta** ([printer.ts](../server/src/utils/printer.ts)).
- El texto se **sanitiza a ASCII** (sin tildes/ñ) para compatibilidad ESC/POS
  ([printer.ts:25-36](../server/src/utils/printer.ts)).
- **Cola atorada (solo Windows/dev):** si hay trabajos > 30s sin imprimir se reporta
  "cola atorada" y el owner/cashier puede limpiarla
  ([printer.ts:185,244](../server/src/utils/printer.ts), [routes/print.ts:40](../server/src/routes/print.ts)).

---

## 5. Cobro (bills) — reglas centrales

Endpoint: `POST /api/bills` ([bills.ts:125](../server/src/routes/bills.ts)),
todo dentro de una **transacción atómica**.

### 5.1 Modos de cobro
Según el body recibido:
1. **`billGroupId` + `itemIds`** → cobra solo esos items de la sub-cuenta (snapshot
   confirmado por el cajero; evita cobrar items que el mozo agregó mientras tanto).
2. **`billGroupId`** → cobra todos los items abiertos de esa sub-cuenta.
3. **`itemIds`** → cobra items específicos (cobro parcial).
4. **ninguno** → cobra **todos** los items aún no facturados (cobro simple completo).
   ([bills.ts:137-174](../server/src/routes/bills.ts))

### 5.2 Validaciones de cobro
- Solo se consideran items con `billId` nulo (no facturados).
- Si no hay items objetivo → 400 ("No hay items pendientes de cobro").
- **Efectivo:** `cashReceived` debe ser un número **≥ total** (validado en el
  handler porque requiere el total real) → 400 si falta
  ([bills.ts:184-191](../server/src/routes/bills.ts)).
- **Total** = Σ `unitPrice * quantity` de los items objetivo
  ([bills.ts:181](../server/src/routes/bills.ts)).
- `vuelto = cashReceived - total` (solo efectivo).

### 5.3 Numeración de boleta
- Formato **`B001-NNNNN`** (5 dígitos, padding) — generado en el **cliente** a
  partir de `lastNumber` en `localStorage`
  ([store/receipt.ts](../client/src/store/receipt.ts)).
- El cliente sincroniza su contador con el máximo del servidor vía
  `GET /api/bills/next-number` (cálculo SQL atómico)
  ([bills.ts:15-25](../server/src/routes/bills.ts), [Cash.tsx:844-850](../client/src/pages/Cash.tsx)).
- **Colisión:** pre-check dentro de la transacción → **409 `RECEIPT_TAKEN`**; la UI
  re-sincroniza y pide reintentar ([bills.ts:204-208](../server/src/routes/bills.ts),
  [Cash.tsx:957-979](../client/src/pages/Cash.tsx)).

### 5.4 Cierre de orden y sub-cuenta
- Una **sub-cuenta** (`bill_group`) se marca `paid` solo si tras el cobro **no le
  quedan items sin facturar** (cubre items agregados entre confirmar y cobrar)
  ([bills.ts:231-242](../server/src/routes/bills.ts)).
- La **orden** pasa a `paid` y su mesa a `free` solo cuando **no quedan items con
  `billId` nulo** en toda la orden ([bills.ts:244-259](../server/src/routes/bills.ts)).
- Eventos socket se emiten **post-commit**: `order:removed` si quedó totalmente
  pagada, o `order:updated` si fue parcial ([bills.ts:280-291](../server/src/routes/bills.ts)).

---

## 6. División de cuenta (split)

Endpoint: `POST /api/orders/:id/split` ([split.ts:41](../server/src/routes/split.ts)),
también en **transacción**.

- Una división nueva (sin grupos pagados) requiere **≥ 2 sub-cuentas** con items;
  si ya hay grupos pagados, basta **1** abierta ([split.ts:51-55](../server/src/routes/split.ts),
  espejo en UI [Cash.tsx:346-353](../client/src/pages/Cash.tsx)).
- **Validaciones de items** ([split.ts:62-72](../server/src/routes/split.ts)):
  - el item debe pertenecer al pedido,
  - no puede estar ya cobrado (`billId`),
  - no puede pertenecer a una sub-cuenta **ya pagada** (queda "bloqueado"),
  - no puede estar en más de una sub-cuenta.
- **Coexistencia pagadas/abiertas:** la operación solo reescribe los grupos
  **abiertos**; los pagados y sus items quedan intactos
  ([split.ts:80-108](../server/src/routes/split.ts)).
- Al **agregar items** a una orden con división ([orders.ts:194-212](../server/src/routes/orders.ts)):
  - 1 grupo abierto → auto-asigna los nuevos a ese grupo;
  - 0 abiertos y ≥1 pagado → crea un grupo nuevo (`Cuenta {letra}`) para hacerlos
    cobrables sin pasar por el modal;
  - 2+ abiertos → quedan sin asignar (el cajero decide en el modal).
- **Deshacer división** (`DELETE /split`) elimina solo los grupos abiertos; las
  sub-cuentas cobradas **no se pueden deshacer**
  ([split.ts:120-148](../server/src/routes/split.ts)).
- En la UI, máximo **6 sub-cuentas** ([Cash.tsx:277](../client/src/pages/Cash.tsx));
  el schema permite hasta 20 ([schemas/split.ts:7](../server/src/schemas/split.ts)).

---

## 7. Mesas y plano

- **Número de mesa único**; alta sin número → toma `max+1`
  ([tables.ts:50-61](../server/src/routes/tables.ts)). Duplicado → 409.
- **Borrado de mesa** ([tables.ts:83-110](../server/src/routes/tables.ts)):
  ocupada/por-cobrar → 409; con historial → **inhabilitar** (`active=false`,
  preserva reportes); sin historial → DELETE real.
- El **plano** usa un canvas virtual **1200×700**; mesas y decoraciones guardan
  `posX/posY` ([Tables.tsx:64-65](../client/src/pages/Tables.tsx)).
- Guardar layout **reemplaza** todas las decoraciones de una vez
  ([tables.ts:121-152](../server/src/routes/tables.ts)).
- "Restablecer mapa" borra posiciones y decoraciones (vuelve a vista lista) **sin
  borrar mesas ni grupos** ([Tables.tsx:472-493](../client/src/pages/Tables.tsx)).
- En la vista lista debe quedar **al menos un grupo/área**
  ([Tables.tsx:417-419](../client/src/pages/Tables.tsx)).

---

## 8. Menú

- Crear/editar/borrar requiere **owner**.
- Borrar **categoría** con platos → 409 (reasignar primero)
  ([menu.ts:75-87](../server/src/routes/menu.ts)).
- Borrar **plato** usado en pedidos → soft-disable (`available=false`)
  ([menu.ts:143-160](../server/src/routes/menu.ts)).
- Crear plato con `hasSpiceLevel` genera automáticamente grupos de picante
  (5 niveles) y preferencias ([menu.ts:109-123](../server/src/routes/menu.ts)).
- El menú que ve el POS solo incluye categorías `active` y platos `available`
  ([menu.ts:18-39](../server/src/routes/menu.ts)).

---

## 9. Usuarios

- Username normalizado a **minúsculas**, 3-40 chars, regex `[a-z0-9._-]`
  ([schemas/users.ts:7-8](../server/src/schemas/users.ts)).
- Contraseña: **mínimo 8 caracteres** en el servidor
  ([schemas/users.ts:3](../server/src/schemas/users.ts)).
  > ⚠ La UI dice "mínimo 4 caracteres" ([admin/Users.tsx:229,278](../client/src/pages/admin/Users.tsx))
  > — divergencia: el server rechazará 4-7 chars con 400.
- **No se puede inhabilitar ni degradar al último owner activo**
  ([users.ts:87-98](../server/src/routes/users.ts)).
- Username duplicado → 409 (en alta y edición).
- Cambio de contraseña propia exige la contraseña actual correcta
  ([users.ts:26-39](../server/src/routes/users.ts)); el owner puede resetear la de
  otros sin conocerla ([users.ts:108-120](../server/src/routes/users.ts)).
- `passwordHash` nunca se expone (función `publicShape`).

---

## 10. Reportes, gastos y balance

- Períodos: **today / week / month** ([reports.ts:11-23](../server/src/routes/reports.ts)).
  > ⚠ "today" en reportes arranca en **medianoche UTC** (en `bills`/historial es
  > medianoche **local**). En Perú difieren ~5h — ver P2 en [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md).
- `summary`: total de ventas, conteo de pedidos cobrados, desglose por método
  (cash/yape/plin), **top 8 platos** (por cantidad), ventas diarias.
- **Balance neto** = ventas − gastos del período
  ([Reports.tsx:172-173](../client/src/pages/Reports.tsx)).
- Reportes y gastos: **owner y cashier**. La página `/reports` (UI) es **solo
  owner** ([App.tsx:50-52](../client/src/App.tsx)) aunque el API permite cashier.
- Exportación: **CSV** (con BOM UTF-8) y **reporte HTML** imprimible
  ([Reports.tsx:187-200](../client/src/pages/Reports.tsx), [utils/reportHTML.ts](../client/src/utils/reportHTML.ts)).

### Historial de boletas
- **waiter/cashier** ven **solo el día actual**; **owner** puede filtrar por rango
  `from/to` ([bills.ts:28-66](../server/src/routes/bills.ts)).
- El detalle y la **reimpresión** de boletas anteriores están vedados a no-owners
  → 403 ([bills.ts:74-80](../server/src/routes/bills.ts), [routes/print.ts:98-102](../server/src/routes/print.ts)).

---

## 11. UX y comportamiento del cliente

- **Errores y avisos por toasts**; nunca `alert()`/`console.error` en flujos
  visibles (convención de [../CLAUDE.md](../CLAUDE.md)). Excepción puntual: un
  `confirm()` nativo al cancelar pedido ([POS.tsx:331](../client/src/pages/POS.tsx)).
- Inputs numéricos en celular: `inputMode="decimal"`; teléfonos: `inputMode="tel"`.
- **Banner sticky de reconexión** cuando el socket se cae; **no bloquea** la UI —
  el mozo sigue tomando pedidos por HTTP, solo pierde el tiempo real
  ([components/ReconnectBanner.tsx](../client/src/components/ReconnectBanner.tsx)).
- El borrador de pedido (`order`) y el contador de boletas (`receipt`) **persisten
  en `localStorage`** y sobreviven recargas
  ([store/order.ts](../client/src/store/order.ts), [store/receipt.ts](../client/src/store/receipt.ts)).
- Tras un cobro **fullyPaid**, la UI navega a `/tables`; si fue parcial, marca los
  items pagados localmente y permite seguir cobrando
  ([Cash.tsx:932-955](../client/src/pages/Cash.tsx)).

---

## 12. Reglas implícitas / supuestos detectados

> Estas no son configurables; están "horneadas" en el código. Se listan como
> hipótesis verificadas en archivos reales.

- **Moneda fija: Soles (S/)**, hardcodeada en UI e impresión.
- **Sin impuestos ni descuentos:** `subtotal == total` siempre
  ([bills.ts:210-213](../server/src/routes/bills.ts)).
- **Marca/branding fijos:** "CEVICHERÍA MAUI", "Tacna, Perú" en boletas/login
  ([printer.ts:345](../server/src/utils/printer.ts), [Login.tsx:58-60](../client/src/pages/Login.tsx)).
- **Prefijo de serie `B001` fijo** en la numeración de boletas.
- Las boletas son **documentos internos**, no comprobantes electrónicos SUNAT (el
  ticket de pre-cuenta lo declara explícitamente: "No es comprobante de pago").
