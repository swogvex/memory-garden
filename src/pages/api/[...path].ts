import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleApi, type ApiEnv } from '@/server';

// Una sola ruta para todo /api/*: el router de src/server decide, deniega por defecto y pone las cabeceras.
export const prerender = false;

export const ALL: APIRoute = ({ request }) => handleApi(request, env as unknown as ApiEnv);
