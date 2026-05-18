type Period = 'today' | 'week' | 'month'

interface Summary {
  totalSales: number
  orderCount: number
  byMethod: { cash: number; yape: number; plin: number }
  topDishes: { dishName: string; totalQty: number; totalRevenue: number }[]
  daily: { date: string; total: number; count: number }[]
}

interface Expense {
  id: number; description: string; amount: number; category: string; date: string
}

interface BillRecord {
  id: number; receiptNumber: string; paidAt: string; total: number
  paymentMethod: 'cash' | 'yape' | 'plin'
  orderType: 'dine_in' | 'delivery'
  tableId: number | null; customerName: string | null
}

const PAY_LABEL = { cash: 'Efectivo', yape: 'Yape', plin: 'Plin' }
const PERIOD_LABEL: Record<Period, string> = { today: 'Hoy', week: 'Última semana', month: 'Este mes' }

function fmt(n: number) { return `S/ ${Number(n).toFixed(2)}` }

function barRow(label: string, value: number, max: number, sub: string, color = '#0077B6'): string {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span style="width:160px;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</span>
      <div style="flex:1;background:#f1f5f9;border-radius:4px;height:20px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .3s"></div>
      </div>
      <span style="font-size:12px;font-weight:800;color:#F4792B;width:80px;text-align:right">${fmt(value)}</span>
      <span style="font-size:11px;color:#94a3b8;width:60px;text-align:right">${sub}</span>
    </div>`
}

function badge(method: 'cash' | 'yape' | 'plin'): string {
  const styles: Record<string, string> = {
    cash: 'background:#ecfdf5;color:#065f46',
    yape: 'background:#f3e8ff;color:#6b21a8',
    plin: 'background:#e0f2fe;color:#0c4a6e',
  }
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;${styles[method]}">${PAY_LABEL[method]}</span>`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDay(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function generateReportHTML(
  period: Period,
  summary: Summary,
  expenses: Expense[],
  billHistory: BillRecord[],
  totalExp: number,
  netBal: number,
): string {
  const now = new Date().toLocaleString('es-PE')
  const maxDish  = Math.max(...summary.topDishes.map(d => Number(d.totalRevenue)), 1)
  const maxDaily = Math.max(...summary.daily.map(d => Number(d.total)), 1)
  const positive = netBal >= 0

  /* ── secciones ── */
  const sectionTop = summary.topDishes.length === 0
    ? `<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">Sin ventas en este período</p>`
    : summary.topDishes.map((d, i) =>
        barRow(`${i + 1}. ${d.dishName}`, Number(d.totalRevenue), maxDish, `${d.totalQty} unid.`)
      ).join('')

  const sectionDaily = summary.daily.length === 0 ? '' : `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0f172a">Ventas por día</div>
      <div style="padding:16px 20px">
        ${summary.daily.map(d =>
          barRow(formatDay(d.date), Number(d.total), maxDaily, `${d.count} ped.`)
        ).join('')}
      </div>
    </div>`

  const sectionExpenses = expenses.length === 0 ? '' : `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0f172a">
        Gastos <span style="float:right;color:#ef4444;font-weight:900">${fmt(totalExp)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Fecha</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Categoría</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Descripción</th>
          <th style="padding:8px 20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:right;border-bottom:1px solid #e2e8f0">Monto</th>
        </tr></thead>
        <tbody>${expenses.map(e => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:9px 20px;font-size:12px;color:#64748b">${e.date}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b;text-transform:capitalize">${e.category}</td>
            <td style="padding:9px 12px;font-size:12px;font-weight:600;color:#0f172a">${e.description}</td>
            <td style="padding:9px 20px;font-size:12px;font-weight:800;color:#ef4444;text-align:right">${fmt(e.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`

  const sectionBills = billHistory.length === 0 ? '' : `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden">
      <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0f172a">
        Historial de boletas <span style="float:right;color:#0077B6;font-weight:900">${billHistory.length} transacciones</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Boleta</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Fecha y hora</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Mesa / Cliente</th>
          <th style="padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0">Método</th>
          <th style="padding:8px 20px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;text-align:right;border-bottom:1px solid #e2e8f0">Total</th>
        </tr></thead>
        <tbody>${billHistory.map(b => `
          <tr style="border-bottom:1px solid #f1f5f9">
            <td style="padding:9px 20px;font-size:11px;font-family:monospace;color:#0077B6;font-weight:700">${b.receiptNumber}</td>
            <td style="padding:9px 12px;font-size:12px;color:#64748b">${formatDate(b.paidAt ?? '')}</td>
            <td style="padding:9px 12px;font-size:12px;font-weight:600;color:#0f172a">
              ${b.orderType === 'delivery'
                ? `<span style="background:#fff7ed;color:#9a3412;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700">Delivery</span> ${b.customerName ?? ''}`
                : `Mesa ${b.tableId}`}
            </td>
            <td style="padding:9px 12px">${badge(b.paymentMethod)}</td>
            <td style="padding:9px 20px;font-size:13px;font-weight:900;color:#0f172a;text-align:right">${fmt(b.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Reporte MAUI · ${PERIOD_LABEL[period]}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;font-size:13px}
    @media print{body{background:#fff}.no-print{display:none!important}}
  </style>
</head>
<body>

<!-- Header -->
<div style="background:linear-gradient(135deg,#0077B6,#004E86);color:#fff;padding:28px 40px;display:flex;justify-content:space-between;align-items:flex-end">
  <div>
    <div style="font-size:22px;font-weight:900;letter-spacing:-.5px">CEVICHERÍA MAUI</div>
    <div style="opacity:.7;font-size:12px;margin-top:4px">Tacna, Perú · Reporte de ventas</div>
  </div>
  <div style="text-align:right;opacity:.85">
    <div style="font-size:16px;font-weight:800">${PERIOD_LABEL[period]}</div>
    <div style="font-size:11px;margin-top:2px">Generado: ${now}</div>
  </div>
</div>

<!-- Print button -->
<div class="no-print" style="background:#fff;border-bottom:1px solid #e2e8f0;padding:12px 40px;display:flex;gap:8px">
  <button onclick="window.print()" style="background:#0077B6;color:#fff;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
    Imprimir / Guardar PDF
  </button>
  <button onclick="window.close()" style="background:#f1f5f9;color:#64748b;border:none;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
    Cerrar
  </button>
</div>

<div style="padding:28px 40px;max-width:960px">

  <!-- Summary cards -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">
    <div style="grid-column:span 2;background:linear-gradient(135deg,#0077B6,#004E86);color:#fff;border-radius:12px;padding:20px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.7;margin-bottom:6px">Total Ventas</div>
      <div style="font-size:32px;font-weight:900">${fmt(summary.totalSales)}</div>
      <div style="font-size:11px;opacity:.6;margin-top:4px">${summary.orderCount} pedido${summary.orderCount !== 1 ? 's' : ''} cobrado${summary.orderCount !== 1 ? 's' : ''}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px">Efectivo</div>
      <div style="font-size:24px;font-weight:900;color:#0f172a">${fmt(summary.byMethod.cash)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:6px">Billeteras</div>
      <div style="font-size:24px;font-weight:900;color:#0f172a">${fmt(summary.byMethod.yape + summary.byMethod.plin)}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:4px">Yape ${fmt(summary.byMethod.yape)} · Plin ${fmt(summary.byMethod.plin)}</div>
    </div>
  </div>

  <!-- Balance -->
  <div style="border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;${positive ? 'background:#ecfdf5;border:1px solid #a7f3d0' : 'background:#fef2f2;border:1px solid #fecaca'}">
    <div>
      <div style="font-size:13px;font-weight:700;${positive ? 'color:#065f46' : 'color:#991b1b'}">Balance neto del período</div>
      <div style="font-size:11px;margin-top:4px;${positive ? 'color:#059669' : 'color:#dc2626'}">Ventas ${fmt(summary.totalSales)} − Gastos ${fmt(totalExp)}</div>
    </div>
    <div style="font-size:28px;font-weight:900;${positive ? 'color:#059669' : 'color:#dc2626'}">${positive ? '' : '−'}${fmt(Math.abs(netBal))}</div>
  </div>

  <!-- Top platos -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:hidden">
    <div style="padding:14px 20px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#0f172a">Platos más vendidos</div>
    <div style="padding:16px 20px">${sectionTop}</div>
  </div>

  ${sectionDaily}
  ${sectionExpenses}
  ${sectionBills}

</div>

<div style="text-align:center;color:#94a3b8;font-size:11px;padding:20px;border-top:1px solid #e2e8f0">
  MauiDesk POS · Cevichería MAUI · Tacna, Perú
</div>

</body>
</html>`
}
