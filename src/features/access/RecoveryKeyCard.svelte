<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { createAuthClient } from './auth-client';
  import { beginRecoveryKeyRotation, type PendingRecoveryKey } from './credentials-flow';
  import RecoveryKeyDisplay from './RecoveryKeyDisplay.svelte';
  import RecoveryKeyInput from './RecoveryKeyInput.svelte';
  import { securityErrorKey } from './security-messages';
  import { recoveryInputState } from './setup-model';

  /**
   * Clave de recuperación nueva (crypto-spec §8.5): contraseña actual → la clave se muestra UNA vez (copiar o descargar)
   * → confirmar que se ha guardado → reescribirla → activar. Nada se envía al servidor hasta «Activar»: si se cancela o se
   * sale de la pantalla antes, la clave anterior sigue valiendo.
   */
  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  const client = createAuthClient();

  type Step = 'idle' | 'password' | 'show' | 'verify';
  let step = $state<Step>('idle');
  let current = $state('');
  let saved = $state(false);
  let typed = $state('');
  let busy = $state(false);
  let error = $state<MessageKey | null>(null);
  let outcome = $state<'done' | 'cancelled' | null>(null);
  let pending = $state.raw<PendingRecoveryKey | null>(null);
  let sectionEl = $state<HTMLElement>();

  async function go(next: Step) {
    step = next;
    error = null;
    await tick();
    sectionEl?.querySelector<HTMLElement>('[data-step-focus]')?.focus();
  }

  function reset() {
    pending?.discard();
    pending = null;
    current = '';
    typed = '';
    saved = false;
  }

  async function cancel() {
    if (busy) return;
    const hadKey = pending !== null;
    reset();
    outcome = hadKey ? 'cancelled' : null;
    await go('idle');
  }

  async function prove(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      pending = await beginRecoveryKeyRotation(client, current);
      current = '';
      await go('show');
    } catch (failure) {
      error = securityErrorKey(failure);
    } finally {
      busy = false;
    }
  }

  function toVerify() {
    if (!saved) {
      error = 'security.recovery.error.notsaved';
      return;
    }
    void go('verify');
  }

  async function activate(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !pending) return;
    if (recoveryInputState(typed, pending.recoveryKey) !== 'ok') return; // el campo ya explica qué falla
    busy = true;
    error = null;
    try {
      await pending.activate();
      pending = null;
      typed = '';
      saved = false;
      outcome = 'done';
      await go('idle');
    } catch (failure) {
      error = securityErrorKey(failure);
    } finally {
      busy = false;
    }
  }

  onDestroy(reset); // salir de Configuración a mitad = no cambiar nada
</script>

<section class="st-card" aria-labelledby={id('title')} bind:this={sectionEl}>
  <h2 id={id('title')}>{t(locale, 'security.recovery.title')}</h2>
  {#if step === 'idle'}
    <p>{t(locale, 'security.recovery.intro')}</p>
    <div class="ac-actions">
      <button
        type="button"
        class="ac-btn ac-btn-secondary"
        data-step-focus
        onclick={() => {
          outcome = null;
          void go('password');
        }}>{t(locale, 'security.recovery.start')}</button
      >
    </div>
  {:else if step === 'password'}
    <form class="st-form" novalidate onsubmit={prove}>
      <p>{t(locale, 'security.recovery.password')}</p>
      <div class="ac-field">
        <label class="ac-label" for={id('current')}>{t(locale, 'security.password.current')}</label>
        <input
          id={id('current')}
          class="ac-input"
          type="password"
          autocomplete="current-password"
          autocapitalize="off"
          spellcheck="false"
          data-step-focus
          bind:value={current}
          aria-invalid={error === 'security.password.error.current' ? 'true' : undefined}
          aria-describedby={error ? id('error') : undefined}
        />
      </div>
      {#if busy}
        <p class="ac-hint" role="status">{t(locale, 'security.recovery.working')}</p>
      {/if}
      {#if error}<p class="ac-error" id={id('error')} role="alert">{t(locale, error)}</p>{/if}
      <div class="ac-actions">
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          aria-disabled={busy ? 'true' : undefined}
        >
          {t(locale, 'security.recovery.continue')}
        </button>
        <button
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => void cancel()}>{t(locale, 'security.cancel')}</button
        >
      </div>
    </form>
  {:else if step === 'show' && pending}
    <div class="st-form">
      <h3 tabindex="-1" data-step-focus>{t(locale, 'security.recovery.show.title')}</h3>
      <p>{t(locale, 'security.recovery.show.intro')}</p>
      <RecoveryKeyDisplay {locale} recoveryKey={pending.recoveryKey} />
      <label class="ac-check">
        <input
          type="checkbox"
          bind:checked={saved}
          aria-describedby={error ? id('error') : undefined}
        />
        <span>{t(locale, 'security.recovery.saved')}</span>
      </label>
      {#if error}<p class="ac-error" id={id('error')} role="alert">{t(locale, error)}</p>{/if}
      <div class="ac-actions">
        <button type="button" class="ac-btn ac-btn-primary" onclick={toVerify}>
          {t(locale, 'security.recovery.continue')}
        </button>
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => void cancel()}>
          {t(locale, 'security.cancel')}
        </button>
      </div>
    </div>
  {:else if step === 'verify' && pending}
    <form class="st-form" novalidate onsubmit={activate}>
      <h3 tabindex="-1" data-step-focus>{t(locale, 'security.recovery.verify.title')}</h3>
      <p>{t(locale, 'security.recovery.verify.body')}</p>
      <RecoveryKeyInput
        {locale}
        id={id('typed')}
        label={t(locale, 'security.recovery.verify.label')}
        bind:value={typed}
        expected={pending.recoveryKey}
      />
      {#if busy}
        <p class="ac-hint" role="status">{t(locale, 'security.recovery.activating')}</p>
      {/if}
      {#if error}<p class="ac-error" role="alert">{t(locale, error)}</p>{/if}
      <div class="ac-actions">
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          aria-disabled={busy ? 'true' : undefined}
        >
          {t(locale, 'security.recovery.submit')}
        </button>
        <button
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => void cancel()}>{t(locale, 'security.cancel')}</button
        >
      </div>
    </form>
  {/if}
  <p class="st-status" class:ok={outcome === 'done'} role="status">
    {outcome === 'done'
      ? t(locale, 'security.recovery.done')
      : outcome === 'cancelled'
        ? t(locale, 'security.recovery.cancelled')
        : ''}
  </p>
</section>
