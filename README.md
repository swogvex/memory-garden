# Memory Garden

Jardín digital **privado para una sola persona**. Cada recuerdo (fotos, fecha, texto, categoría y enlace opcional) se convierte en una flor y cada mes forma un ramo. Todo el contenido se **cifra en el navegador** antes de salir del dispositivo: el servidor solo guarda datos cifrados.

- Producción: <https://memorygarden.date> (dominio propio; sin `workers.dev` ni URLs de vista previa).
- Una sola cuenta. No hay registro público: el primer acceso exige un **código de configuración** de un solo uso.

## Qué tiene
- Jardín: calendario mensual con hasta 5 fotos por recuerdo, panel del día y papelera de 30 días.
- Ramos: un ramo SVG por mes, determinista, con exportación PNG.
- Explorar: búsqueda y filtros (categoría, flor, temporada, año), todo en el cliente.
- Configuración: perfil y avatar, idioma (es/en), formato de fecha, zona horaria, categorías, contraseña, clave de recuperación, copia cifrada `.mgx` y restauración, privacidad, borrar todo.

## Stack
Astro 7 + Svelte 5 + TypeScript estricto · Cloudflare Workers (web y API) con D1 y R2 en la UE · Web Crypto (PBKDF2-SHA256, HKDF, AES-256-GCM) · Valibot · Vitest, Playwright y axe · ESLint y Prettier. Sin analíticas, sin recursos de terceros y sin dependencias criptográficas externas.

## Empezar en local
Requisitos: Node 24 (`.nvmrc`), npm 11, Windows/PowerShell o cualquier shell.

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars    # rellenar con: npm run gen-secrets (no subir nunca .dev.vars)
npm run db:migrate:local
npm run dev                              # http://localhost:4321
```

- `npm run dev:reset -- --yes` borra el espacio local (D1 y R2 locales). No existe en producción.
- Los e2e del jardín usan un **espacio de prueba cifrado en memoria** (semilla en `src/dev/`), que no entra en el build de producción.

## Comandos
| Comando | Qué hace |
|---|---|
| `npm run validate` | format:check, lint, check, Vitest, build y Playwright (lo mismo que el CI) |
| `npm run test` / `npm run test:e2e` | Unitarias / e2e |
| `npm run test:audit` | Auditoría de accesibilidad (axe y teclado; no va en el CI) |
| `npm run deploy` | Comprueba (`guard-deploy`), compila, despliega y verifica (`verify:bundle` + `check:headers`) |
| `npm run scan:secrets` | Búsqueda heurística de secretos en el árbol y el historial |
| `npm run gen-secrets` | Genera `PEPPER` y `SETUP_CODE` (se usan con `wrangler secret put`) |

## Documentación
La documentación de operación (arquitectura, seguridad, privacidad, RUNBOOK, mantenimiento, guía de entrega y guía de la destinataria) **no está en el repositorio**: la guarda el desarrollador aparte, junto con las especificaciones detalladas (criptografía, modelo de datos, sesiones, cabeceras, plan de pruebas de seguridad, modelo de amenazas) y el registro de decisiones. Los identificadores `D-xxx`, `PS-xx` y `R-xx` de los comentarios del código remiten a esos documentos.

## Licencia
Ver [LICENSE](LICENSE).
