<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { capitalize, formatMonthYear } from '@/lib/dates';
  import { DEFAULT_LOCALE, t, type Locale } from '@/lib/i18n';
  import { lockGarden } from './garden-data';
  import GardenView from './GardenView.svelte';
  import PlaceholderView from './PlaceholderView.svelte';
  import { NAV_LABEL_KEY, PATHS, VIEWS, viewFromPath, type View } from './router';
  import { viewState } from './view-state.svelte';

  const locale: Locale = DEFAULT_LOCALE;
  // Solo se monta en el navegador (client:only): `window` existe.
  let view = $state<View>(viewFromPath(window.location.pathname) ?? 'garden');
  let headingEl: HTMLHeadingElement | undefined;

  const title = $derived(
    view === 'garden'
      ? capitalize(formatMonthYear(viewState.month, locale))
      : t(locale, NAV_LABEL_KEY[view]),
  );

  $effect(() => {
    document.title = `${t(locale, NAV_LABEL_KEY[view])} · ${t(locale, 'app.name')}`;
  });

  async function show(next: View, push: boolean) {
    view = next;
    if (push) history.pushState(null, '', PATHS[next]);
    await tick();
    headingEl?.focus();
  }

  function onNavClick(event: MouseEvent, target: View) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (target !== view) void show(target, true);
  }

  onMount(() => {
    const onPopState = () => {
      void show(viewFromPath(window.location.pathname) ?? 'garden', false);
    };
    // D-082: volver atrás (bfcache) no debe dejar la aplicación desbloqueada.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    const onPageHide = () => lockGarden();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    };
  });
</script>

{#snippet icon(key: View)}
  <svg
    class="icon"
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#if key === 'garden'}
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    {:else if key === 'bouquets'}
      <circle cx="12" cy="8" r="4" />
      <path d="M12 12v9M12 17c-3 0-5-1-6-3M12 17c3 0 5-1 6-3" />
    {:else if key === 'explore'}
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    {:else}
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    {/if}
  </svg>
{/snippet}

<div class="shell">
  <nav class="nav" aria-label={t(locale, 'nav.label')}>
    <a class="brand" href={PATHS.garden} onclick={(e) => onNavClick(e, 'garden')}>
      {t(locale, 'app.name')}
    </a>
    <ul>
      {#each VIEWS as key (key)}
        <li>
          <a
            href={PATHS[key]}
            aria-current={view === key ? 'page' : undefined}
            onclick={(e) => onNavClick(e, key)}
          >
            {@render icon(key)}
            <span class="label">{t(locale, NAV_LABEL_KEY[key])}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="content">
    <header class="topbar">
      <h1 tabindex="-1" bind:this={headingEl}>{title}</h1>
      <a
        class="avatar"
        href={PATHS.settings}
        aria-label={t(locale, 'shell.avatar')}
        onclick={(e) => onNavClick(e, 'settings')}
      >
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="12" cy="12" r="2.5" />
          <circle cx="12" cy="5.5" r="2.5" />
          <circle cx="12" cy="18.5" r="2.5" />
          <circle cx="5.5" cy="12" r="2.5" />
          <circle cx="18.5" cy="12" r="2.5" />
        </svg>
      </a>
    </header>

    <main id="contenido" tabindex="-1">
      {#if view === 'garden'}
        <GardenView {locale} onNavigate={(next) => void show(next, true)} />
      {:else if view === 'bouquets'}
        <PlaceholderView {locale} messageKey="view.soon.bouquets" />
      {:else if view === 'explore'}
        <PlaceholderView {locale} messageKey="view.soon.explore" />
      {:else}
        <PlaceholderView {locale} messageKey="view.soon.settings" />
      {/if}
    </main>
  </div>
</div>

<style>
  .shell {
    --bar-h: 4rem;
    min-height: 100vh;
    min-height: 100dvh;
  }
  .content {
    min-width: 0;
    padding-bottom: calc(var(--bar-h) + env(safe-area-inset-bottom));
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    max-width: 80rem;
    margin-inline: auto;
    padding: var(--space-4) var(--gutter) var(--space-3);
  }
  h1 {
    min-width: 0;
    margin: 0;
    font-size: var(--text-xl);
    overflow-wrap: anywhere;
  }
  h1:focus {
    outline: none;
  }
  main {
    width: 100%;
    max-width: 80rem;
    margin-inline: auto;
    padding: var(--space-3) var(--gutter) var(--space-6);
  }
  main:focus {
    outline: none;
  }
  .avatar {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-pill);
    background: var(--color-surface-accent);
    color: var(--color-primary);
  }

  /* Móvil: barra inferior */
  .nav {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 20;
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid var(--color-border-decor);
    background: var(--color-bg);
  }
  .brand {
    display: none;
  }
  ul {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    flex: 1 1 0;
    min-width: 0;
  }
  li a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--bar-h);
    padding: var(--space-2) 0;
    color: var(--color-text-muted);
    text-align: center;
    text-decoration: none;
  }
  li a[aria-current='page'] {
    color: var(--color-primary);
    box-shadow: inset 0 3px 0 var(--color-primary);
  }
  .label {
    display: block;
    font-size: 0.75rem;
    letter-spacing: -0.01em;
  }
  .icon {
    flex: none;
  }
  @media (max-width: 23.75rem) {
    .label {
      font-size: 0.625rem;
    }
  }
  /* iOS, móvil (D-150): el documento no se desplaza; solo lo hace .content.
     Así Safari iOS 26 no dibuja contenido bajo su barra flotante. */
  @supports (-webkit-touch-callout: none) {
    @media (max-width: 47.99rem) {
      :global(html),
      :global(body) {
        height: 100%;
        overflow: hidden;
      }
      .shell {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .nav {
        position: static;
        order: 2;
        flex: none;
      }
      .content {
        order: 1;
        flex: 1 1 auto;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-bottom: 0;
      }
      /* El enlace de salto cae bajo el contenedor fijo: se fija para que se vea al enfocarlo. */
      :global(.skip-link:focus) {
        position: fixed;
        top: var(--space-2);
        z-index: 100;
        margin: 0;
      }
    }
  }
  /* Escritorio y tableta: menú lateral */
  @media (min-width: 48rem) {
    .shell {
      display: grid;
      grid-template-columns: 14rem minmax(0, 1fr);
    }
    .content {
      padding-bottom: 0;
    }
    .nav {
      position: sticky;
      top: 0;
      align-self: start;
      display: flex;
      flex-direction: column;
      gap: var(--space-5);
      height: 100vh;
      height: 100dvh;
      padding: var(--space-5) var(--space-3);
      border-top: 0;
      border-right: 1px solid var(--color-border-decor);
    }
    .brand {
      display: block;
      padding: 0 var(--space-3);
      font-family: var(--font-title);
      font-size: var(--text-lg);
      font-weight: 600;
      color: var(--color-text);
      text-decoration: none;
    }
    ul {
      flex-direction: column;
      gap: var(--space-1);
    }
    li a {
      flex-direction: row;
      justify-content: flex-start;
      gap: var(--space-3);
      min-height: var(--tap-min);
      padding: var(--space-3);
      border-radius: var(--radius-md);
      text-align: left;
    }
    li a[aria-current='page'] {
      background: var(--color-surface);
      box-shadow: none;
    }
    .label {
      font-size: var(--text-base);
    }
    .topbar,
    main {
      padding-inline: var(--space-6);
    }
  }
</style>
