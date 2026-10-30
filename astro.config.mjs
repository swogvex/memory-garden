// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import cloudflare from '@astrojs/cloudflare';
import { devRoutes } from './astro-integrations/dev-routes.mjs';

// https://astro.build/config
export default defineConfig({
  session: false,
  integrations: [svelte(), devRoutes()],
  adapter: cloudflare({ imageService: 'passthrough' }),
  // H7.3 (D-085): CSP en dos partes. Astro añade a cada página una <meta http-equiv="content-security-policy"> con
  // `script-src` y `style-src` por HASHES (sin 'unsafe-inline'); el resto de directivas va por cabecera (public/_headers).
  // No funciona en `astro dev`: se comprueba con build + preview (tests/e2e/csp.spec.ts).
  security: {
    csp: {
      algorithm: 'SHA-256',
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },
  // D-086: nada se incrusta como `data:` (la CSP no admite `data:` en img-src ni font-src).
  vite: { build: { assetsInlineLimit: 0, cssCodeSplit: false } },
});
