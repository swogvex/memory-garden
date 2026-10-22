<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    daysWithMemories,
    groupByDate,
    memoriesInMonth,
    monthCounts,
    nextFocusDate,
    sortRecent,
    type CreateMemoryResult,
    type GardenMemory,
    type GardenSource,
    type SaveMemoryInput,
  } from '@/features/calendar';
  import { DEFAULT_CATEGORIES, MemoryDialog, MemoryView } from '@/features/memories';
  import {
    addMonths,
    capitalize,
    formatLongDate,
    formatMonthYear,
    monthGrid,
    monthShortLabels,
    parseIso,
    todayIn,
    toIso,
    weekdayLabels,
    ymKey,
    type CalendarDate,
    type YearMonth,
  } from '@/lib/dates';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import AsidePanel from './AsidePanel.svelte';
  import DayPanel from './DayPanel.svelte';
  import { openGardenSource } from './garden-data';
  import Polaroid from './Polaroid.svelte';
  import type { View } from './router';
  import { viewState } from './view-state.svelte';

  let { locale, onNavigate }: { locale: Locale; onNavigate: (view: View) => void } = $props();

  type LoadState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; memories: readonly GardenMemory[] };
  type Direction = 'none' | 'next' | 'prev';

  let load = $state<LoadState>({ status: 'loading' });
  let selectedIso = $state<string | null>(null);
  let focusIso = $state<string | null>(null);
  let sheetOpen = $state(false);
  let dir = $state<Direction>('none');
  // client:only: `window` existe.
  let wide = $state(window.matchMedia('(min-width: 64rem)').matches);
  let wrapEl = $state<HTMLDivElement>();
  let gridEl = $state<HTMLTableElement>();
  let sheetEl = $state<HTMLDialogElement>();
  let chipsEl = $state<HTMLDivElement>();
  let source: GardenSource | null = null;
  let formOpen = $state(false);
  let formDate = $state('');
  let formOpener: HTMLElement | null = null;
  let notice = $state<{ key: MessageKey; count: number } | null>(null);
  let viewing = $state<GardenMemory | null>(null);
  let editing = $state<GardenMemory | null>(null);
  let viewOpener: HTMLElement | null = null;
  let covers = $state<{ month: string; urls: Record<string, string> }>({ month: '', urls: {} });

  const todayIso = toIso(todayIn());

  const weekdays = $derived(weekdayLabels(locale));
  const monthLabels = $derived(monthShortLabels(locale));
  const memories = $derived(load.status === 'ready' ? load.memories : []);
  const byDate = $derived(groupByDate(memories));
  const counts = $derived(monthCounts(memories));
  const monthKey = $derived(ymKey(viewState.month));
  const grid = $derived(monthGrid({ year: viewState.month.year, month: viewState.month.month }));
  const monthMemories = $derived(memoriesInMonth(memories, viewState.month));
  const featured = $derived(sortRecent(monthMemories)[0] ?? null);
  const recent = $derived(sortRecent(memories).slice(0, 5));
  const dayCount = $derived(daysWithMemories(monthMemories));
  const selectedMemories = $derived(selectedIso ? (byDate.get(selectedIso) ?? []) : []);
  const monthText = $derived(formatMonthYear(viewState.month, locale));

  const tabIso = $derived.by(() => {
    const inMonth = (iso: string | null): iso is string =>
      iso !== null && iso.startsWith(`${monthKey}-`);
    if (inMonth(focusIso)) return focusIso;
    if (inMonth(selectedIso)) return selectedIso;
    if (inMonth(todayIso)) return todayIso;
    return `${monthKey}-01`;
  });

  const nText = (n: number) =>
    n === 0
      ? t(locale, 'garden.n.none')
      : n === 1
        ? t(locale, 'garden.n.one')
        : t(locale, 'garden.n.many', { count: n });
  const dayLabel = (date: CalendarDate, n: number) =>
    `${formatLongDate(date, locale)}, ${nText(n)}`;
  const countKey = $derived(
    monthMemories.length === 0
      ? 'garden.count.none'
      : monthMemories.length === 1
        ? 'garden.count.one'
        : 'garden.count.many',
  );
  const monthSummary = $derived(`${capitalize(monthText)}: ${nText(monthMemories.length)}`);

  async function start() {
    load = { status: 'loading' };
    try {
      source = await openGardenSource();
      load = { status: 'ready', memories: await source.list() };
    } catch {
      load = { status: 'error' };
    }
  }

  function setMonth(next: YearMonth, direction: Direction, clearSelection = true) {
    dir = direction;
    viewState.month = { year: next.year, month: next.month };
    focusIso = null;
    if (clearSelection) {
      selectedIso = null;
      sheetOpen = false;
    }
  }
  const stepMonth = (delta: number) =>
    setMonth(addMonths(viewState.month, delta), delta > 0 ? 'next' : 'prev');
  const monthDelta = (year: number, month: number) =>
    year * 12 + month - (viewState.month.year * 12 + viewState.month.month);

  const dayButton = (iso: string) =>
    gridEl?.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`);

  async function focusDate(date: CalendarDate) {
    const delta = monthDelta(date.year, date.month);
    if (delta !== 0)
      setMonth({ year: date.year, month: date.month }, delta > 0 ? 'next' : 'prev', false);
    const iso = toIso(date);
    focusIso = iso;
    await tick();
    dayButton(iso)?.focus();
  }

  function selectDay(iso: string) {
    selectedIso = iso;
    focusIso = iso;
    if (!wide) sheetOpen = true;
  }

  async function goToDate(iso: string) {
    const d = parseIso(iso);
    if (!d) return;
    const delta = monthDelta(d.year, d.month);
    if (delta !== 0) setMonth({ year: d.year, month: d.month }, delta > 0 ? 'next' : 'prev');
    selectDay(iso);
    await tick();
    if (wide) dayButton(iso)?.focus();
  }

  function openForm(iso: string, trigger: HTMLElement) {
    formOpener = trigger;
    formDate = iso;
    notice = null;
    editing = null;
    formOpen = true;
  }

  const loadImage = (memory: GardenMemory, index: number, size: 'thumb' | 'photo') =>
    source ? source.imageUrl(memory, index, size) : Promise.resolve(null);

  function openMemory(memory: GardenMemory, trigger: HTMLElement) {
    viewOpener = trigger;
    notice = null;
    viewing = memory;
  }

  function trashMemory(memory: GardenMemory): Promise<void> {
    return source ? source.trash(memory.id) : Promise.reject(new Error('garden:unavailable'));
  }

  async function onViewClosed(outcome: 'closed' | 'edit' | 'trashed') {
    const memory = viewing;
    viewing = null;
    if (!memory) return;
    if (outcome === 'edit') {
      editing = memory;
      formDate = memory.date;
      formOpener = viewOpener;
      viewOpener = null;
      formOpen = true;
      return;
    }
    if (outcome === 'trashed' && load.status === 'ready') {
      load = { status: 'ready', memories: load.memories.filter((m) => m.id !== memory.id) };
      delete covers.urls[memory.id];
      notice = { key: 'memory.trashed', count: 0 };
    }
    await tick();
    const opener = viewOpener;
    viewOpener = null;
    if (outcome === 'closed' && opener?.isConnected) opener.focus();
    else if (selectedIso) dayButton(selectedIso)?.focus();
  }

  function saveMemory(input: SaveMemoryInput): Promise<CreateMemoryResult> {
    if (!source) return Promise.reject(new Error('garden:unavailable'));
    if (editing) return source.update(editing.id, input);
    return source.create({
      fields: input.fields,
      photos: input.photos.flatMap((p) =>
        p.kind === 'new' ? [{ photo: p.photo, thumb: p.thumb, alt: p.alt }] : [],
      ),
    });
  }

  async function onFormClosed(result: CreateMemoryResult | null) {
    const wasEditing = editing;
    formOpen = false;
    editing = null;
    if (result && load.status === 'ready') {
      const failed = result.failedPhotos.length;
      const list = wasEditing
        ? load.memories.map((m) => (m.id === result.memory.id ? result.memory : m))
        : [...load.memories, result.memory];
      if (wasEditing) delete covers.urls[result.memory.id];
      load = { status: 'ready', memories: list };
      notice = {
        key:
          failed === 0
            ? wasEditing
              ? 'memory.updated'
              : 'memory.saved'
            : failed === 1
              ? 'memory.saved.partial.one'
              : 'memory.saved.partial.many',
        count: failed,
      };
      await goToDate(result.memory.date);
    }
    await tick();
    const opener = formOpener;
    formOpener = null;
    if (opener?.isConnected) opener.focus();
    else if (selectedIso) dayButton(selectedIso)?.focus();
  }

  function onGridKeydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const iso = (event.target as HTMLElement).closest<HTMLElement>('[data-iso]')?.dataset.iso;
    const from = iso ? parseIso(iso) : null;
    if (!from) return;
    const next = nextFocusDate(from, event.key, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    void focusDate(next);
  }

  // Gesto horizontal (solo táctil, sin sustituir a los botones) y teclado de la cuadrícula.
  $effect(() => {
    const el = wrapEl;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') start = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!s || e.pointerType !== 'touch') return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
      stepMonth(dx < 0 ? 1 : -1);
    };
    const cancel = () => {
      start = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('keydown', onGridKeydown);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('keydown', onGridKeydown);
    };
  });

  // Hoja inferior: <dialog> modal nativo (foco atrapado y Escape). El foco vuelve al día seleccionado.
  $effect(() => {
    const el = sheetEl;
    if (!el) return;
    if (sheetOpen && !wide) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  });
  $effect(() => {
    const el = sheetEl;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === el) el.close();
    };
    const onClose = () => {
      sheetOpen = false;
      const iso = selectedIso;
      if (iso) void tick().then(() => dayButton(iso)?.focus());
    };
    el.addEventListener('click', onClick);
    el.addEventListener('close', onClose);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('close', onClose);
    };
  });

  // Mantiene visible el chip del mes actual.
  $effect(() => {
    void monthKey;
    chipsEl
      ?.querySelector('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });

  // Portadas reales: miniatura descifrada de la primera foto, una a una (D-142).
  $effect(() => {
    if (load.status !== 'ready') return;
    const src = source;
    if (!src) return;
    if (covers.month !== monthKey) {
      covers = { month: monthKey, urls: {} };
      return;
    }
    const pending = monthMemories.filter(
      (m) => m.photos.length > 0 && covers.urls[m.id] === undefined,
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const m of pending) {
        if (cancelled) return;
        const url = await src.imageUrl(m, 0, 'thumb');
        if (cancelled) return;
        covers.urls[m.id] = url ?? ''; // '' = sin portada: se queda la flor y no se reintenta
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  onMount(() => {
    const mq = window.matchMedia('(min-width: 64rem)');
    const onChange = (e: MediaQueryListEvent) => {
      wide = e.matches;
    };
    mq.addEventListener('change', onChange);
    void start();
    return () => mq.removeEventListener('change', onChange);
  });
</script>

{#if load.status === 'loading'}
  <p role="status">{t(locale, 'garden.loading')}</p>
{:else if load.status === 'error'}
  <div class="state" role="alert">
    <h2>{t(locale, 'garden.error.title')}</h2>
    <p>{t(locale, 'garden.error.body')}</p>
    <button type="button" class="retry" onclick={start}>{t(locale, 'garden.error.retry')}</button>
  </div>
{:else}
  <p class="visually-hidden" role="status">{monthSummary}</p>
  {#if notice}
    <div class="notice" role="status">
      <p>{t(locale, notice.key, { count: notice.count })}</p>
      <button type="button" class="notice-close" onclick={() => (notice = null)}>
        {t(locale, 'memory.notice.dismiss')}
      </button>
    </div>
  {/if}
  <div class="layout">
    <div class="main-col">
      <div class="toolbar">
        <button
          type="button"
          class="step"
          aria-label={t(locale, 'garden.nav.prev')}
          onclick={() => stepMonth(-1)}
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"><path d="m15 5-7 7 7 7" /></svg
          >
        </button>
        <p class="count">{t(locale, countKey, { count: monthMemories.length })}</p>
        <button
          type="button"
          class="step"
          aria-label={t(locale, 'garden.nav.next')}
          onclick={() => stepMonth(1)}
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"><path d="m9 5 7 7-7 7" /></svg
          >
        </button>
      </div>

      <div
        class="chips"
        role="group"
        aria-label={t(locale, 'garden.months.label', { year: viewState.month.year })}
        bind:this={chipsEl}
      >
        {#each monthLabels as label, i (i)}
          {@const m = i + 1}
          {@const n = counts.get(ymKey({ year: viewState.month.year, month: m })) ?? 0}
          <button
            type="button"
            class="chip"
            class:current={m === viewState.month.month}
            aria-current={m === viewState.month.month ? 'true' : undefined}
            aria-label="{formatMonthYear({ year: viewState.month.year, month: m }, locale)}, {nText(
              n,
            )}"
            onclick={() => {
              if (m !== viewState.month.month)
                setMonth(
                  { year: viewState.month.year, month: m },
                  m > viewState.month.month ? 'next' : 'prev',
                );
            }}
          >
            <span aria-hidden="true">{label}</span>
            {#if n > 0}<span class="dot" aria-hidden="true"></span>{/if}
          </button>
        {/each}
      </div>

      <div class="grid-wrap" bind:this={wrapEl}>
        {#key monthKey}
          <table
            class="grid"
            class:slide-next={dir === 'next'}
            class:slide-prev={dir === 'prev'}
            role="grid"
            aria-label={t(locale, 'garden.grid.label', { month: monthText })}
            bind:this={gridEl}
          >
            <thead>
              <tr>
                {#each weekdays as w (w.long)}
                  <th scope="col">
                    <span aria-hidden="true">{w.short}</span>
                    <span class="visually-hidden">{w.long}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each grid as week (week[0]?.iso)}
                <tr>
                  {#each week as cell (cell.iso)}
                    {#if cell.inMonth}
                      {@const list = byDate.get(cell.iso) ?? []}
                      {@const first = list[0]}
                      <td role="gridcell">
                        <button
                          type="button"
                          class="day"
                          class:selected={selectedIso === cell.iso}
                          class:today={cell.iso === todayIso}
                          data-iso={cell.iso}
                          tabindex={cell.iso === tabIso ? 0 : -1}
                          aria-pressed={selectedIso === cell.iso}
                          aria-current={cell.iso === todayIso ? 'date' : undefined}
                          aria-label={dayLabel(cell.date, list.length)}
                          onclick={() => selectDay(cell.iso)}
                        >
                          <span class="num" aria-hidden="true">{cell.date.day}</span>
                          {#if first}
                            <span class="thumb" aria-hidden="true">
                              <span class="pol"
                                ><Polaroid
                                  flower={first.flower}
                                  src={covers.urls[first.id] || null}
                                /></span
                              >
                              {#if list.length > 1}<span class="plus">+{list.length - 1}</span>{/if}
                            </span>
                          {/if}
                        </button>
                      </td>
                    {:else}
                      <td role="gridcell" aria-disabled="true"
                        ><span class="out">{cell.date.day}</span></td
                      >
                    {/if}
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/key}
      </div>

      {#if monthMemories.length === 0}
        <p class="empty">{t(locale, 'garden.empty')}</p>
      {/if}
    </div>

    <div class="side">
      {#if wide && selectedIso}
        <section class="card" aria-labelledby="day-heading">
          <DayPanel
            {locale}
            iso={selectedIso}
            memories={selectedMemories}
            headingId="day-heading"
            onAdd={openForm}
            onOpen={openMemory}
          />
        </section>
      {/if}
      <AsidePanel
        {locale}
        {featured}
        monthCount={monthMemories.length}
        {dayCount}
        {recent}
        onSelectDate={(iso) => void goToDate(iso)}
        onOpenBouquets={() => onNavigate('bouquets')}
      />
    </div>
  </div>

  <dialog class="sheet" bind:this={sheetEl} aria-labelledby="day-heading">
    <div class="sheet-body">
      {#if selectedIso}
        <div class="sheet-top">
          <button type="button" class="close" onclick={() => sheetEl?.close()}>
            {t(locale, 'garden.sheet.close')}
          </button>
        </div>
        <DayPanel
          {locale}
          iso={selectedIso}
          memories={selectedMemories}
          headingId="day-heading"
          onAdd={openForm}
          onOpen={openMemory}
        />
      {/if}
    </div>
  </dialog>
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
  {#if formOpen}
    <MemoryDialog
      {locale}
      date={formDate}
      categories={DEFAULT_CATEGORIES}
      memory={editing}
      loadThumb={(m, index) => loadImage(m, index, 'thumb')}
      onSave={saveMemory}
      onClose={(result) => void onFormClosed(result)}
    />
  {/if}
{/if}

<style>
  .state {
    max-width: 36rem;
    padding: var(--space-5);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-lg);
  }
  .state h2 {
    font-size: var(--text-lg);
  }
  .retry,
  .close {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font: inherit;
    cursor: pointer;
  }
  .retry:hover,
  .close:hover {
    background: var(--color-primary-hover);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }
  .main-col {
    min-width: 0;
    container-type: inline-size;
  }
  .side {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  .card {
    padding: var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-lg);
    background: #fff;
  }
  @media (min-width: 64rem) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 20rem;
      gap: var(--space-6);
      align-items: start;
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .count {
    margin: 0;
    font-weight: 600;
    text-align: center;
  }
  .step {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-pill);
    background: #fff;
    color: var(--color-primary);
    cursor: pointer;
  }
  .step:hover {
    background: var(--color-surface);
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
    padding-bottom: var(--space-1);
    overflow-x: auto;
  }
  .chip {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-pill);
    background: #fff;
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }
  .chip.current {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-primary);
  }
  .chip.current .dot {
    background: var(--color-on-primary);
  }
  @media (min-width: 48rem) {
    .chips {
      flex-wrap: wrap;
      overflow: visible;
    }
  }
  @container (min-width: 44rem) {
    .chips {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: var(--space-1);
      overflow: visible;
    }
    .chip {
      justify-content: center;
      padding: 0 var(--space-1);
    }
  }

  .grid-wrap {
    touch-action: pan-y;
    overflow: hidden;
  }
  .grid {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 2px;
  }
  .grid th {
    padding: var(--space-1) 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    font-weight: 600;
    text-align: center;
  }
  .grid td {
    min-width: 0;
    padding: 0;
    vertical-align: top;
  }
  .day {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    width: 100%;
    min-height: 4rem;
    padding: 4px 0 2px;
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    background: #fff;
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
  }
  .day:hover {
    background: var(--color-surface);
  }
  .day:focus-visible {
    z-index: 1;
  }
  .day.selected {
    border-color: var(--color-primary);
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-primary);
  }
  .num {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .day.today .num {
    color: var(--color-primary);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
  .out {
    display: flex;
    justify-content: center;
    min-height: 4rem;
    padding-top: 6px;
    border: 1px dashed var(--color-border-decor);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .thumb {
    position: relative;
    display: block; /* no flex: Safari iOS estiraba la Polaroid (aspect-ratio + SVG al 100 %) */
    width: 100%;
  }
  .pol {
    display: block;
    width: 100%;
    max-width: 1.9rem;
    margin-inline: auto;
  }
  .plus {
    position: absolute;
    top: -2px;
    right: 1px;
    padding: 0 4px;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-size: 0.625rem;
    line-height: 1.3;
  }
  /* El tamaño de la celda depende del ancho de la columna, no del de la ventana. */
  @container (min-width: 36rem) {
    .day,
    .out {
      min-height: 5rem;
    }
    .pol {
      max-width: 2.8rem;
    }
  }
  @container (min-width: 52rem) {
    .day,
    .out {
      min-height: 5.5rem;
    }
    .pol {
      max-width: 3.2rem;
    }
  }

  .slide-next {
    animation: slide-next var(--motion-base) var(--motion-ease);
  }
  .slide-prev {
    animation: slide-prev var(--motion-base) var(--motion-ease);
  }
  @keyframes slide-next {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes slide-prev {
    from {
      opacity: 0;
      transform: translateX(-24px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .empty {
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    text-align: center;
  }

  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .notice p {
    margin: 0;
  }
  .notice-close {
    min-height: var(--tap-min);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-pill);
    background: #fff;
    color: var(--color-primary);
    font: inherit;
    cursor: pointer;
  }

  .sheet {
    width: 100%;
    max-width: 100%;
    max-height: 85dvh;
    margin: auto 0 0;
    padding: 0;
    overflow: auto;
    border: 0;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--color-bg);
    color: var(--color-text);
    box-shadow: var(--shadow-lg);
  }
  .sheet[open] {
    animation: sheet-up var(--motion-base) var(--motion-ease);
  }
  .sheet::backdrop {
    background: rgb(55 49 63 / 45%);
  }
  .sheet-body {
    padding: var(--space-4) var(--gutter) calc(var(--space-5) + env(safe-area-inset-bottom));
  }
  .sheet-top {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--space-2);
  }
  @keyframes sheet-up {
    from {
      transform: translateY(2rem);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
</style>
