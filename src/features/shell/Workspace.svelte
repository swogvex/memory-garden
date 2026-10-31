<script lang="ts">
  import FlowerSprite from '@/components/ui/FlowerSprite.svelte';
  import { DangerSection, SecuritySection, SignOut } from '@/features/access';
  import { AvatarBadge, SettingsView, loadPrefs, prefs, resetPrefs } from '@/features/settings';
  import { t, type Locale } from '@/lib/i18n';
  import BouquetsView from './BouquetsView.svelte';
  import {
    forgetMemories,
    openBackupSource,
    openGardenSource,
    openSettingsSource,
    openTrashSource,
  } from './garden-data';
  import GardenView from './GardenView.svelte';
  import PlaceholderView from './PlaceholderView.svelte';
  import { NAV_LABEL_KEY, PATHS, VIEWS, type View } from './router';
  import { viewState } from './view-state.svelte';

  /**
   * La aplicación con sesión (menú, cabecera y vistas). Se carga aparte (import dinámico desde AppShell):
   * la pantalla de acceso no descarga ni ejecuta el Jardín, los Ramos, las flores ni Configuración.
   * El estado de navegación (`view`) y el título del documento siguen en AppShell.
   */
  let {
    locale,
    view,
    title,
    bypassAccess,
    onNavClick,
    onNavigate,
    heading = $bindable(),
  }: {
    locale: Locale;
    view: View;
    title: string;
    bypassAccess: boolean;
    onNavClick: (event: MouseEvent, target: View) => void;
    onNavigate: (next: View) => void;
    heading?: HTMLHeadingElement;
  } = $props();

  const eyebrow = $derived(
    prefs.settings.displayName
      ? t(locale, 'shell.eyebrow.named', {
          name: prefs.settings.displayName,
          year: viewState.month.year,
        })
      : t(locale, 'shell.eyebrow', { year: viewState.month.year }),
  );
  const subtitle = $derived(prefs.settings.welcomeMessage || t(locale, 'app.tagline'));

  /** Con la sesión abierta (el contenido se monta) se cargan los ajustes; al bloquear (se desmonta), se olvidan. */
  function sessionPrefs() {
    void loadPrefs(openSettingsSource);
    // Al bloquear (se desmonta) se olvidan también los recuerdos descifrados que se guardaban para cambiar de sección.
    return {
      destroy: () => {
        resetPrefs();
        forgetMemories();
      },
    };
  }
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

{#snippet signOut()}
  <SignOut {locale} />
{/snippet}

{#snippet security()}
  <SecuritySection {locale} />
{/snippet}

{#snippet danger()}
  <DangerSection {locale} />
{/snippet}

<FlowerSprite />
<div class="shell" use:sessionPrefs>
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
      <div class="titles">
        {#if view === 'garden'}
          <p class="eyebrow">{eyebrow}</p>
        {/if}
        <h1 tabindex="-1" bind:this={heading}>{title}</h1>
        {#if view === 'garden'}
          <p class="subtitle">{subtitle}</p>
        {/if}
      </div>
      <a
        class="avatar"
        href={PATHS.settings}
        aria-label={t(locale, 'shell.avatar')}
        onclick={(e) => onNavClick(e, 'settings')}
      >
        <AvatarBadge />
      </a>
    </header>

    <main id="contenido" tabindex="-1">
      {#if view === 'garden'}
        <GardenView {locale} {onNavigate} />
      {:else if view === 'bouquets'}
        <BouquetsView {locale} {onNavigate} />
      {:else if view === 'explore'}
        <PlaceholderView {locale} messageKey="view.soon.explore" />
      {:else}
        <SettingsView
          {locale}
          openGarden={openGardenSource}
          openBackup={openBackupSource}
          openTrash={openTrashSource}
          session={bypassAccess ? undefined : signOut}
          security={bypassAccess ? undefined : security}
          danger={bypassAccess ? undefined : danger}
        />
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    /* La fila del antetítulo se reserva aunque esté vacía: el título y el avatar quedan a la misma
       altura en todas las secciones y no saltan al cambiar (el antetítulo solo lo tiene el Jardín). */
    grid-template-rows: minmax(calc(0.75rem * var(--leading-body)), auto) auto auto;
    grid-template-areas:
      'eyebrow .'
      'title avatar'
      'subtitle .';
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 0.125rem;
    width: 100%;
    max-width: 80rem;
    margin-inline: auto;
    padding: var(--space-4) var(--gutter) var(--space-3);
  }
  .titles {
    display: contents;
  }
  .eyebrow {
    grid-area: eyebrow;
  }
  h1 {
    grid-area: title;
    min-width: 0;
    margin: 0;
    font-size: clamp(1.75rem, 5vw, 2.4rem);
    overflow-wrap: anywhere;
  }
  .subtitle {
    grid-area: subtitle;
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-line; /* el mensaje de bienvenida admite saltos de línea */
    font-family: var(--font-title);
    font-style: italic;
    color: var(--color-text-muted);
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
    grid-area: avatar;
    flex: none;
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 2px solid #fff;
    border-radius: var(--radius-pill);
    background: var(--color-surface-soft);
    box-shadow: var(--shadow-sm);
    color: var(--color-primary);
    overflow: hidden;
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
    font-weight: 600;
  }
  /* Móvil: el icono activo va en una cápsula lavanda (como el menú de escritorio). */
  li a[aria-current='page'] .icon {
    box-sizing: content-box;
    padding: 2px 12px;
    border-radius: var(--radius-control);
    background: var(--color-surface-soft);
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
      background: var(--color-surface-soft);
    }
    li a[aria-current='page'] .icon {
      padding: 0;
      background: none;
    }
    .label {
      font-size: var(--text-base);
    }
    .topbar,
    main {
      padding-inline: var(--space-6);
    }
    .nav {
      background: rgb(255 253 249 / 55%);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .brand::before {
      content: '';
      flex: none;
      width: 2rem;
      height: 2rem;
      background: url('/decor/mark.svg') no-repeat center / contain;
    }
    /* Macizo de flores al pie del menú: nace del borde inferior y se mece (decorativo). */
    .nav::after {
      content: '';
      position: absolute;
      left: 0;
      bottom: 0;
      width: 100%;
      height: 15rem;
      background: url('/decor/nav.svg') no-repeat left bottom / contain;
      transform-origin: 30% 100%;
      pointer-events: none;
    }
  }
  @media (min-width: 48rem) and (prefers-reduced-motion: no-preference) {
    .nav::after {
      animation: mg-sway 8.5s ease-in-out infinite alternate;
    }
  }
  /* Ventanas bajas: sin adorno, para que nunca tape los enlaces. */
  @media (min-width: 48rem) and (max-height: 42rem) {
    .nav::after {
      display: none;
    }
  }
</style>
