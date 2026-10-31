<script lang="ts">
  import { onMount } from 'svelte';
  import { t, type Locale } from '@/lib/i18n';

  // Aviso de sin conexión (H8.4). Visible también en la pantalla de acceso. El contenedor con `role="status"` existe siempre
  // para que los lectores de pantalla anuncien el cambio; solo el texto aparece y desaparece.
  let { locale }: { locale: Locale } = $props();
  let offline = $state(false);

  onMount(() => {
    const update = () => {
      offline = navigator.onLine === false;
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });
</script>

<div class="offline" class:on={offline} role="status">
  {#if offline}
    <p>{t(locale, 'shell.offline')}</p>
  {/if}
</div>

<style>
  .offline.on {
    position: sticky;
    top: 0;
    z-index: 50;
    padding: var(--space-2) var(--space-4);
    background: var(--color-surface-accent);
    color: var(--color-text);
    text-align: center;
    box-shadow: 0 2px 8px rgb(55 49 63 / 15%);
  }
  .offline p {
    margin: 0;
    font-weight: 600;
  }
</style>
