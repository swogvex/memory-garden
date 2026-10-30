<script lang="ts">
  import type { GardenMemory } from '@/features/calendar';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import { capitalize, formatLongDate, parseIso } from '@/lib/dates';
  import { t, type Locale } from '@/lib/i18n';

  let {
    locale,
    iso,
    memories,
    headingId,
    onAdd,
    onOpen,
  }: {
    locale: Locale;
    iso: string;
    memories: readonly GardenMemory[];
    headingId: string;
    onAdd: (iso: string, trigger: HTMLElement) => void;
    onOpen: (memory: GardenMemory, trigger: HTMLElement) => void;
  } = $props();

  const date = $derived(parseIso(iso));
  const heading = $derived(date ? capitalize(formatLongDate(date, locale)) : iso);
</script>

<h2 id={headingId}>{heading}</h2>

{#if memories.length === 0}
  <p>{t(locale, 'garden.day.empty')}</p>
{:else}
  <ul class="list">
    {#each memories as memory (memory.id)}
      <li>
        <button type="button" class="row" onclick={(event) => onOpen(memory, event.currentTarget)}>
          <span class="fm"><FlowerMark flower={memory.flower} /></span>
          <span class="text">
            <span class="title">{memory.title}</span>
            <span class="cat">{memory.category}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<button type="button" class="add" onclick={(event) => onAdd(iso, event.currentTarget)}>
  {t(locale, 'garden.add')}
</button>

<style>
  h2 {
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }
  .list {
    margin: 0 0 var(--space-4);
    padding: 0;
    list-style: none;
  }
  li {
    border-bottom: 1px solid var(--color-border-decor);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: var(--tap-min);
    padding: var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--color-surface-soft);
  }
  .fm {
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    overflow-wrap: anywhere;
  }
  .cat {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .add {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-control);
    font-weight: 600;
    background: var(--color-primary);
    color: var(--color-on-primary);
    font: inherit;
    cursor: pointer;
  }
  .add:hover {
    background: var(--color-primary-hover);
  }
</style>
