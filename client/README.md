# MauiDesk — cliente

SPA React 19 + Vite + Tailwind 4 + Zustand del POS MauiDesk. Se instala como PWA en los celulares del local.

```bash
npm run dev     # Vite en :5173 (proxy /api y /socket.io → :3001)
npm run build   # genera dist/, que el servidor sirve en producción
npm run ci      # typecheck + lint
```

Arquitectura, módulos y convenciones: [../docs/architecture/README.md](../docs/architecture/README.md) y [../CLAUDE.md](../CLAUDE.md).
