<script lang="ts">
  import { t, type Locale } from '@/lib/i18n';
  import { groupRecoveryInput, recoveryInputState } from './setup-model';

  let {
    locale,
    id,
    label,
    value = $bindable(''),
    expected,
    serverError = null,
  }: {
    locale: Locale;
    id: string;
    label: string;
    value: string;
    /** Si se indica, además de bien escrita debe coincidir con la que se mostró. */
    expected?: string;
    /** Error que viene de fuera (por ejemplo, «clave incorrecta» del servidor). */
    serverError?: string | null;
  } = $props();

  const current = $derived(recoveryInputState(value, expected));
  const message = $derived(
    current === 'format'
      ? t(locale, 'key.error.format')
      : current === 'checksum'
        ? t(locale, 'key.error.checksum')
        : current === 'mismatch'
          ? t(locale, 'key.error.mismatch')
          : null,
  );
</script>

<div class="ac-field">
  <label class="ac-label" for={id}>{label}</label>
  <input
    {id}
    class="ac-input ac-input-key"
    type="text"
    inputmode="text"
    autocomplete="off"
    autocapitalize="characters"
    autocorrect="off"
    spellcheck="false"
    aria-describedby="{id}-hint {id}-status"
    aria-invalid={message || serverError ? 'true' : undefined}
    bind:value
  />
  <p class="ac-hint" id="{id}-hint">{t(locale, 'key.input.hint')}</p>
  <p class="ac-hint" aria-hidden="true">{groupRecoveryInput(value)}</p>
  <div id="{id}-status" role="status">
    {#if current === 'ok'}
      <p class="ac-ok">{t(locale, 'key.ok')}</p>
    {:else if message}
      <p class="ac-error">{message}</p>
    {/if}
  </div>
  {#if serverError}
    <p class="ac-error" role="alert">{serverError}</p>
  {/if}
</div>
