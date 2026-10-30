<script lang="ts">
  import type { GardenMemory } from '@/features/calendar';
  import { capitalize, formatLongDate, formatShortDate, parseIso } from '@/lib/dates';
  import { t, type Locale } from '@/lib/i18n';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import Polaroid from './Polaroid.svelte';

  let {
    locale,
    featured,
    monthCount,
    dayCount,
    recent,
    onSelectDate,
    onOpenBouquets,
  }: {
    locale: Locale;
    featured: GardenMemory | null;
    monthCount: number;
    dayCount: number;
    recent: readonly GardenMemory[];
    onSelectDate: (iso: string) => void;
    onOpenBouquets: () => void;
  } = $props();

  const longDate = (iso: string) => {
    const d = parseIso(iso);
    return d ? capitalize(formatLongDate(d, locale)) : iso;
  };
  const shortDate = (iso: string) => {
    const d = parseIso(iso);
    return d ? formatShortDate(d, locale) : iso;
  };

  function onBouquetClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenBouquets();
  }
</script>

<div class="aside">
  <section class="card" aria-labelledby="aside-featured">
    <h2 id="aside-featured">{t(locale, 'garden.aside.featured')}</h2>
    {#if featured}
      {@const f = featured}
      <button type="button" class="featured" onclick={() => onSelectDate(f.date)}>
        <span class="ph"><Polaroid flower={f.flower} /></span>
        <span class="ft">
          <span class="title">{f.title}</span>
          <span class="when">{longDate(f.date)}</span>
        </span>
      </button>
    {:else}
      <p class="muted">{t(locale, 'garden.aside.featured.none')}</p>
    {/if}
  </section>

  <section class="card" aria-labelledby="aside-month">
    <h2 id="aside-month">{t(locale, 'garden.aside.month')}</h2>
    <p>{t(locale, 'garden.aside.stat.memories', { count: monthCount })}</p>
    <p>{t(locale, 'garden.aside.stat.days', { count: dayCount })}</p>
    <a class="bouquet" href="/ramos" onclick={onBouquetClick}>
      {t(locale, 'garden.aside.bouquet')}
    </a>
  </section>

  <section class="card" aria-labelledby="aside-recent">
    <h2 id="aside-recent">{t(locale, 'garden.aside.recent')}</h2>
    {#if recent.length === 0}
      <p class="muted">{t(locale, 'garden.aside.recent.none')}</p>
    {:else}
      <ul class="list">
        {#each recent as memory (memory.id)}
          <li>
            <button type="button" class="row" onclick={() => onSelectDate(memory.date)}>
              <span class="fm"><FlowerMark flower={memory.flower} /></span>
              <span class="title">{memory.title}</span>
              <span class="when">{shortDate(memory.date)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .aside {
    display: grid;
    gap: var(--space-4);
  }
  .card {
    padding: var(--space-4);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    box-shadow: var(--shadow-card);
  }
  h2 {
    margin-bottom: var(--space-3);
    font-size: var(--text-lg);
  }
  p {
    margin: 0 0 var(--space-2);
  }
  .muted,
  .when {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .featured,
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
  .featured:hover,
  .row:hover {
    background: var(--color-surface-soft);
  }
  .ph {
    flex: none;
    width: 3.5rem;
  }
  .ft {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .fm {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
  }
  .row .title {
    flex: 1 1 auto;
  }
  .row .when {
    flex: none;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .bouquet {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap-min);
  }
</style>
