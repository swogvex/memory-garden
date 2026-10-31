<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { Keyring } from '@/lib/crypto';
  import { t, type Locale } from '@/lib/i18n';
  import { AccessError, beginSetup, type PendingSpace } from './access-flow';
  import type { AuthClient } from './auth-client';
  import { createCountdown } from './countdown';
  import { failureKey } from './messages';
  import PasswordPair from './PasswordPair.svelte';
  import RecoveryKeyDisplay from './RecoveryKeyDisplay.svelte';
  import RecoveryKeyInput from './RecoveryKeyInput.svelte';
  import { passwordIssues, recoveryInputState } from './setup-model';

  let {
    locale,
    client,
    onDone,
    onRestore,
  }: {
    locale: Locale;
    client: AuthClient;
    onDone: (keyring: Keyring) => void;
    /** Restaurar desde una copia `.mgx` en lugar de crear un espacio nuevo. */
    onRestore?: () => void;
  } = $props();

  type Step = 'privacy' | 'password' | 'key' | 'verify' | 'finish';
  const ORDER: Step[] = ['privacy', 'password', 'key', 'verify', 'finish'];

  let step = $state<Step>('privacy');
  let read = $state(false);
  let password = $state('');
  let repeat = $state('');
  let showPasswordErrors = $state(false);
  let recoveryKey = $state('');
  let typed = $state('');
  let saved = $state(false);
  let understood = $state(false);
  let code = $state('');
  let busy = $state(false);
  let error = $state<ReturnType<typeof failureKey> | null>(null);
  let wait = $state(0);
  let heading = $state<HTMLHeadingElement>();
  let pending: PendingSpace | null = null; // claves en memoria: nunca en estado reactivo
  let firstRender = true;
  const countdown = createCountdown((n) => {
    wait = n;
  });

  const keyState = $derived(recoveryInputState(typed, recoveryKey));

  $effect(() => {
    void step;
    if (firstRender) {
      firstRender = false;
      return;
    }
    void tick().then(() => heading?.focus());
  });
  onDestroy(() => {
    countdown.stop();
    pending?.discard();
  });

  function go(next: Step) {
    error = null;
    step = next;
  }

  /** Volver desde la clave invalida la que se había generado: se descarta y se genera otra al continuar. */
  function backTo(previous: Step) {
    if (previous === 'password' || previous === 'privacy') {
      pending?.discard();
      pending = null;
      recoveryKey = '';
      typed = '';
      saved = false;
    }
    go(previous);
  }

  async function fromPassword(event: SubmitEvent) {
    event.preventDefault();
    showPasswordErrors = true;
    if (busy || passwordIssues(password, repeat).length > 0) return;
    busy = true;
    try {
      pending?.discard();
      pending = await beginSetup(client, password);
      recoveryKey = pending.recoveryKey;
      go('key');
    } catch {
      error = failureKey('unavailable');
    } finally {
      busy = false;
    }
  }

  async function finish(event: SubmitEvent) {
    event.preventDefault();
    if (busy || wait > 0 || !pending || !understood || code.trim().length === 0) return;
    busy = true;
    error = null;
    try {
      const keyring = await pending.submit(code);
      pending = null;
      password = repeat = typed = recoveryKey = code = '';
      onDone(keyring);
    } catch (e) {
      const failure = e instanceof AccessError ? e : null;
      error = failureKey(failure?.code ?? 'unavailable');
      if (failure?.code === 'rate_limited') countdown.start(failure.retryAfter ?? 5);
    } finally {
      busy = false;
    }
  }

  const stepNumber = $derived(ORDER.indexOf(step) + 1);
</script>

