<script lang="ts">
  import { onMount } from 'svelte';
  import { memoriesInMonth, sortChronologically, type GardenMemory } from '@/features/calendar';
  import { parseIso } from '@/lib/dates';
  import { t, type Locale } from '@/lib/i18n';
  import { openGardenSource } from './garden-data';
  import { viewState } from './view-state.svelte';

  let { locale }: { locale: Locale } = $props();

  type LoadState =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; memories: readonly GardenMemory[] };

  let load = $state<LoadState>({ status: 'loading' });

  async function start() {
    load = { status: 'loading' };
    try {
      const source = await openGardenSource();
      load = { status: 'ready', memories: await source.list() };
    } catch {
      load = { status: 'error' };
    }
  }

  onMount(() => {
    void start();
  });

  const monthMemories = $derived(
    load.status === 'ready'
      ? sortChronologically(memoriesInMonth(load.memories, viewState.month))
      : [],
  );
  const countKey = $derived(
    monthMemories.length === 0
      ? 'garden.count.none'
      : monthMemories.length === 1
        ? 'garden.count.one'
        : 'garden.count.many',
  );
</script>

{#if load.status === 'loading'}
  <p role="status">{t(locale, 'garden.loading')}</p>
{:else if load.status === 'error'}
  <div class="state" role="alert">
    <h2>{t(locale, 'garden.error.title')}</h2>
    <p>{t(locale, 'garden.error.body')}</p>
    <button type="button" onclick={start}>{t(locale, 'garden.error.retry')}</button>
  </div>
{:else}
  <section>
    <p class="count">{t(locale, countKey, { count: monthMemories.length })}</p>
    <p class="note">{t(locale, 'garden.provisional')}</p>
    <ol class="list">
      {#each monthMemories as memory (memory.id)}
        <li>
          <span class="day">{parseIso(memory.date)?.day}</span>
          <span class="title">{memory.title}</span>
        </li>
      {/each}
    </ol>
  </section>
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
  button {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: var(--color-primary-hover);
  }
  .count {
    font-weight: 600;
  }
  .note {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-decor);
  }
  .day {
    flex: none;
    min-width: 2ch;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-muted);
  }
  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
