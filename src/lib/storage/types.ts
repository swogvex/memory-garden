/**
 * Interfaz de repositorio (CONTEXTO §4, data-model.md). Solo maneja datos CIFRADOS u opacos:
 * ningún método recibe ni devuelve texto en claro. Las pantallas dependen de esta interfaz,
 * no de si detrás hay un adaptador de pruebas o la API real (H7).
 */
export type AssetKind = 'photo' | 'thumb' | 'avatar';
export type AssetState = 'pending' | 'ready' | 'deleting';

export interface VaultRecord {
  readonly id: string;
  readonly schemaVersion: number;
  readonly mkVersion: number;
  /** Concurrencia optimista de los cambios de claves. */
  readonly keyRevision: number;
  readonly kdf: string;
  readonly wrappedMkPw: string;
  readonly recSalt: string;
  readonly wrappedMkRec: string;
  readonly settingsPayload: string | null;
  readonly settingsRevision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NewVault {
  readonly id: string;
  readonly kdf: string;
  readonly mkVersion: number;
  readonly wrappedMkPw: string;
  readonly recSalt: string;
  readonly wrappedMkRec: string;
}

/** Cambio de claves: `kdf`+`wrappedMkPw` juntos y/o `recSalt`+`wrappedMkRec` juntos. */
export interface KeyUpdate {
  readonly kdf?: string;
  readonly wrappedMkPw?: string;
  readonly recSalt?: string;
  readonly wrappedMkRec?: string;
}

export interface MemoryRecord {
  readonly id: string;
  readonly payload: string; // envoltorio base64url
  readonly schemaVersion: number;
  readonly mkVersion: number;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
}

export interface PutMemoryInput {
  readonly id: string;
  readonly payload: string;
  readonly schemaVersion: number;
  readonly mkVersion: number;
  /** Fotos y miniaturas subidas (pending) que pasan a formar parte del recuerdo. */
  readonly assetIds: readonly string[];
}

export interface AssetRecord {
  readonly id: string;
  readonly memoryId: string | null;
  readonly parentId: string | null;
  readonly kind: AssetKind;
  readonly sizeBytes: number;
  readonly mkVersion: number;
  readonly state: AssetState;
  readonly createdAt: number;
}

export interface PutAssetInput {
  readonly id: string;
  readonly kind: AssetKind;
  readonly parentId: string | null;
  readonly mkVersion: number;
  /** Sobre cifrado completo (binario). */
  readonly bytes: Uint8Array;
}

export interface VaultRepository {
  get(): Promise<VaultRecord | null>;
  /** Primer acceso. Falla con `conflict` si ya existe un espacio (cuenta única, D-001). */
  create(input: NewVault): Promise<VaultRecord>;
  /** Falla con `conflict` si `expectedKeyRevision` no coincide. Incrementa `keyRevision`. */
  replaceKeys(update: KeyUpdate, expectedKeyRevision: number): Promise<VaultRecord>;
  getSettings(): Promise<{ readonly payload: string | null; readonly revision: number }>;
  /** Nueva revisión = `expectedRevision + 1`; el AAD de los ajustes debe usar ESA revisión. */
  putSettings(payload: string, expectedRevision: number): Promise<{ readonly revision: number }>;
}

export interface MemoryRepository {
  /** `since`: solo los cambiados después (updated_at > since). Por defecto excluye la papelera. */
  list(opts?: { since?: number; includeTrashed?: boolean }): Promise<MemoryRecord[]>;
  get(id: string): Promise<MemoryRecord | null>;
  /** `expectedRevision = null` crea (conflict si existe); otro valor actualiza (conflict si no coincide). */
  put(input: PutMemoryInput, expectedRevision: number | null): Promise<MemoryRecord>;
  trash(id: string, expectedRevision: number): Promise<MemoryRecord>;
  restore(id: string, expectedRevision: number): Promise<MemoryRecord>;
  /** Borrado definitivo: solo desde la papelera. Elimina primero sus recursos. */
  purge(id: string): Promise<void>;
}

export interface AssetRepository {
  /** 409 (`conflict`) si el id existe: nunca se sobrescribe. Queda `pending` hasta ligarse a un recuerdo. */
  put(input: PutAssetInput): Promise<AssetRecord>;
  /** Solo recursos `ready`. */
  getBytes(id: string): Promise<Uint8Array>;
  list(memoryId: string): Promise<AssetRecord[]>;
  delete(id: string): Promise<void>;
}

export interface Repository {
  readonly vault: VaultRepository;
  readonly memories: MemoryRepository;
  readonly assets: AssetRepository;
}
