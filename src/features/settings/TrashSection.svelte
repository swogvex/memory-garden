<script lang="ts">
  import { onMount } from 'svelte';
  import { formatCompactDate, parseIso } from '@/lib/dates';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { TrashError, type TrashItem, type TrashSource } from '@/lib/trash';
  import type { Status } from './messages';
  import { effectiveTimeZone, prefs } from './prefs.svelte';

  // Papelera (H8.3b; D-058): restaurar o borrar para siempre. Pasados 30 días el servidor la purga solo.
  let { locale, openTrash }: { locale: Locale; openTrash: () => Promise<TrashSource> } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  let items = $state.raw<TrashItem[] | null>(null);
  let failed = $state(false);
  let busy = $state(false);
  let confirming = $state<string | 'all' | null>(null);
  let status = $state<Status | null>(null);
  let titleEl = $state<HTMLHeadingElement>();

  async function reload() {
    failed = false;
    try {
      items = await (await openTrash()).list();
    } catch {
      failed = true;
    }
  }
  onMount(() => {
    void reload();
    // «Borrar todos los recuerdos» (zona de peligro) vacía también la papelera.
    const onDeleted = () => void reload();
    window.addEventListener('mg:memories-deleted', onDeleted);
    return () => window.removeEventListener('mg:memories-deleted', onDeleted);
  });

  const errorKey = (e: unknown): MessageKey =>
    e instanceof TrashError && e.code === 'conflict'
      ? 'settings.trash.error.conflict'
      : 'settings.trash.error.generic';

  async function run(task: (source: TrashSource) => Promise<Status>) {
    if (busy) return;
    busy = true;
    status = null;
    try {
      status = await task(await openTrash());
    } catch (e) {
      status = { kind: 'error', key: errorKey(e) };
    } finally {
      busy = false;
      confirming = null;
      await reload();
      titleEl?.focus(); // la fila pulsada ya no existe: el foco vuelve al título de la sección
    }
  }

  const restore = (item: TrashItem) =>
    run(async (s) => {
      await s.restore(item);
      return { kind: 'ok', key: 'settings.trash.restored' };
    });
  const purge = (item: TrashItem) =>
    run(async (s) => {
      await s.purge(item);
      return { kind: 'ok', key: 'settings.trash.purged' };
    });
  const purgeAll = () =>
    run(async (s) => {
      for (const item of items ?? []) await s.purge(item);
      return { kind: 'ok', key: 'settings.trash.emptied' };
    });

  const dayText = (unix: number) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: effectiveTimeZone(),
    }).format(new Date(unix * 1000));
  const memoryDate = (iso: string | null) => {
    const d = iso ? parseIso(iso) : null;
    return d ? formatCompactDate(d, locale, prefs.settings.dateFormat) : '';
  };
</script>

<section class="st-card st-wide" aria-labelledby={id('title')}>
  <h2 id={id('title')} tabindex="-1" bind:this={titleEl}>{t(locale, 'settings.trash.title')}</h2>
  <p>{t(locale, 'settings.trash.intro')}</p>
  {#if failed}
    <p class="st-status error" role="alert">{t(locale, 'settings.trash.error.load')}</p>
    <div class="ac-actions">
      <button type="button" class="ac-btn ac-btn-secondary" onclick={() => void reload()}>
        {t(locale, 'settings.retry')}
      </button>
    </div>
  {:else if items === null}
    <p role="status">{t(locale, 'settings.trash.loading')}</p>
  {:else if items.length === 0}
    <p class="ac-hint">{t(locale, 'settings.trash.empty')}</p>
  {:else}
    <ul class="st-trash">
      {#each items as item (item.id)}
        <li>
          <div class="st-trash-text">
            <span class="st-trash-title">{item.title ?? t(locale, 'settings.trash.untitled')}</span>
            <span class="ac-hint">
              {memoryDate(item.date)}
              {#if item.date}·{/if}
              {t(locale, 'settings.trash.purgeAt', { date: dayText(item.purgeAt) })}
            </span>
          </div>
          {#if confirming === item.id}
            <div class="ac-actions" role="group" aria-label={t(locale, 'settings.trash.confirm')}>
              <span>{t(locale, 'settings.trash.confirm')}</span>
              <button
                type="button"
                class="ac-btn ac-btn-danger"
                aria-disabled={busy ? 'true' : undefined}
                onclick={() => void purge(item)}
              >
                {t(locale, 'settings.trash.purge.yes')}
              </button>
              <button
                type="button"
                class="ac-btn ac-btn-secondary"
                onclick={() => (confirming = null)}
              >
                {t(locale, 'security.cancel')}
              </button>
            </div>
          {:else}
            <div class="ac-actions">
              <button
                type="button"
                class="ac-btn ac-btn-secondary"
                aria-disabled={busy ? 'true' : undefined}
                aria-label={t(locale, 'settings.trash.restore.label', {
                  title: item.title ?? t(locale, 'settings.trash.untitled'),
                })}
                onclick={() => void restore(item)}
              >
                {t(locale, 'settings.trash.restore')}
              </button>
              <button
                type="button"
                class="ac-btn ac-btn-link"
                aria-disabled={busy ? 'true' : undefined}
                aria-label={t(locale, 'settings.trash.purge.label', {
                  title: item.title ?? t(locale, 'settings.trash.untitled'),
                })}
                onclick={() => (confirming = item.id)}
              >
                {t(locale, 'settings.trash.purge')}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if confirming === 'all'}
      <div class="ac-actions" role="group" aria-label={t(locale, 'settings.trash.emptyConfirm')}>
        <span>{t(locale, 'settings.trash.emptyConfirm')}</span>
        <button
          type="button"
          class="ac-btn ac-btn-danger"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => void purgeAll()}
        >
          {t(locale, 'settings.trash.purge.yes')}
        </button>
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => (confirming = null)}>
          {t(locale, 'security.cancel')}
        </button>
      </div>
    {:else}
      <div class="ac-actions">
        <button
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => (confirming = 'all')}
        >
          {t(locale, 'settings.trash.emptyAll')}
        </button>
      </div>
    {/if}
  {/if}
  <p
    class="st-status"
    class:ok={status?.kind === 'ok'}
    class:error={status?.kind === 'error'}
    role="status"
  >
    {status ? t(locale, status.key) : ''}
  </p>
</section>
