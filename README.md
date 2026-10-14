# Memory Garden

Jardín digital privado para una sola persona: cada recuerdo es una flor y cada mes forma un ramo.
Astro 7 + Svelte 5 + TypeScript sobre Cloudflare Workers. Estado: H1 (base del proyecto, sin funcionalidad).

## Requisitos

Node 24 (`.nvmrc`; se exige ≥ 22.12), npm, Git. Los comandos son para PowerShell.

## Empezar

```powershell
npm install
npx playwright install chromium   # una vez
npm run dev                        # http://localhost:4321
```

Página de tokens y tipografía, solo en desarrollo: <http://localhost:4321/dev/componentes> (`?lang=en` para inglés).

## Scripts

| Script | Qué hace |
|---|---|
| `npm run lint` | ESLint, incluidos los límites entre módulos |
| `npm run format` / `format:check` | Prettier: escribe / solo comprueba |
| `npm run check` | `astro check` (tipos) |
| `npm test` | Vitest (unitarias) |
| `npm run build` | Compilación de producción |
| `npm run test:e2e` | Playwright + axe contra `astro preview` (hace falta compilar antes) |
| `npm run validate` | Todo lo anterior encadenado; es lo que ejecuta GitHub Actions |
| `npm run deploy` | Compila y despliega en Cloudflare |

## Documentación

- Decisiones: [docs/DECISIONES.md](docs/DECISIONES.md)
- Límites entre módulos: [docs/arquitectura-modulos.md](docs/arquitectura-modulos.md)

## Fuentes

Playfair Display, Inter y Caveat se sirven desde el propio sitio (paquetes Fontsource, licencia SIL OFL 1.1). Sin Google Fonts.

## Privacidad

Sin analíticas, sin rastreadores y sin recursos de terceros.
