# Límites entre módulos

Importa siempre con alias `@/…` entre carpetas. Dentro de una misma feature, usa rutas relativas.

| Regla | Aplicada por |
|---|---|
| Una feature solo se importa por su interfaz pública (`@/features/calendar`, nunca `@/features/calendar/x`). | Lint (`no-restricted-imports`) |
| `lib/` y `server/` no importan `features/`, `components/`, `layouts/` ni `pages/`. | Lint |
| `features/`, `components/` y `lib/` no importan `@/server/*`; solo `pages/` (rutas API, middleware). | Lint |
| `features/bouquets` no importa `lib/crypto` ni `lib/storage`; recibe un modelo de vista. | Lint |
| Solo `lib/storage` habla con la API (`fetch('/api/…')`). | Convención y revisión (no comprobable por lint) |
| Solo `lib/crypto` toca claves. | Convención y revisión; pruebas en H3 |

Límites conocidos: el lint solo ve imports con alias `@/`. Un import relativo (`../../otra-feature/x`) lo esquiva.

Comprobar que la regla funciona: crea `src/features/bouquets/_probe.ts` con `import '@/lib/crypto';`, ejecuta `npx eslint src/features/bouquets/_probe.ts` (debe dar error) y bórralo.
