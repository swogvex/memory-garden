/**
 * Fuente de datos de Configuración sobre cualquier `Repository` y un `Keyring`. Cifra, valida y descifra aquí:
 * el repositorio (y el servidor) solo ven el sobre cifrado de los ajustes y el avatar cifrado.
 *
 * AAD de los ajustes: `mg1|settings|<vault_id>|<revisión nueva>` (crypto-spec §5.3). Un sobre copiado de otra revisión
 * o de otro espacio no se abre. AAD del avatar: `mg1|asset|<vault_id>|<id>|avatar|-`.
 */
import { CryptoError, newId, type Keyring } from '@/lib/crypto';
import { StorageError, type Repository } from '@/lib/storage';
import { ValidationError, parseSettings, type Settings } from '@/lib/validation';
import { SettingsError, type SettingsSource, type StoredSettings } from './model';

function fromStorage(error: unknown): SettingsError {
  if (error instanceof SettingsError) return error;
  if (error instanceof ValidationError) return new SettingsError('invalid');
  if (error instanceof StorageError) {
    if (error.code === 'conflict') return new SettingsError('conflict');
    if (error.code === 'quota' || error.code === 'too_large') return new SettingsError('quota');
    if (error.code === 'invalid') return new SettingsError('invalid');
  }
  return new SettingsError('unavailable');
}

export function createSettingsSource(repo: Repository, keyring: Keyring): SettingsSource {
  const urls = new Map<string, string>();

  return {
    async load(): Promise<StoredSettings> {
      let stored;
      try {
        stored = await repo.vault.getSettings();
      } catch (error) {
        throw fromStorage(error);
      }
      if (stored.payload === null) return { settings: null, revision: stored.revision };
      try {
        const value = await keyring.openSettings(stored.revision, stored.payload);
        return { settings: parseSettings(value), revision: stored.revision };
      } catch (error) {
        // Claves bloqueadas: como cualquier fallo de red. Sobre que no abre o no valida: no se sobrescribe a ciegas.
        if (error instanceof CryptoError && error.code === 'locked')
          throw new SettingsError('unavailable');
        throw new SettingsError('unreadable');
      }
    },

    async save(settings: Settings, expectedRevision: number): Promise<number> {
      try {
        const valid = parseSettings(settings);
        const payload = await keyring.sealSettings(expectedRevision + 1, valid);
        const { revision } = await repo.vault.putSettings(payload, expectedRevision);
        return revision;
      } catch (error) {
        throw fromStorage(error);
      }
    },

    async uploadAvatar(jpeg: Uint8Array): Promise<string> {
      const id = newId();
      try {
        await repo.assets.put({
          id,
          kind: 'avatar',
          parentId: null,
          mkVersion: keyring.mkVersion,
          bytes: await keyring.sealAsset(id, 'avatar', null, jpeg),
        });
      } catch (error) {
        throw fromStorage(error);
      }
      return id;
    },

    async deleteAvatar(assetId: string): Promise<void> {
      const url = urls.get(assetId);
      if (url !== undefined) URL.revokeObjectURL(url);
      urls.delete(assetId);
      try {
        await repo.assets.delete(assetId);
      } catch (error) {
        if (error instanceof StorageError && error.code === 'not_found') return; // ya no estaba
        throw fromStorage(error);
      }
    },

    async avatarUrl(assetId: string): Promise<string | null> {
      const hit = urls.get(assetId);
      if (hit !== undefined) return hit;
      try {
        const bytes = await repo.assets.getBytes(assetId);
        const plain = await keyring.openAsset(assetId, 'avatar', null, bytes);
        const url = URL.createObjectURL(new Blob([plain.slice().buffer], { type: 'image/jpeg' }));
        urls.set(assetId, url);
        return url;
      } catch {
        return null; // ausente, sesión caducada o claves bloqueadas: se muestra el avatar floral
      }
    },

    lock(): void {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
