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
});
