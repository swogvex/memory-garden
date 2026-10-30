<script lang="ts">
  import { t, type Locale } from '@/lib/i18n';
  import { recoveryKeyFileText } from './setup-model';

  let { locale, recoveryKey }: { locale: Locale; recoveryKey: string } = $props();

  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      copied = true;
    } catch {
      copied = false; // sin permiso del navegador: la clave sigue a la vista para copiarla a mano
    }
  }

  function download() {
    const blob = new Blob([recoveryKeyFileText(recoveryKey)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'memory-garden-clave-de-recuperacion.txt';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
</script>

<p class="ac-label" id="recovery-key-label">{t(locale, 'key.label')}</p>
<div role="group" aria-labelledby="recovery-key-label">
  <p class="ac-key">
    {#each recoveryKey.split('-') as group, i (i)}
      <span>{group}</span>
    {/each}
  </p>
</div>
<div class="ac-actions ac-actions-row">
  <button type="button" class="ac-btn ac-btn-secondary" onclick={copy}
    >{t(locale, 'key.copy')}</button
  >
  <button type="button" class="ac-btn ac-btn-secondary" onclick={download}>
    {t(locale, 'key.download')}
  </button>
</div>
{#if copied}
  <p class="ac-hint" role="status">{t(locale, 'key.copied')}</p>
{/if}
<ul class="ac-list">
  <li>{t(locale, 'setup.key.warn1')}</li>
  <li>{t(locale, 'setup.key.warn2')}</li>
  <li>{t(locale, 'setup.key.warn3')}</li>
</ul>
