<script lang="ts">
  import type { GardenMemory } from '@/features/calendar';
  import { capitalize, formatLongDate, parseIso } from '@/lib/dates';
  import { t, type Locale } from '@/lib/i18n';
  import FlowerMark from './FlowerMark.svelte';

  let {
    locale,
    iso,
    memories,
    headingId,
  }: { locale: Locale; iso: string; memories: readonly GardenMemory[]; headingId: string } =
    $props();

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
        <span class="fm"><FlowerMark flower={memory.flower} /></span>
        <span class="text">
          <span class="title">{memory.title}</span>
          <span class="cat">{memory.category}</span>
        </span>
      </li>
    {/each}
  </ul>
{/if}

<button
  type="button"
  class="add"
  aria-disabled="true"
  aria-describedby="{headingId}-soon"
  onclick={(event) => event.preventDefault()}
>
  {t(locale, 'garden.add')}
</button>
<p id="{headingId}-soon" class="soon">{t(locale, 'garden.add.soon')}</p>

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
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--color-border-decor);
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
    border: 2px dashed var(--color-border-control);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--color-text-muted);
    font: inherit;
    cursor: not-allowed;
  }
  .soon {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
</style>
