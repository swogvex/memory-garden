/**
 * Formato `.mgx` versión 1 (D-100, privacy-and-backups.md §8.2). Contenedor propio y sencillo, sin biblioteca de ZIP.
 * Lo que se publica de su estructura no es secreto: lo secreto va cifrado dentro.
 *
 * ```
 * Desplazamiento  Tamaño  Campo
 * 0               4       «MGX1» (0x4D 0x47 0x58 0x31)
 * 4               1       versión del formato (0x01)
 * 5               3       ceros (reservado)
 * 8               4       H = longitud de la cabecera (uint32, big-endian), 1..4096
 * 12              H       cabecera: JSON UTF-8, PÚBLICA (envolturas de la clave maestra, parámetros, ids)
 * 12+H            4       M = longitud del manifiesto (uint32, big-endian)
 * 16+H            M       manifiesto: sobre AES-GCM con K_export, AAD `mg1|export|<vault_id>|<export_id>`
 * 16+H+M          …       datos: los sobres cifrados TAL CUAL, uno tras otro, en el orden del manifiesto
 * ```
 *
 * El manifiesto (cifrado) lista cada sobre con su tipo, ids, tamaño y SHA-256, y el SHA-256 de la cabecera: así una
 * cabecera cambiada, un sobre alterado, cambiado de sitio o ausente se detecta al restaurar. Límite conocido: no detecta
 * que se use un archivo antiguo entero (rollback, crypto-spec.md §11).
 */
import {
  array,
  integer,
  literal,
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  pipe,
  regex,
  safeParse,
  strictObject,
  string,
  variant,
} from 'valibot';
import type { GenericSchema, InferOutput } from 'valibot';

export const MGX_MAGIC = [0x4d, 0x47, 0x58, 0x31] as const;
export const MGX_VERSION = 1;
export const PREFIX_BYTES = 12;
export const MAX_HEADER_BYTES = 4096;
export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRIES = 250_000;

/** Tope por tipo (coinciden con los del servidor: `src/server/config.ts`). */
export const MAX_ENTRY_BYTES = {
  settings: 65_536,
  memory: 65_536,
  photo: 2 * 1024 * 1024,
  thumb: 256 * 1024,
  avatar: 128 * 1024,
} as const;

export type BackupErrorCode =
  /** No es un archivo `.mgx` o su estructura está rota (truncado, longitudes imposibles). */
  | 'format'
  /** Versión del formato más moderna que esta aplicación. */
  | 'version'
  /** La contraseña o la clave no abren este archivo. */
  | 'credentials'
  /** Un sobre no coincide con el manifiesto: archivo alterado o dañado. No se restaura nada. */
  | 'corrupt'
  /** La copia es de otro espacio (no se puede mezclar). */
  | 'other_space'
  /** Sin conexión, sesión caducada o servidor caído. */
  | 'unavailable'
  /** Tope diario de subidas o cuota total del espacio. */
  | 'quota';

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  constructor(code: BackupErrorCode) {
    super(`backup:${code}`);
    this.name = 'BackupError';
    this.code = code;
  }
}

const id = pipe(string(), regex(/^[A-Za-z0-9_-]{22}$/));
const b64u = (min: number, max: number) =>
  pipe(string(), minLength(min), maxLength(max), regex(/^[A-Za-z0-9_-]+$/));
const int = (min: number, max: number) => pipe(number(), integer(), minValue(min), maxValue(max));
const sha = pipe(string(), regex(/^[A-Za-z0-9_-]{43}$/));
const size = (max: number) => int(32, max);

export const HeaderSchema = strictObject({
  format: literal(MGX_VERSION),
  vault_id: id,
  mk_version: int(1, 255),
  kdf: pipe(string(), minLength(40), maxLength(400)),
  wrapped_mk_pw: b64u(80, 256),
  rec_salt: id,
  wrapped_mk_rec: b64u(80, 256),
  export_id: id,
});
/** Cabecera pública. Tipo escrito a mano (y comprobado contra el esquema al final del archivo). */
export interface BackupHeader {
  readonly format: typeof MGX_VERSION;
  readonly vault_id: string;
  readonly mk_version: number;
  readonly kdf: string;
  readonly wrapped_mk_pw: string;
  readonly rec_salt: string;
  readonly wrapped_mk_rec: string;
  readonly export_id: string;
}

