<script lang="ts">
  import { t, type Locale, type MessageKey } from '@/lib/i18n';

  let { locale }: { locale: Locale } = $props();

  // Cada frase debe poder comprobarse (D-106, privacy-and-backups.md §4): si una prueba falla, se corrige el texto o el sistema.
  const PARTS: readonly (readonly [MessageKey, MessageKey])[] = [
    ['privacy.encrypted.title', 'privacy.encrypted.body'],
    ['privacy.server.title', 'privacy.server.body'],
    ['privacy.cookies.title', 'privacy.cookies.body'],
    ['privacy.png.title', 'privacy.png.body'],
    ['privacy.keys.title', 'privacy.keys.body'],
    ['privacy.deletion.title', 'privacy.deletion.body'],
    ['privacy.code.title', 'privacy.code.body'],
  ];
</script>

<section class="st-card st-wide" id="privacidad" aria-labelledby="st-privacy-title">
  <h2 id="st-privacy-title">{t(locale, 'privacy.title')}</h2>
  <p>{t(locale, 'privacy.intro')}</p>
  <div class="st-privacy">
    {#each PARTS as [title, body] (title)}
      <section>
        <h3>{t(locale, title)}</h3>
        <p>{t(locale, body)}</p>
      </section>
    {/each}
  </div>
</section>
