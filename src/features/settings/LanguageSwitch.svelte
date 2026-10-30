<script lang="ts">
  import { LOCALES, t, type Locale } from '@/lib/i18n';
  import { chooseLocalLanguage } from './prefs.svelte';

  // Pantalla de acceso: sin sesión no se pueden leer los ajustes cifrados; el idioma solo se recuerda en este navegador.
  let { locale }: { locale: Locale } = $props();
</script>

<div class="st-lang" role="group" aria-label={t(locale, 'access.language')}>
  {#each LOCALES as code (code)}
    <button
      type="button"
      lang={code}
      aria-pressed={locale === code}
      onclick={() => chooseLocalLanguage(code)}
    >
      {t(code, code === 'es' ? 'language.es' : 'language.en')}
    </button>
  {/each}
</div>
