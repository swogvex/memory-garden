import { applySecurityHeaders } from './security-headers';

/** Resultado de un manejador: datos, no `Response`. El router lo convierte y le pone SIEMPRE las cabeceras (D-083). */
export interface ApiResult {
  status: number;
  body?: unknown;
  cookies?: string[];
  headers?: Record<string, string>;
  /** Respuesta binaria (descarga de un objeto cifrado). Si está, `body` se ignora. */
  raw?: { body: ReadableStream<Uint8Array> | Uint8Array; size?: number };
}

/** Códigos de error y su estado HTTP. Cuerpos genéricos: nunca incluyen datos del usuario ni detalles internos (D-060). */
const ERRORS = {
  bad_request: 400,
  unauthorized: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  length_required: 411,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  server_error: 500,
  insufficient_storage: 507,
} as const;

export type ErrorCode = keyof typeof ERRORS;

export function ok(
  body: unknown,
  extra: Partial<Pick<ApiResult, 'cookies' | 'headers'>> = {},
): ApiResult {
  return { status: 200, body, ...extra };
}

export function problem(
  code: ErrorCode,
  extra: Partial<Pick<ApiResult, 'headers'>> & { body?: Record<string, unknown> } = {},
): ApiResult {
  return {
    status: ERRORS[code],
    body: { error: code, ...extra.body },
    ...(extra.headers ? { headers: extra.headers } : {}),
  };
}

export function rateLimited(retryAfter: number): ApiResult {
  return problem('rate_limited', {
    body: { retry_after: retryAfter },
    headers: { 'Retry-After': String(retryAfter) },
  });
}

export function toResponse(result: ApiResult): Response {
  const headers = new Headers();
  if (result.raw) headers.set('Content-Type', 'application/octet-stream');
  else if (result.body !== undefined)
    headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(result.headers ?? {})) headers.set(k, v);
  for (const cookie of result.cookies ?? []) headers.append('Set-Cookie', cookie);
  applySecurityHeaders(headers, 'api');
  if (result.raw) {
    if (result.raw.size !== undefined) headers.set('Content-Length', String(result.raw.size));
    return new Response(result.raw.body as BodyInit, { status: result.status, headers });
  }
  const body = result.body === undefined ? null : JSON.stringify(result.body);
  return new Response(result.status === 204 || result.status === 304 ? null : body, {
    status: result.status,
    headers,
  });
}

/** Lee el cuerpo con tope de bytes (cuenta lo leído, no se fía de `Content-Length`). `null` = demasiado grande. */
export async function readBodyLimited(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

/**
 * Lee el cuerpo binario exigiendo que mida EXACTAMENTE `expected` bytes (el `Content-Length` declarado).
 * `null` si sobra o falta algo o si la lectura se interrumpe (conexión perdida): no queda nada a medias.
 */
export async function readBytesExact(
  request: Request,
  expected: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return expected === 0 ? new Uint8Array(0) : null;
  const reader = request.body.getReader();
  const out = new Uint8Array(expected);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.byteLength > expected) {
        await reader.cancel();
        return null;
      }
      out.set(value, total);
      total += value.byteLength;
    }
  } catch {
    return null;
  }
  return total === expected ? out : null;
}
