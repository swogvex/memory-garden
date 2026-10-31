<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type {
    CreateMemoryResult,
    GardenMemory,
    GardenSource,
    SaveMemoryInput,
  } from '@/features/calendar';
  import {
    NO_FILTERS,
    dropUnavailable,
    filterMemories,
    filterOptions,
    hasFilters,
    type ExploreFilters,
  } from '@/features/explore';
  import { MemoryDialog, MemoryView } from '@/features/memories';
  import { prefs } from '@/features/settings';
  import { formatCompactDate, parseIso } from '@/lib/dates';
  import { flowerKey } from '@/lib/flowers';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { cachedMemories, openGardenSource, rememberMemories } from './garden-data';
  import Polaroid from './Polaroid.svelte';
  import type { View } from './router';

  /** Resultados por tanda; «Mostrar más» añade otra. */
  const PAGE = 60;
  /** El recuento se anuncia cuando se deja de escribir, no a cada tecla. */
  const ANNOUNCE_DELAY = 400;

  let { locale, onNavigate }: { locale: Locale; onNavigate: (view: View) => void } = $props();

  type LoadState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; memories: readonly GardenMemory[] };

  let load = $state<LoadState>({ status: 'loading' });
  let source: GardenSource | null = null;
  // D-262: «Abriendo tu jardín…» solo si la carga tarda; con recuerdos en memoria no llega a salir.
  let slowLoad = $state(false);
  // D-280: la búsqueda vive solo aquí (ni URL, ni historial, ni almacenamiento). Se pierde al salir de la sección.
  let filters = $state<ExploreFilters>({ ...NO_FILTERS });
  let shown = $state(PAGE);
  let announced = $state('');
  let covers = $state<Record<string, string>>({});
  let viewing = $state<GardenMemory | null>(null);
  let editing = $state<GardenMemory | null>(null);
  let formOpen = $state(false);
  let notice = $state<{ key: MessageKey; count: number } | null>(null);
  let viewOpener: HTMLElement | null = null;
  let searchEl = $state<HTMLInputElement>();
  let listEl = $state<HTMLUListElement>();

  const memories = $derived(load.status === 'ready' ? load.memories : []);
  const options = $derived(filterOptions(memories, locale));
  const results = $derived(filterMemories(memories, filters));
  const visible = $derived(results.slice(0, shown));
  const remaining = $derived(Math.min(PAGE, results.length - shown));
  const active = $derived(hasFilters(filters));
  const countText = $derived(
    results.length === 0
      ? t(locale, 'explore.count.none')
      : results.length === 1
        ? t(locale, 'garden.n.one')
        : t(locale, 'garden.n.many', { count: results.length }),
  );

  const shortDate = (iso: string) => {
    const d = parseIso(iso);
    return d ? formatCompactDate(d, locale, prefs.settings.dateFormat) : iso;
  };
  const flowerName = (id: GardenMemory['flower']) => t(locale, flowerKey(id, 'name') as MessageKey);
  const seasonName = (id: GardenMemory['season']) => t(locale, `season.${id}` as MessageKey);

  async function start() {
    if (load.status === 'error') load = { status: 'loading' };
    const timer = window.setTimeout(() => (slowLoad = true), 400);
    try {
      source = await openGardenSource();
      const cached = cachedMemories(source);
      if (cached) load = { status: 'ready', memories: cached };
      const onScreen = load.status === 'ready' ? load.memories : null;
      const fresh = await source.list();
      // Si mientras tanto se editó o borró algo aquí, lo de la pantalla ya es más nuevo: no se pisa.
      if (load.status !== 'ready' || load.memories === onScreen)
        load = { status: 'ready', memories: fresh };
    } catch {
      // Con recuerdos ya en pantalla se siguen viendo (el aviso de sin conexión explica el resto); sin ellos, error.
      if (load.status !== 'ready') load = { status: 'error' };
    } finally {
      window.clearTimeout(timer);
      slowLoad = false;
    }
  }

  $effect(() => {
    if (load.status === 'ready' && source) rememberMemories(source, load.memories);
  });

  // Cambiar la búsqueda o un filtro vuelve a la primera tanda.
  $effect(() => {
    void [filters.query, filters.category, filters.flower, filters.season, filters.year];
    shown = PAGE;
  });

  // Un filtro que ya no existe (se borró su último recuerdo) vuelve a «Todas».
  $effect(() => {
    const next = dropUnavailable(filters, options);
    if (next) filters = next;
  });

  $effect(() => {
    const text = countText;
    const timer = window.setTimeout(() => (announced = text), ANNOUNCE_DELAY);
    return () => window.clearTimeout(timer);
  });

  // Portadas: miniatura descifrada de la primera foto, una a una y solo de lo que se ve (como el Jardín, D-142).
  $effect(() => {
    const src = source;
    if (!src) return;
    const pending = visible.filter((m) => m.photos.length > 0 && covers[m.id] === undefined);
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const m of pending) {
        if (cancelled) return;
        const url = await src.imageUrl(m, 0, 'thumb');
        if (cancelled) return;
        covers[m.id] = url ?? ''; // '' = sin portada: se queda la flor y no se reintenta
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const rows = () => listEl?.querySelectorAll<HTMLButtonElement>('button[data-memory]') ?? [];

  function focusMemory(id: string) {
    const el = listEl?.querySelector<HTMLButtonElement>(`button[data-memory="${CSS.escape(id)}"]`);
    (el ?? searchEl)?.focus();
  }

  function focusRow(index: number) {
    const list = rows();
    const el = list.length > 0 ? list[Math.min(index, list.length - 1)] : undefined;
    (el ?? searchEl)?.focus();
  }

  function clearFilters() {
    filters = { ...NO_FILTERS };
    searchEl?.focus();
  }

  async function showMore() {
    const from = shown;
    shown += PAGE;
    await tick();
    focusRow(from);
  }

  function openMemory(memory: GardenMemory, trigger: HTMLElement) {
    viewOpener = trigger;
    notice = null;
    viewing = memory;
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
      const index = results.findIndex((m) => m.id === memory.id);
      load = { status: 'ready', memories: load.memories.filter((m) => m.id !== memory.id) };
      delete covers[memory.id];
      notice = { key: 'memory.trashed', count: 0 };
      viewOpener = null;
      await tick();
      focusRow(Math.max(index, 0));
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
    viewOpener = null;
    if (result && load.status === 'ready') {
      const failed = result.failedPhotos.length;
      delete covers[result.memory.id];
      load = {
        status: 'ready',
        memories: load.memories.map((m) => (m.id === result.memory.id ? result.memory : m)),
      };
      notice = {
        key:
          failed === 0
            ? result.replacedRemote
              ? 'memory.replaced'
              : 'memory.updated'
            : failed === 1
              ? 'memory.saved.partial.one'
              : 'memory.saved.partial.many',
        count: failed,
      };
    }
    await tick();
    // Si tras editarlo ya no cumple los filtros, el foco vuelve a la búsqueda.
    if (was) focusMemory(was.id);
  }

  onMount(() => {
    void start();
  });
</script>

{#if load.status === 'loading'}
  {#if slowLoad}<p role="status">{t(locale, 'garden.loading')}</p>{/if}
{:else if load.status === 'error'}
  <div class="state" role="alert">
    <h2>{t(locale, 'garden.error.title')}</h2>
    <p>{t(locale, 'garden.error.body')}</p>
    <button type="button" class="primary" onclick={start}>{t(locale, 'garden.error.retry')}</button>
  </div>
{:else if memories.length === 0}
  <div class="state">
    <p>{t(locale, 'explore.empty')}</p>
    <button type="button" class="primary" onclick={() => onNavigate('garden')}>
      {t(locale, 'explore.empty.garden')}
    </button>
  </div>
{:else}
  {#if notice}
    <div class="notice" role="status">
      <p>{t(locale, notice.key, { count: notice.count })}</p>
      <button type="button" class="secondary" onclick={() => (notice = null)}>
        {t(locale, 'memory.notice.dismiss')}
      </button>
    </div>
  {/if}

  <form class="search" role="search" onsubmit={(event) => event.preventDefault()}>
    <div class="field query">
      <label for="ex-q">{t(locale, 'explore.search.label')}</label>
      <input
        id="ex-q"
        type="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        maxlength="200"
        aria-describedby="ex-q-hint"
        bind:value={filters.query}
        bind:this={searchEl}
      />
      <p id="ex-q-hint" class="hint">{t(locale, 'explore.search.hint')}</p>
    </div>

    <div class="filters">
      <div class="field">
        <label for="ex-cat">{t(locale, 'explore.filter.category')}</label>
        <select id="ex-cat" bind:value={filters.category}>
          <option value="">{t(locale, 'explore.filter.any')}</option>
          {#each options.categories as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="ex-flower">{t(locale, 'explore.filter.flower')}</label>
        <select id="ex-flower" bind:value={filters.flower}>
          <option value="">{t(locale, 'explore.filter.any')}</option>
          {#each options.flowers as id (id)}
            <option value={id}>{flowerName(id)}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="ex-season">{t(locale, 'explore.filter.season')}</label>
        <select id="ex-season" bind:value={filters.season}>
          <option value="">{t(locale, 'explore.filter.any')}</option>
          {#each options.seasons as id (id)}
            <option value={id}>{seasonName(id)}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="ex-year">{t(locale, 'explore.filter.year')}</label>
        <select id="ex-year" bind:value={filters.year}>
          <option value="">{t(locale, 'explore.filter.anyYear')}</option>
          {#each options.years as year (year)}
            <option value={year}>{year}</option>
          {/each}
        </select>
      </div>
    </div>

    <button type="button" class="secondary" disabled={!active} onclick={clearFilters}>
      {t(locale, 'explore.clear')}
    </button>
  </form>

  <p class="count" role="status">{announced}</p>

  {#if results.length === 0}
    <p class="none">{t(locale, 'explore.noResults')}</p>
  {:else}
    <ul class="results" bind:this={listEl}>
      {#each visible as memory (memory.id)}
        <li>
          <button
            type="button"
            class="row"
            data-memory={memory.id}
            onclick={(event) => openMemory(memory, event.currentTarget)}
          >
            <span class="pol" aria-hidden="true">
              <Polaroid flower={memory.flower} src={covers[memory.id] || null} />
            </span>
            <span class="text">
              <span class="title">{memory.title}</span>
              <span class="meta">
                <span>{shortDate(memory.date)}</span>
                <span>{memory.category}</span>
              </span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if remaining > 0}
      <button type="button" class="secondary more" onclick={() => void showMore()}>
        {t(locale, 'explore.more', { count: remaining })}
      </button>
    {/if}
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
  .state,
  .notice {
    max-width: 36rem;
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }
  .state h2 {
    font-size: var(--text-lg);
  }
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    max-width: none;
    padding: var(--space-3) var(--space-4);
    border-color: var(--color-primary);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .notice p {
    margin: 0;
  }
  .primary,
  .secondary {
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
  .primary {
    border-color: transparent;
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-weight: 600;
  }
  .secondary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .search {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
    margin-bottom: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    box-shadow: var(--shadow-card);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .query,
  .filters {
    width: 100%;
  }
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
    gap: var(--space-3);
  }
  label {
    font-weight: 600;
  }
  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: var(--tap-min);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    background: var(--color-bg);
    color: var(--color-text);
    font: inherit;
    /* 16 px como mínimo: Safari iOS no amplía la página al enfocar el campo. */
    font-size: max(1rem, 16px);
  }
  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }

  .count {
    min-height: 1.5em;
    margin: 0 0 var(--space-3);
    font-weight: 600;
  }
  .none {
    color: var(--color-text-muted);
  }
  .results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-2);
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 100%;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-md);
    background: var(--color-card);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--color-surface-soft);
  }
  .pol {
    flex: none;
    display: block;
    width: 2.75rem;
  }
  .text {
    display: grid;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-3);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
</style>