<div class="ac-form">
  <p class="ac-step">{t(locale, 'access.step', { current: stepNumber, total: ORDER.length })}</p>

  {#if step === 'privacy'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        if (read) go('password');
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.privacy.title')}</h2>
      <div class="ac-privacy">
        <p>{t(locale, 'setup.privacy.p1')}</p>
        <p>{t(locale, 'setup.privacy.p2')}</p>
        <p>{t(locale, 'setup.privacy.p3')}</p>
        <p><strong>{t(locale, 'setup.privacy.p4')}</strong></p>
        <p>{t(locale, 'setup.privacy.p5')}</p>
        <p>{t(locale, 'setup.privacy.p6')}</p>
      </div>
      <label class="ac-check">
        <input type="checkbox" bind:checked={read} />
        <span>{t(locale, 'setup.privacy.read')}</span>
      </label>
      <div class="ac-actions">
        <button type="submit" class="ac-btn ac-btn-primary" disabled={!read}>
          {t(locale, 'access.continue')}
        </button>
        {#if onRestore}
          <button type="button" class="ac-btn ac-btn-link" disabled={!read} onclick={onRestore}>
            {t(locale, 'restore.link')}
          </button>
        {/if}
      </div>
    </form>
  {:else if step === 'password'}
    <form class="ac-form" onsubmit={fromPassword} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.password.title')}</h2>
      <PasswordPair
        {locale}
        idPrefix="setup"
        bind:password
        bind:repeat
        showErrors={showPasswordErrors}
      />
      {#if error}
        <p class="ac-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => backTo('privacy')}>
          {t(locale, 'access.back')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary" disabled={busy}>
          {busy ? t(locale, 'setup.password.working') : t(locale, 'access.continue')}
        </button>
      </div>
    </form>
  {:else if step === 'key'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        go('verify');
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.key.title')}</h2>
      <p>{t(locale, 'setup.key.intro')}</p>
      <RecoveryKeyDisplay {locale} {recoveryKey} />
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => backTo('password')}>
          {t(locale, 'access.back')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary">{t(locale, 'access.continue')}</button>
      </div>
    </form>
  {:else if step === 'verify'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        if (keyState === 'ok' && saved) go('finish');
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.verify.title')}</h2>
      <p>{t(locale, 'setup.verify.body')}</p>
      <RecoveryKeyInput
        {locale}
        id="setup-key"
        label={t(locale, 'key.label')}
        bind:value={typed}
        expected={recoveryKey}
      />
      <label class="ac-check">
        <input type="checkbox" bind:checked={saved} />
        <span>{t(locale, 'setup.verify.saved')}</span>
      </label>
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => go('key')}>
          {t(locale, 'access.back')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary" disabled={keyState !== 'ok' || !saved}>
          {t(locale, 'access.continue')}
        </button>
      </div>
    </form>
  {:else}
    <form class="ac-form" onsubmit={finish} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.finish.title')}</h2>
      <p>{t(locale, 'setup.finish.body')}</p>
      <label class="ac-check">
        <input type="checkbox" bind:checked={understood} />
        <span>{t(locale, 'setup.finish.understood')}</span>
      </label>
      <div class="ac-field">
        <label class="ac-label" for="setup-code">{t(locale, 'setup.code.label')}</label>
        <input
          id="setup-code"
          class="ac-input ac-input-key"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          required
          aria-describedby={error ? 'setup-code-hint setup-error' : 'setup-code-hint'}
          aria-invalid={error ? 'true' : undefined}
          bind:value={code}
        />
        <p class="ac-hint" id="setup-code-hint">{t(locale, 'setup.code.hint')}</p>
      </div>
      {#if error}
        <p class="ac-error" id="setup-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => go('verify')}>
          {t(locale, 'access.back')}
        </button>
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          disabled={busy || wait > 0 || !understood || code.trim().length === 0}
        >
          {#if wait > 0}
            {t(locale, 'login.wait', { seconds: wait })}
          {:else if busy}
            {t(locale, 'setup.finish.working')}
          {:else}
            {t(locale, 'setup.finish.submit')}
          {/if}
        </button>
      </div>
    </form>
  {/if}
</div>
