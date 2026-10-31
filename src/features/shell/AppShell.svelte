<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { AccessGate } from '@/features/access';
  import { LanguageSwitch, prefs } from '@/features/settings';
  import { capitalize, formatMonthYear } from '@/lib/dates';
  import { t, type Locale } from '@/lib/i18n';
  import { lockGarden } from './garden-data';
  import OfflineNotice from './OfflineNotice.svelte';
  import { NAV_LABEL_KEY, PATHS, viewFromPath, type View } from './router';
  import { viewState } from './view-state.svelte';

  // Idioma de toda la interfaz: el de los ajustes cifrados al entrar; antes, el recordado en este navegador.
  const locale: Locale = $derived(prefs.settings.language);
  // Desarrollo: el jardín abre con datos de prueba sin pedir contraseña. Con `?acceso` se prueba el acceso real contra la API local.
  // En producción `import.meta.env.DEV` es `false` y siempre se pide el acceso.
  const bypassAccess =
    import.meta.env.DEV && !new URLSearchParams(window.location.search).has('acceso');
  // Solo se monta en el navegador (client:only): `window` existe.
  let view = $state<View>(viewFromPath(window.location.pathname) ?? 'garden');
  let headingEl = $state<HTMLHeadingElement>();

  // La aplicación con sesión va en su propio archivo y se pide DESPUÉS de pintar el acceso: no compite con la
  // primera carga y, mientras se escribe la contraseña, ya está descargada. Si aún no ha llegado al entrar, se espera.
  // Promesa guardada fuera del estado reactivo: la plantilla la lee sin modificar estado al pintarse.
  type WorkspaceModule = typeof import('./Workspace.svelte');
  let workspace: Promise<WorkspaceModule> | null = null;
  const loadWorkspace = (): Promise<WorkspaceModule> =>
    (workspace ??= import('./Workspace.svelte'));

  const title = $derived(
    view === 'garden'
      ? capitalize(formatMonthYear(viewState.month, locale))
      : t(locale, NAV_LABEL_KEY[view]),
  );

  $effect(() => {
    document.title = `${t(locale, NAV_LABEL_KEY[view])} · ${t(locale, 'app.name')}`;
  });
  $effect(() => {
    document.documentElement.lang = locale;
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
    // Atrás/Adelante entre secciones. Dentro de una misma sección (p. ej. el ramo abierto en Ramos, D-264) la
    // vista gestiona su propio historial y aquí no se toca el foco.
    const onPopState = () => {
      const next = viewFromPath(window.location.pathname) ?? 'garden';
      if (next !== view) void show(next, false);
    };
    // D-082: volver atrás (bfcache) no debe dejar la aplicación desbloqueada.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    const onPageHide = () => lockGarden();
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    const prefetch = window.setTimeout(loadWorkspace, 0);
    // D-260: medidor de Web Vitals en pantalla, solo si la URL lleva `?medir`. No guarda ni envía nada.
    if (new URLSearchParams(window.location.search).has('medir'))
      void import('@/lib/perf/vitals-overlay').then((m) => m.startVitalsOverlay());
    return () => {
      window.clearTimeout(prefetch);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    };
  });
</script>

<OfflineNotice {locale} />
<!-- Sin sesión solo se ve la pantalla de acceso (sin menú ni cabecera); con sesión, la aplicación. -->
<AccessGate {locale} bypass={bypassAccess}>
  {#snippet footer()}
    <LanguageSwitch {locale} />
  {/snippet}
  {#await loadWorkspace()}
    <p class="ws-status" role="status">{t(locale, 'shell.loading')}</p>
  {:then { default: Workspace }}
    <Workspace
      {locale}
      {view}
      {title}
      {bypassAccess}
      {onNavClick}
      onNavigate={(next) => void show(next, true)}
      bind:heading={headingEl}
    />
  {:catch}
    <div class="ws-status" role="alert">
      <p>{t(locale, 'shell.loadError')}</p>
      <button type="button" class="ws-retry" onclick={() => window.location.reload()}>
        {t(locale, 'access.retry')}
      </button>
    </div>
  {/await}
</AccessGate>

<style>
  .ws-status {
    display: grid;
    justify-items: start;
    gap: var(--space-3);
    max-width: 40rem;
    margin: 0 auto;
    padding: var(--space-7) var(--gutter);
  }
  .ws-status p {
    margin: 0;
  }
  .ws-retry {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-control);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
</style>
