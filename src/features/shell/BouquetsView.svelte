<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import type {
    CreateMemoryResult,
    GardenMemory,
    GardenSource,
    SaveMemoryInput,
  } from '@/features/calendar';
  import {
    exportBouquetPng,
    exportFileName,
    layoutForMonth,
    monthList,
    monthsOfYear,
    parseMonthKey,
    renderBouquet,
    renderBouquetThumb,
    saveBlob,
    yearsWithMemories,
  } from '@/features/bouquets';
  import { MemoryDialog, MemoryView } from '@/features/memories';
  import { effectiveTimeZone, prefs } from '@/features/settings';
  import {
    capitalize,
    formatCompactDate,
    formatMonthYear,
    monthShortLabels,
    parseIso,
    todayIn,
  } from '@/lib/dates';
  import { flowerKey } from '@/lib/flowers';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { mountSvg } from '@/lib/svg-mount';
  import { openGardenSource } from './garden-data';
  import type { View } from './router';
  import { viewState } from './view-state.svelte';

  /** Texturas del ramo grande y del PNG (H7.5, decisión A). Archivos propios en `public/textures/`. */
  const TEXTURES = { paper: '/textures/paper.webp', wash: '/textures/wash.webp' } as const;

  let { locale, onNavigate }: { locale: Locale; onNavigate: (view: View) => void } = $props();

  type LoadState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; memories: readonly GardenMemory[] };

  const thisYear = $derived(todayIn(effectiveTimeZone()).year);

  let load = $state<LoadState>({ status: 'loading' });
  let source: GardenSource | null = null;
  let year = $state(viewState.month.year);
  let openKey = $state<string | null>(null);
  let images = $state<Record<string, string>>({});
  let viewing = $state<GardenMemory | null>(null);
  let editing = $state<GardenMemory | null>(null);
  let formOpen = $state(false);
  let notice = $state<{ key: MessageKey; count: number } | null>(null);
  let exportState = $state<'idle' | 'working' | 'done' | 'error'>('idle');
  let exportFile = $state('');
  let viewOpener: HTMLElement | null = null;
  let headingEl = $state<HTMLHeadingElement>();
  let listHeadingEl = $state<HTMLHeadingElement>();
  let gridEl = $state<HTMLUListElement>();
  let stageEl = $state<HTMLDivElement>();

  const memories = $derived(load.status === 'ready' ? load.memories : []);
  const years = $derived(yearsWithMemories(memories, thisYear));
  const minYear = $derived(years[years.length - 1] ?? thisYear);
  const maxYear = $derived(years[0] ?? thisYear);
  const months = $derived(monthsOfYear(memories, year));
  const labels = $derived(monthShortLabels(locale));
  const thumbs = $derived(months.map((m) => renderBouquetThumb(layoutForMonth(memories, m.ym))));

  const openYm = $derived(openKey ? parseMonthKey(openKey) : null);
  const list = $derived(openYm ? monthList(memories, openYm) : []);
  const layout = $derived(openYm ? layoutForMonth(memories, openYm) : null);
  const byId = $derived(new Map(list.map((m) => [m.id, m])));
  const monthName = $derived(openYm ? capitalize(formatMonthYear(openYm, locale)) : '');

  const shortDate = (iso: string) => {
    const d = parseIso(iso);
    return d ? formatCompactDate(d, locale, prefs.settings.dateFormat) : iso;
  };
  const flowerName = (id: GardenMemory['flower']) => t(locale, flowerKey(id, 'name') as MessageKey);

  const bouquetSvg = $derived.by(() => {
    if (!layout) return '';
    const more = layout.overflow
      ? { overflowText: t(locale, 'bouquets.art.moreText', { count: layout.overflow.count }) }
      : {};
    return renderBouquet(layout, {
      idPrefix: 'bq-',
      detail: 'full',
      interactive: true,
      polaroids: true,
      wash: true,
      // Mancha de acuarela (WebP propio, solo en el ramo grande; las miniaturas no la usan).
      washTexture: TEXTURES.wash,
      background: null,
      text: true,
      images,
      labels: {
        root: t(locale, 'bouquets.art.root', { month: monthName }),
        flower: (fl) => {
          const memory = byId.get(fl.id);
          return t(locale, 'bouquets.art.flower', {
            flower: flowerName(fl.flower),
            title: memory?.title ?? '',
            date: shortDate(fl.date),
          });
        },
        overflow: (count) => t(locale, 'bouquets.art.more', { count }),
        ...more,
      },
    });
  });

  const monthLabel = (index: number) => {
    const m = months[index];
    if (!m) return '';
    const month = capitalize(formatMonthYear(m.ym, locale));
    return m.count === 0
      ? t(locale, 'bouquets.month.none', { month })
      : m.count === 1
        ? t(locale, 'bouquets.month.one', { month })
        : t(locale, 'bouquets.month.many', { month, count: m.count });
  };
  const countText = $derived(
    list.length === 0
      ? t(locale, 'bouquets.detail.count.none')
      : list.length === 1
        ? t(locale, 'bouquets.detail.count.one')
        : t(locale, 'bouquets.detail.count.many', { count: list.length }),
  );

  const exportText = $derived(
    exportState === 'working'
      ? t(locale, 'bouquets.export.working')
      : exportState === 'done'
        ? t(locale, 'bouquets.export.done', { file: exportFile })
        : exportState === 'error'
          ? t(locale, 'bouquets.export.error')
          : '',
  );

  // Imagen PNG del ramo (método y límites: docs/ramos-exportacion.md).
  async function exportPng() {
    const l = layout;
    const key = openKey;
    if (!l || !key || exportState === 'working') return;
    exportState = 'working';
    try {
      const photos: Record<string, string> = {};
      for (const p of l.polaroids) {
        const memory = byId.get(p.id);
        const url = memory ? await loadImage(memory, 0, 'photo') : null;
        if (url) photos[p.id] = url;
      }
      const overflow = l.overflow
        ? { overflowText: t(locale, 'bouquets.art.moreText', { count: l.overflow.count }) }
        : {};
      const root = getComputedStyle(document.documentElement);
      const blob = await exportBouquetPng({
        layout: l,
        rootLabel: t(locale, 'bouquets.art.root', { month: monthName }),
        caption: t(
          locale,
          list.length === 1 ? 'bouquets.export.caption.one' : 'bouquets.export.caption.many',
          { month: monthName, count: list.length },
        ),
        photos,
        titleFont: root.getPropertyValue('--font-title').trim() || 'serif',
        textFont: getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif',
        textures: TEXTURES,
        ...overflow,
      });
      exportFile = exportFileName(key);
      saveBlob(blob, exportFile);
      exportState = 'done';
    } catch {
      exportState = 'error';
    }
  }

  async function start() {
    load = { status: 'loading' };
    try {
      source = await openGardenSource();
      load = { status: 'ready', memories: await source.list() };
    } catch {
      load = { status: 'error' };
    }
  }

  async function openMonth(key: string) {
    const ym = parseMonthKey(key);
    if (!ym) return;
    openKey = key;
    exportState = 'idle';
    year = ym.year;
    viewState.month = { year: ym.year, month: ym.month };
    notice = null;
    await tick();
    headingEl?.focus();
  }

  async function closeMonth() {
    const key = openKey;
    openKey = null;
    await tick();
    gridEl?.querySelector<HTMLButtonElement>(`button[data-key="${key}"]`)?.focus();
  }

  function openMemory(memory: GardenMemory, trigger: HTMLElement | null) {
    viewOpener = trigger;
    notice = null;
    viewing = memory;
  }

  function focusMemory(id: string) {
    const el =
      stageEl?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"].mg-fl`) ??
      document.querySelector<HTMLElement>(`button[data-memory="${CSS.escape(id)}"]`);
    el?.focus();
  }

  function onStageActivate(event: Event) {
    const target = event.target as Element | null;
    const flower = target?.closest<SVGElement>('.mg-fl');
    if (flower?.dataset.id) {
      const memory = byId.get(flower.dataset.id);
      if (memory) openMemory(memory, flower as unknown as HTMLElement);
      return;
    }
    if (target?.closest('.mg-more')) listHeadingEl?.focus();
  }
  function onStageKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target as Element).closest('.mg-fl, .mg-more')) return;
    event.preventDefault();
    onStageActivate(event);
  }

  const loadImage = (memory: GardenMemory, index: number, size: 'thumb' | 'photo') =>
    source ? source.imageUrl(memory, index, size) : Promise.resolve(null);

  function trashMemory(memory: GardenMemory): Promise<void> {
    return source ? source.trash(memory.id) : Promise.reject(new Error('garden:unavailable'));
  }

  async function onViewClosed(outcome: 'closed' | 'edit' | 'trashed') {
    const memory = viewing;
    viewing = null;
    if (!memory) return;
    if (outcome === 'edit') {
      editing = memory;
      formOpen = true;
      return;
    }
    if (outcome === 'trashed' && load.status === 'ready') {
      load = { status: 'ready', memories: load.memories.filter((m) => m.id !== memory.id) };
      delete images[memory.id];
      notice = { key: 'memory.trashed', count: 0 };
      await tick();
      headingEl?.focus();
      return;
    }
    await tick();
    const opener = viewOpener;
    viewOpener = null;
    if (opener?.isConnected) opener.focus();
    else focusMemory(memory.id);
  }

  function saveMemory(input: SaveMemoryInput): Promise<CreateMemoryResult> {
    if (!source || !editing) return Promise.reject(new Error('garden:unavailable'));
    return source.update(editing.id, input);
  }

  async function onFormClosed(result: CreateMemoryResult | null) {
    const was = editing;
    formOpen = false;
    editing = null;
    if (result && load.status === 'ready') {
      const failed = result.failedPhotos.length;
      delete images[result.memory.id];
      load = {
        status: 'ready',
        memories: load.memories.map((m) => (m.id === result.memory.id ? result.memory : m)),
      };
      notice = {
        key:
          failed === 0
            ? 'memory.updated'
            : failed === 1
              ? 'memory.saved.partial.one'
              : 'memory.saved.partial.many',
        count: failed,
      };
    }
    await tick();
    if (was) focusMemory(was.id);
  }

  // Fotos de las Polaroids: miniatura descifrada de la primera foto, una a una (como las portadas del Jardín).
  $effect(() => {
    const src = source;
    const l = layout;
    if (!src || !l) return;
    const todo = untrack(() =>
      l.polaroids.map((p) => p.id).filter((id) => images[id] === undefined),
    );
    if (todo.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const id of todo) {
        const memory = untrack(() => byId.get(id));
        if (cancelled) return;
        if (!memory) continue;
        const url = await src.imageUrl(memory, 0, 'thumb');
        if (cancelled) return;
        if (url) images[id] = url;
        else images[id] = '';
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  onMount(() => {
    // Venir desde «Ver el ramo» del Jardín abre directamente el ramo de ese mes.
    const pending = viewState.bouquetMonth;
    viewState.bouquetMonth = null;
    if (pending && parseMonthKey(pending)) {
      openKey = pending;
      year = parseMonthKey(pending)?.year ?? year;
    }
    void start();
  });
</script>

{#if load.status === 'loading'}
  <p role="status">{t(locale, 'garden.loading')}</p>
{:else if load.status === 'error'}
  <div class="state" role="alert">
    <h2>{t(locale, 'garden.error.title')}</h2>
    <button type="button" class="primary" onclick={start}>{t(locale, 'garden.error.retry')}</button>
  </div>
{:else}
  {#if notice}
    <p class="notice" role="status">{t(locale, notice.key, { count: notice.count })}</p>
  {/if}

  {#if openKey === null || !openYm}
    <p class="intro">{t(locale, 'bouquets.intro')}</p>
    <div class="years">
      <button
        type="button"
        class="step"
        disabled={year <= minYear}
        aria-label={t(locale, 'bouquets.year.prev')}
        onclick={() => (year -= 1)}>‹</button
      >
      <h2 class="year">{year}</h2>
      <button
        type="button"
        class="step"
        disabled={year >= maxYear}
        aria-label={t(locale, 'bouquets.year.next')}
        onclick={() => (year += 1)}>›</button
      >
    </div>
    <ul class="months" bind:this={gridEl}>
      {#each months as m, i (m.key)}
        <li>
          <button
            type="button"
            class="month"
            class:empty={m.count === 0}
            data-key={m.key}
            aria-label={monthLabel(i)}
            onclick={() => void openMonth(m.key)}
          >
            <span class="thumb" aria-hidden="true" use:mountSvg={thumbs[i] ?? ''}></span>
            <span class="mname" aria-hidden="true">{capitalize(labels[i] ?? '')}</span>
            <span class="mcount" aria-hidden="true">{m.count}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="topline">
      <button type="button" class="back" onclick={() => void closeMonth()}>
        ‹ {t(locale, 'bouquets.back')}
      </button>
    </div>
    <h2 class="mh" tabindex="-1" bind:this={headingEl}>{monthName}</h2>
    <p class="summary">{countText}</p>

    <div class="detail">
      <div class="stage">
        <!-- Delegación de eventos: cada flor es un role="button" con tabindex y nombre accesible. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="art"
          bind:this={stageEl}
          use:mountSvg={bouquetSvg}
          onclick={onStageActivate}
          onkeydown={onStageKeydown}
        ></div>
        {#if list.length > 0}
          <div class="export">
            <button
              type="button"
              class="primary"
              disabled={exportState === 'working'}
              onclick={() => void exportPng()}
            >
              {t(locale, 'bouquets.export.button')}
            </button>
            <p class="hint" role="status">{exportText}</p>
            <p class="hint">{t(locale, 'bouquets.export.note')}</p>
          </div>
        {:else}
          <p class="empty">{t(locale, 'bouquets.detail.empty')}</p>
          <button type="button" class="primary" onclick={() => onNavigate('garden')}>
            {t(locale, 'bouquets.detail.garden')}
          </button>
        {/if}
      </div>

      <section class="side" aria-labelledby="bq-list">
        <h3 id="bq-list" tabindex="-1" bind:this={listHeadingEl}>
          {t(locale, 'bouquets.list.title')}
        </h3>
        {#if list.length > 0}
          <p class="hint">{t(locale, 'bouquets.list.hint')}</p>
          {#if layout?.overflow}
            <p class="hint">
              {t(locale, 'bouquets.detail.overflow', {
                shown: layout.flowers.length,
                count: layout.overflow.count,
              })}
            </p>
          {/if}
          <ul class="list">
            {#each list as memory (memory.id)}
              <li>
                <button
                  type="button"
                  class="row"
                  data-memory={memory.id}
                  onclick={(event) => openMemory(memory, event.currentTarget)}
                >
                  <span class="fm"><FlowerMark flower={memory.flower} /></span>
                  <span class="text">
                    <span class="title">{memory.title}</span>
                    <span class="when">{shortDate(memory.date)}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}

  {#if viewing}
    {@const current = viewing}
    <MemoryView
      {locale}
      memory={current}
      loadImage={(index) => loadImage(current, index, 'photo')}
      onTrash={() => trashMemory(current)}
      onClose={(outcome) => void onViewClosed(outcome)}
    />
  {/if}
  {#if formOpen && editing}
    <MemoryDialog
      {locale}
      date={editing.date}
      categories={prefs.settings.categories}
      memory={editing}
      loadThumb={(m, index) => loadImage(m, index, 'thumb')}
      onSave={saveMemory}
      onClose={(result) => void onFormClosed(result)}
    />
  {/if}
{/if}

<style>
  .intro,
  .summary,
  .hint {
    margin: 0 0 var(--space-3);
    color: var(--color-text-muted);
  }
  .state,
  .notice {
    max-width: 36rem;
    padding: var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-lg);
  }
  .years {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .year {
    margin: 0;
    min-width: 4.5rem;
    text-align: center;
    font-size: var(--text-lg);
  }
  .step,
  .back,
  .primary {
    min-height: var(--tap-min);
    min-width: var(--tap-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-control);
    background: var(--color-card);
    color: var(--color-primary);
    font: inherit;
    cursor: pointer;
  }
  .step:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .primary {
    border-color: transparent;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  .months {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Todas las tarjetas a la misma altura y alineadas arriba (antes, las de meses vacíos bajaban). */
  .months > li {
    display: flex;
  }
  .month {
    flex: 1 1 auto;
    align-content: start;
  }
  .month {
    display: grid;
    grid-template-rows: auto auto;
    justify-items: center;
    width: 100%;
    padding: var(--space-3) var(--space-2);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    box-shadow: var(--shadow-card);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }
  .month.empty {
    background: rgb(255 253 249 / 55%);
    box-shadow: none;
    color: var(--color-text-muted);
  }
  .thumb {
    display: block;
    width: 100%;
    aspect-ratio: 600 / 700;
  }
  .thumb :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .mname {
    font-weight: 600;
  }
  .mcount {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .topline {
    margin-bottom: var(--space-3);
  }
  .mh {
    margin: 0 0 var(--space-1);
    font-size: var(--text-lg);
  }
  .mh:focus,
  #bq-list:focus {
    outline: none;
  }
  .detail {
    display: grid;
    gap: var(--space-5);
  }
  .art {
    width: 100%;
    border-radius: var(--radius-lg);
    /* Papel (WebP propio de 2 KB, mismo origen: lo permite img-src 'self'). */
    background: var(--color-bg) url('/textures/paper.webp');
  }
  .art :global(svg) {
    display: block;
    width: 100%;
    height: auto;
    max-height: 75dvh;
    margin-inline: auto;
  }
  .art :global(.mg-fl),
  .art :global(.mg-more) {
    cursor: pointer;
  }
  .art :global(.mg-fl:focus),
  .art :global(.mg-more:focus) {
    outline: none;
  }
  .art :global(.mg-fl:focus-visible .mg-ring),
  .art :global(.mg-more:focus-visible .mg-ring) {
    opacity: 1;
  }
  .empty {
    margin: var(--space-3) 0;
  }
  .export {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .export .hint {
    margin: 0;
  }
  .primary:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .side h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
  }
  .list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .fm {
    flex: none;
    width: 2rem;
    height: 2rem;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .when {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  @media (min-width: 64rem) {
    .detail {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  /* Las flores brotan en cascada; sin movimiento si la persona lo pide. */
  @media (prefers-reduced-motion: no-preference) {
    .art :global(.mg-in) {
      transform-box: fill-box;
      transform-origin: center;
      animation: bloom 0.5s ease-out both;
    }
    .art :global(.d1) {
      animation-delay: 60ms;
    }
    .art :global(.d2) {
      animation-delay: 120ms;
    }
    .art :global(.d3) {
      animation-delay: 180ms;
    }
    .art :global(.d4) {
      animation-delay: 240ms;
    }
    .art :global(.d5) {
      animation-delay: 300ms;
    }
    .art :global(.d6) {
      animation-delay: 360ms;
    }
    .art :global(.d7) {
      animation-delay: 420ms;
    }
  }
  @keyframes bloom {
    from {
      opacity: 0;
      transform: scale(0.85);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
</style>
