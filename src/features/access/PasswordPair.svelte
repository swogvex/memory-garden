<script lang="ts">
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { PASSWORD_MIN, passwordIssues, passwordLevel, type PasswordIssue } from './setup-model';

  const ERROR_KEY: Record<PasswordIssue, MessageKey> = {
    too_short: 'password.error.short',
    common: 'password.error.common',
    low_variety: 'password.error.variety',
    mismatch: 'password.error.mismatch',
  };

  let {
    locale,
    idPrefix,
    password = $bindable(''),
    repeat = $bindable(''),
    showErrors,
  }: {
    locale: Locale;
    idPrefix: string;
    password: string;
    repeat: string;
    /** Los errores solo se enseñan después de intentar continuar (no mientras escribe). */
    showErrors: boolean;
  } = $props();

  let visible = $state(false);
  let suggested = $state(false);
  let suggesting = $state(false);

  const issues = $derived(passwordIssues(password, repeat));
  const level = $derived(passwordLevel(password));
  const errorKeys = $derived(issues.map((i) => ERROR_KEY[i]));

  async function suggest() {
    suggesting = true;
    try {
      // La lista de palabras pesa unos 17 KB: solo se descarga si se pide una sugerencia.
      const { generateSpanishPassphrase } = await import('@/lib/crypto/passphrase-es');
      const phrase = generateSpanishPassphrase().text;
      password = phrase;
      repeat = phrase;
      visible = true;
      suggested = true;
    } finally {
      suggesting = false;
    }
  }
</script>

<div class="ac-field">
  <label class="ac-label" for="{idPrefix}-password">{t(locale, 'password.label')}</label>
  <input
    id="{idPrefix}-password"
    class="ac-input"
    type={visible ? 'text' : 'password'}
    autocomplete="new-password"
    autocapitalize="off"
    spellcheck="false"
    aria-describedby="{idPrefix}-hint {idPrefix}-meter"
    aria-invalid={showErrors && issues.some((i) => i !== 'mismatch') ? 'true' : undefined}
    bind:value={password}
  />
  <p class="ac-hint" id="{idPrefix}-hint">{t(locale, 'password.hint', { min: PASSWORD_MIN })}</p>
  <div class="ac-meter" id="{idPrefix}-meter">
    <span class="ac-segs" aria-hidden="true">
      {#each [1, 2, 3] as n (n)}
        <span class="ac-seg" class:on={level >= n}></span>
      {/each}
    </span>
    <span>{t(locale, 'password.meter.label', { level: t(locale, `password.meter.${level}`) })}</span
    >
  </div>
  <p class="ac-hint">{t(locale, 'password.meter.note')}</p>
  <button type="button" class="ac-btn ac-btn-secondary" onclick={suggest} disabled={suggesting}>
    {t(locale, 'password.suggest')}
  </button>
  {#if suggested}
    <p class="ac-hint" role="status">{t(locale, 'password.suggested')}</p>
  {/if}
</div>

<div class="ac-field">
  <label class="ac-label" for="{idPrefix}-repeat">{t(locale, 'password.repeat')}</label>
  <input
    id="{idPrefix}-repeat"
    class="ac-input"
    type={visible ? 'text' : 'password'}
    autocomplete="new-password"
    autocapitalize="off"
    spellcheck="false"
    aria-invalid={showErrors && issues.includes('mismatch') ? 'true' : undefined}
    aria-describedby={showErrors && issues.length > 0 ? `${idPrefix}-errors` : undefined}
    bind:value={repeat}
  />
</div>

<label class="ac-check">
  <input type="checkbox" bind:checked={visible} />
  <span>{t(locale, 'password.show')}</span>
</label>

{#if showErrors && errorKeys.length > 0}
  <ul class="ac-errors" id="{idPrefix}-errors" role="alert">
    {#each errorKeys as key (key)}
      <li>{t(locale, key, { min: PASSWORD_MIN })}</li>
    {/each}
  </ul>
{/if}
