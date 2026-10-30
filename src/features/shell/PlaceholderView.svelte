<script lang="ts">
  import { t, type Locale, type MessageKey } from '@/lib/i18n';

  let { locale, messageKey }: { locale: Locale; messageKey: MessageKey } = $props();
</script>

<section class="soon">
  <p>{t(locale, messageKey)}</p>
  <p class="note">{t(locale, 'view.soon.note')}</p>
</section>

<style>
  .soon {
    max-width: 36rem;
    padding: var(--space-5);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    box-shadow: var(--shadow-card);
  }
  .note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  p {
    overflow-wrap: anywhere;
  }
</style>