const EntrySchema = variant('t', [
  strictObject({
    t: literal('settings'),
    rev: int(1, 2_147_483_647),
    size: size(MAX_ENTRY_BYTES.settings),
    sha256: sha,
  }),
  strictObject({
    t: literal('memory'),
    id,
    sv: int(1, 1000),
    size: size(MAX_ENTRY_BYTES.memory),
    sha256: sha,
  }),
  strictObject({
    t: literal('photo'),
    id,
    memory: id,
    size: size(MAX_ENTRY_BYTES.photo),
    sha256: sha,
  }),
  strictObject({
    t: literal('thumb'),
    id,
    memory: id,
    parent: id,
    size: size(MAX_ENTRY_BYTES.thumb),
    sha256: sha,
  }),
  strictObject({ t: literal('avatar'), id, size: size(MAX_ENTRY_BYTES.avatar), sha256: sha }),
]);
interface Sized {
  readonly size: number;
  readonly sha256: string;
}
export type BackupEntry =
  | ({ readonly t: 'settings'; readonly rev: number } & Sized)
  | ({ readonly t: 'memory'; readonly id: string; readonly sv: number } & Sized)
  | ({ readonly t: 'photo'; readonly id: string; readonly memory: string } & Sized)
  | ({
      readonly t: 'thumb';
      readonly id: string;
      readonly memory: string;
      readonly parent: string;
    } & Sized)
  | ({ readonly t: 'avatar'; readonly id: string } & Sized);

export const ManifestSchema = strictObject({
  v: literal(MGX_VERSION),
  /** SHA-256 de los bytes exactos de la cabecera. */
  header: sha,
  /** Fecha y hora de la exportación (ISO 8601, UTC). */
  created: pipe(string(), regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)),
  counts: strictObject({
    memories: int(0, MAX_ENTRIES),
    photos: int(0, MAX_ENTRIES),
    /** Fotos que el servidor ya no tenía al exportar (no van en el archivo). */
    missing: int(0, MAX_ENTRIES),
    /** Recuerdos que no se pudieron abrir al exportar: van tal cual, sin sus fotos. */
    unreadable: int(0, MAX_ENTRIES),
  }),
  entries: pipe(array(EntrySchema), maxLength(MAX_ENTRIES)),
});
export interface BackupManifest {
  readonly v: typeof MGX_VERSION;
  readonly header: string;
  readonly created: string;
  readonly counts: {
    readonly memories: number;
    readonly photos: number;
    readonly missing: number;
    readonly unreadable: number;
  };
  readonly entries: readonly BackupEntry[];
}

/** Valida con Valibot sin dejar que los valores del archivo lleguen a ningún mensaje. */
export function parseOrFail<T>(schema: GenericSchema, input: unknown): T {
  const r = safeParse(schema, input);
  if (!r.success) throw new BackupError('format');
  return r.output as T;
}

export function u32(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

export function readU32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new BackupError('format');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

/** Los 12 primeros bytes del archivo. */
export function encodePrefix(headerLength: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(PREFIX_BYTES);
  out.set(MGX_MAGIC, 0);
  out[4] = MGX_VERSION;
  out.set(u32(headerLength), 8);
  return out;
}

/** Comprueba el prefijo y devuelve la longitud de la cabecera. */
export function decodePrefix(prefix: Uint8Array): number {
  if (prefix.length < PREFIX_BYTES || MGX_MAGIC.some((b, i) => prefix[i] !== b))
    throw new BackupError('format');
  const version = prefix[4] ?? 0;
  if (version !== MGX_VERSION) throw new BackupError(version > MGX_VERSION ? 'version' : 'format');
  if (prefix[5] !== 0 || prefix[6] !== 0 || prefix[7] !== 0) throw new BackupError('format');
  const h = readU32(prefix, 8);
  if (h < 2 || h > MAX_HEADER_BYTES) throw new BackupError('format');
  return h;
}

/** Desplazamiento de cada sobre dentro del archivo, y tamaño total esperado. */
export function layout(
  dataStart: number,
  entries: readonly BackupEntry[],
): { offsets: number[]; total: number } {
  const offsets: number[] = [];
  let at = dataStart;
  for (const e of entries) {
    offsets.push(at);
    at += e.size;
  }
  return { offsets, total: at };
}

/** Coherencia interna del manifiesto: ids únicos, fotos y miniaturas con su recuerdo, recuentos que cuadran. */
export function checkManifest(m: BackupManifest): void {
  const seen = new Set<string>();
  const memories = new Set<string>();
  const photos = new Map<string, string>(); // foto → recuerdo
  let settings = 0;
  let avatars = 0;
  for (const e of m.entries) {
    if (e.t === 'settings') {
      settings++;
      continue;
    }
    if (seen.has(e.id)) throw new BackupError('format');
    seen.add(e.id);
    if (e.t === 'memory') memories.add(e.id);
    else if (e.t === 'photo') {
      if (!memories.has(e.memory)) throw new BackupError('format'); // el recuerdo va antes que sus fotos
      photos.set(e.id, e.memory);
    } else if (e.t === 'thumb') {
      if (photos.get(e.parent) !== e.memory) throw new BackupError('format');
    } else avatars++;
  }
  if (settings > 1 || avatars > 1) throw new BackupError('format');
  if (m.counts.memories !== memories.size || m.counts.photos !== photos.size)
    throw new BackupError('format');
}

// Los tipos escritos a mano y los esquemas no pueden separarse: si un campo cambia en uno y no en el otro, no compila.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const schemasMatchTypes: [
  Same<InferOutput<typeof HeaderSchema>, BackupHeader>,
  Same<InferOutput<typeof EntrySchema>, BackupEntry>,
] = [true, true];
void schemasMatchTypes;
