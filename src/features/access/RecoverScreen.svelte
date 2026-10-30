<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Keyring } from '@/lib/crypto';
  import { t, type Locale } from '@/lib/i18n';
  import {
    AccessError,
    startRecovery,
    type PendingReset,
    type RecoverySession,
    type SpaceStatus,
  } from './access-flow';
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
    status,
    onDone,
    onCancel,
  }: {
    locale: Locale;
    client: AuthClient;
    status: Extract<SpaceStatus, { configured: true }>;
    onDone: (keyring: Keyring) => void;
    onCancel: () => void;
  } = $props();

  type Step = 'key' | 'password' | 'newkey' | 'verify' | 'done';

  let step = $state<Step>('key');
  let keyInput = $state('');
  let password = $state('');
  let repeat = $state('');
  let showPasswordErrors = $state(false);
  let newKey = $state('');
  let typed = $state('');
  let saved = $state(false);
  let busy = $state(false);
  let error = $state<ReturnType<typeof failureKey> | null>(null);
  let wait = $state(0);
  let heading = $state<HTMLHeadingElement>();
  let session: RecoverySession | null = null;
  let pending: PendingReset | null = null;
  let recovered: Keyring | null = null;
  let firstRender = true;
  const countdown = createCountdown((n) => {
    wait = n;
  });

  const keyState = $derived(recoveryInputState(keyInput));
  const verifyState = $derived(recoveryInputState(typed, newKey));

  $effect(() => {
    void step;
    if (firstRender) {
      firstRender = false;
      return;
    }
    void tick().then(() => heading?.focus());
  });
  onMount(() => heading?.focus());
  onDestroy(() => {
    countdown.stop();
    session?.discard();
    pending?.discard();
    recovered?.lock();
  });

  function fail(e: unknown, invalid = false) {
    const failure = e instanceof AccessError ? e : null;
    error =
      invalid && failure?.code === 'wrong_credentials'
        ? 'recover.error.invalid'
        : failureKey(failure?.code ?? 'unavailable');
    if (failure?.code === 'rate_limited') countdown.start(failure.retryAfter ?? 5);
  }

  function cancel() {
    session?.discard();
    pending?.discard();
    onCancel();
  }

  async function fromKey(event: SubmitEvent) {
    event.preventDefault();
    if (busy || wait > 0 || keyState !== 'ok') return;
    busy = true;
    error = null;
    try {
      session = await startRecovery(client, status, keyInput);
      keyInput = '';
      step = 'password';
    } catch (e) {
      fail(e, true);
    } finally {
      busy = false;
    }
  }

  async function fromPassword(event: SubmitEvent) {
    event.preventDefault();
    showPasswordErrors = true;
    if (busy || !session || passwordIssues(password, repeat).length > 0) return;
    busy = true;
    error = null;
    try {
      pending = await session.prepareReset(password);
      session = null;
      password = repeat = '';
      newKey = pending.recoveryKey;
      step = 'newkey';
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  async function fromVerify(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !pending || verifyState !== 'ok' || !saved) return;
    busy = true;
    error = null;
    try {
      recovered = await pending.submit();
      pending = null;
      newKey = typed = '';
      step = 'done';
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }

  function enter() {
    const keyring = recovered;
    recovered = null;
    if (keyring) onDone(keyring);
  }
</script>

<div class="ac-form">
  {#if step === 'key'}
    <form class="ac-form" onsubmit={fromKey} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'recover.title')}</h2>
      <p>{t(locale, 'recover.intro')}</p>
      <RecoveryKeyInput
        {locale}
        id="recover-key"
        label={t(locale, 'key.label')}
        bind:value={keyInput}
        serverError={error ? t(locale, error) : null}
      />
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={cancel}>
          {t(locale, 'recover.back')}
        </button>
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          disabled={busy || wait > 0 || keyState !== 'ok'}
        >
          {#if wait > 0}
            {t(locale, 'login.wait', { seconds: wait })}
          {:else if busy}
            {t(locale, 'recover.checking')}
          {:else}
            {t(locale, 'access.continue')}
          {/if}
        </button>
      </div>
    </form>
  {:else if step === 'password'}
    <form class="ac-form" onsubmit={fromPassword} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'recover.password.title')}</h2>
      <PasswordPair
        {locale}
        idPrefix="recover"
        bind:password
        bind:repeat
        showErrors={showPasswordErrors}
      />
      {#if error}
        <p class="ac-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={cancel}>
          {t(locale, 'access.cancel')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary" disabled={busy}>
          {busy ? t(locale, 'setup.password.working') : t(locale, 'recover.password.submit')}
        </button>
      </div>
    </form>
  {:else if step === 'newkey'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        step = 'verify';
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'recover.newkey.title')}</h2>
      <p>{t(locale, 'recover.newkey.intro')}</p>
      <RecoveryKeyDisplay {locale} recoveryKey={newKey} />
      <div class="ac-actions">
        <button type="submit" class="ac-btn ac-btn-primary">{t(locale, 'access.continue')}</button>
      </div>
    </form>
  {:else if step === 'verify'}
    <form class="ac-form" onsubmit={fromVerify} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.verify.title')}</h2>
      <p>{t(locale, 'setup.verify.body')}</p>
      <RecoveryKeyInput
        {locale}
        id="recover-newkey"
        label={t(locale, 'key.label')}
        bind:value={typed}
        expected={newKey}
      />
      <label class="ac-check">
        <input type="checkbox" bind:checked={saved} />
        <span>{t(locale, 'setup.verify.saved')}</span>
      </label>
      {#if error}
        <p class="ac-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => (step = 'newkey')}>
          {t(locale, 'access.back')}
        </button>
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          disabled={busy || verifyState !== 'ok' || !saved}
        >
          {busy ? t(locale, 'setup.finish.working') : t(locale, 'recover.verify.submit')}
        </button>
      </div>
      {#if error === 'access.error.expired'}
        <button type="button" class="ac-btn ac-btn-link" onclick={cancel}
          >{t(locale, 'recover.back')}</button
        >
      {/if}
    </form>
  {:else}
    <div class="ac-form">
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'recover.done.title')}</h2>
      <p>{t(locale, 'recover.done.body')}</p>
      <div class="ac-actions">
        <button type="button" class="ac-btn ac-btn-primary" onclick={enter}>
          {t(locale, 'recover.done.enter')}
        </button>
      </div>
    </div>
  {/if}
</div>
