<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    BackupError,
    backupErrorKey,
    formatBytes,
    type BackupProgress,
    type BackupSource,
    type ExportSummary,
  } from '@/lib/backup';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import type { Status } from './messages';
  import { loadPrefs } from './prefs.svelte';

  // «Tus datos» (H8.3): copia cifrada `.mgx` y continuar una restauración que se quedó a medias (D-100).
  let { locale, openBackup }: { locale: Locale; openBackup: () => Promise<BackupSource> } =
    $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  let busy = $state(false);
  let progress = $state.raw<BackupProgress | null>(null);
  let exported = $state.raw<{ summary: ExportSummary; url: string; fileName: string } | null>(null);
  let exportStatus = $state<Status | null>(null);
  let restoreStatus = $state<Status | null>(null);
  let restoreFile = $state.raw<File | null>(null);
  let fileEl = $state<HTMLInputElement>();

  const errorKey = (e: unknown): MessageKey =>
    e instanceof BackupError ? backupErrorKey(e.code) : 'backup.error.unavailable';

  function forget() {
    if (exported) URL.revokeObjectURL(exported.url);
    exported = null;
  }
  onDestroy(forget);

  function download(url: string, fileName: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function exportNow() {
    if (busy) return;
    busy = true;
    forget();
    exportStatus = null;
    progress = null;
    try {
      const source = await openBackup();
      const out = await source.exportSpace((p) => (progress = p));
      const url = URL.createObjectURL(out.blob);
      exported = { summary: out.summary, url, fileName: out.fileName };
      download(url, out.fileName);
    } catch (e) {
      exportStatus = { kind: 'error', key: errorKey(e) };
    } finally {
      busy = false;
      progress = null;
    }
  }

  async function continueRestore(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !restoreFile) return;
    busy = true;
    restoreStatus = null;
    progress = null;
    try {
      const source = await openBackup();
      const summary = await source.continueRestore(restoreFile, (p) => (progress = p));
      restoreStatus = {
        kind: 'ok',
        key: 'settings.data.continue.done',
        params: { restored: summary.restored, skipped: summary.skipped },
      };
      restoreFile = null;
      if (fileEl) fileEl.value = '';
      void loadPrefs(); // los ajustes pudieron llegar con la copia
    } catch (e) {
      restoreStatus = { kind: 'error', key: errorKey(e) };
    } finally {
      busy = false;
      progress = null;
    }
  }

  const progressText = $derived(
    progress === null
      ? ''
      : progress.phase === 'read'
        ? t(locale, 'settings.data.exporting', { done: progress.done, total: progress.total })
        : t(locale, progress.phase === 'verify' ? 'restore.checking' : 'restore.uploading', {
            done: progress.done,
            total: progress.total,
          }),
  );
</script>

<section class="st-card st-wide" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'settings.data.title')}</h2>
  <p>{t(locale, 'settings.data.intro')}</p>
  <ul class="ac-list">
    <li>{t(locale, 'settings.data.note1')}</li>
    <li>{t(locale, 'settings.data.note2')}</li>
    <li>{t(locale, 'settings.data.note3')}</li>
  </ul>
  <div class="ac-actions">
    <button
      type="button"
      class="ac-btn ac-btn-primary"
      aria-disabled={busy ? 'true' : undefined}
      onclick={() => void exportNow()}
    >
      {busy && progress?.phase === 'read'
        ? t(locale, 'settings.data.preparing')
        : t(locale, 'settings.data.export')}
    </button>
  </div>
  <div
    role="status"
    class="st-status"
    class:ok={!exportStatus && exported !== null}
    class:error={exportStatus?.kind === 'error'}
  >
    {#if exportStatus}
      {t(locale, exportStatus.key)}
    {:else if exported}
      <p>
        {t(locale, 'settings.data.done', {
          memories: exported.summary.memories,
          photos: exported.summary.photos,
          size: formatBytes(exported.summary.bytes, locale),
        })}
      </p>
      {#if exported.summary.missing > 0}
        <p>{t(locale, 'settings.data.missing', { count: exported.summary.missing })}</p>
      {/if}
      {#if exported.summary.unreadable > 0}
        <p>{t(locale, 'settings.data.unreadable', { count: exported.summary.unreadable })}</p>
      {/if}
    {/if}
  </div>
  {#if exported}
    <div class="ac-actions">
      <a class="ac-btn ac-btn-secondary" href={exported.url} download={exported.fileName}>
        {t(locale, 'settings.data.download')}
      </a>
    </div>
  {/if}

  <form class="st-subform" onsubmit={continueRestore} novalidate>
    <h3>{t(locale, 'settings.data.continue.title')}</h3>
    <p>{t(locale, 'settings.data.continue.intro')}</p>
    <div class="ac-field">
      <label class="ac-label" for={id('file')}>{t(locale, 'restore.file.label')}</label>
      <!-- Sin `accept`: iOS no reconoce la extensión .mgx. Se comprueba el contenido. -->
      <input
        bind:this={fileEl}
        id={id('file')}
        class="ac-input"
        type="file"
        onchange={(e) => (restoreFile = e.currentTarget.files?.[0] ?? null)}
      />
    </div>
    <div class="ac-actions">
      <button
        type="submit"
        class="ac-btn ac-btn-secondary"
        aria-disabled={busy || !restoreFile ? 'true' : undefined}
      >
        {t(locale, 'settings.data.continue.start')}
      </button>
    </div>
    <p
      class="st-status"
      class:ok={restoreStatus?.kind === 'ok'}
      class:error={restoreStatus?.kind === 'error'}
      role="status"
    >
      {restoreStatus ? t(locale, restoreStatus.key, restoreStatus.params) : ''}
    </p>
  </form>
  <p class="ac-hint" aria-live="polite">{progressText}</p>
</section>
