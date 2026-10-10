// `npm run db:migrate`: aplica las migraciones sin levantar el servidor. Se usa en
// el procedimiento de despliegue ANTES de reiniciar el servicio, para detectar un
// problema de esquema con el local todavía operando la versión anterior.
import { applyStartupMigrations } from './migrate'

applyStartupMigrations()
  .then(() => {
    console.log('[migrate] OK')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[migrate] FALLÓ:', err)
    process.exit(1)
  })
