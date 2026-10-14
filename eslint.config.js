import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import svelte from 'eslint-plugin-svelte';
import svelteConfig from './svelte.config.js';

// Límites entre módulos (ver docs/arquitectura-modulos.md).
const deepFeature = {
  group: ['@/features/*/*'],
  message: 'Importa otra feature solo por su interfaz pública: "@/features/<nombre>".',
};
const noServer = {
  group: ['@/server', '@/server/**'],
  message: 'El código de src/server solo lo importan src/pages (rutas API y middleware).',
};
const noUi = {
  group: ['@/features', '@/features/**', '@/components/**', '@/layouts/**', '@/pages/**'],
  message: 'lib/ y server/ no dependen de la capa de interfaz.',
};
const noCryptoStorage = {
  group: ['@/lib/crypto', '@/lib/crypto/**', '@/lib/storage', '@/lib/storage/**'],
  message: 'bouquets recibe un modelo de vista: no importa crypto ni storage.',
};
const restrict = (...patterns) => ({
  rules: { 'no-restricted-imports': ['error', { patterns }] },
});
const src = (dir) => `src/${dir}/**/*.{ts,astro,svelte}`;

export default defineConfig([
  {
    ignores: [
      'dist',
      '.astro',
      '.wrangler',
      'node_modules',
      'playwright-report',
      'test-results',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  ...svelte.configs['flat/recommended'],
  ...svelte.configs['flat/prettier'],
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: { parserOptions: { parser: tseslint.parser, svelteConfig } },
  },
  // Capas (el orden importa: la última regla que coincide sustituye a las anteriores).
  { files: [src('pages'), src('layouts')], ...restrict(deepFeature) },
  { files: [src('components')], ...restrict(deepFeature, noServer) },
  { files: [src('features')], ...restrict(deepFeature, noServer) },
  { files: [src('features/bouquets')], ...restrict(deepFeature, noServer, noCryptoStorage) },
  { files: [src('lib')], ...restrict(deepFeature, noUi, noServer) },
  { files: [src('server')], ...restrict(deepFeature, noUi) },
]);
