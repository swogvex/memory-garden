<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { GardenSource } from '@/features/calendar';
  import type { BackupSource } from '@/lib/backup';
  import type { TrashSource } from '@/lib/trash';
  import { t, type Locale } from '@/lib/i18n';
  import AvatarSection from './AvatarSection.svelte';
  import CategoriesSection from './CategoriesSection.svelte';
  import DataSection from './DataSection.svelte';
  import PreferencesSection from './PreferencesSection.svelte';
  import PrivacySection from './PrivacySection.svelte';
  import ProfileSection from './ProfileSection.svelte';
  import TrashSection from './TrashSection.svelte';
  import { loadPrefs, prefs } from './prefs.svelte';
  import './settings.css';

  let {
    locale,
    openGarden,
    openBackup,
    openTrash,
    session,
    security,
    danger,
  }: {
    locale: Locale;
    /** Fuente del Jardín: hace falta para cambiar la categoría de los recuerdos al renombrar o eliminar. */
    openGarden: () => Promise<GardenSource>;
    /** Copia cifrada (H8.3): exportar y continuar una restauración. */
    openBackup: () => Promise<BackupSource>;
    /** Papelera (H8.3b). */
    openTrash: () => Promise<TrashSource>;
    /** Cierre de sesión (lo pone la capa que conoce el acceso). */
    session?: Snippet;
    /** Contraseña y clave de recuperación (H8.2; las pone la capa que conoce el acceso). */
    security?: Snippet;
    /** Borrar todos los recuerdos y eliminar el espacio (H8.3b; las pone la capa que conoce el acceso). */
    danger?: Snippet;
  } = $props();
</script>

<div class="st">
  {#if prefs.status === 'ready'}
    <ProfileSection {locale} />
    <AvatarSection {locale} />
    <PreferencesSection {locale} />
    <CategoriesSection {locale} {openGarden} />
  {:else if prefs.status === 'error'}
    <div class="st-card st-wide" role="alert" aria-labelledby="st-error-title">
      <h2 id="st-error-title">{t(locale, 'settings.error.title')}</h2>
      <p>
        {t(
          locale,
          prefs.error === 'unreadable' ? 'settings.error.unreadable' : 'settings.error.unavailable',
        )}
      </p>
      <div class="ac-actions">
        <button type="button" class="ac-btn ac-btn-primary" onclick={() => void loadPrefs()}>
          {t(locale, 'settings.retry')}
        </button>
      </div>
    </div>
  {:else}
    <p class="st-card st-wide" role="status">{t(locale, 'settings.loading')}</p>
  {/if}

  {#if security}{@render security()}{/if}

  <DataSection {locale} {openBackup} />

  <TrashSection {locale} {openTrash} />

  {#if danger}{@render danger()}{/if}

  <PrivacySection {locale} />

  {#if session}
    <section class="st-card st-wide" aria-labelledby="st-session-title">
      <h2 id="st-session-title">{t(locale, 'settings.session.title')}</h2>
      <p>{t(locale, 'settings.session.body')}</p>
      <div class="ac-actions">{@render session()}</div>
    </section>
  {/if}
</div>
