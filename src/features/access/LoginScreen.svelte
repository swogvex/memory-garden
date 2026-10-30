<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Keyring } from '@/lib/crypto';
  import { t, type Locale } from '@/lib/i18n';
  import { AccessError, unlock, type SpaceStatus } from './access-flow';
  import type { AuthClient } from './auth-client';
  import { createCountdown } from './countdown';
  import { failureKey } from './messages';
  import type { LockReason } from './session';

  let {
    locale,
    client,
    status,
    notice = null,
    onUnlocked,
    onForgot,
  }: {
    locale: Locale;
    client: AuthClient;
    status: Extract<SpaceStatus, { configured: true }>;
    notice?: LockReason | null;
    onUnlocked: (keyring: Keyring) => void;
    onForgot: () => void;
  } = $props();

  let password = $state('');
  let visible = $state(false);
  let busy = $state(false);
  let error = $state<ReturnType<typeof failureKey> | null>(null);
  let wait = $state(0);
  let heading = $state<HTMLHeadingElement>();
  const countdown = createCountdown((n) => {
    wait = n;
  });

  onMount(() => heading?.focus());
  onDestroy(() => countdown.stop());

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || wait > 0 || password.length === 0) return;
    busy = true;
    error = null;
    try {
      const { keyring } = await unlock(client, status, password);
      password = '';
      onUnlocked(keyring);
    } catch (e) {
      const failure = e instanceof AccessError ? e : null;
      error = failureKey(failure?.code ?? 'unavailable');
      if (failure?.code === 'rate_limited') countdown.start(failure.retryAfter ?? 5);
    } finally {
      busy = false;
    }
  }
</script>

<form class="ac-form" onsubmit={submit} novalidate>
  <h2 tabindex="-1" bind:this={heading}>{t(locale, 'login.title')}</h2>
  {#if notice === 'expired' || notice === 'idle'}
    <p class="ac-notice" role="status">
      {t(locale, notice === 'expired' ? 'login.notice.expired' : 'login.notice.idle')}
    </p>
  {/if}

  <div class="ac-field">
    <label class="ac-label" for="login-password">{t(locale, 'login.password')}</label>
    <input
      id="login-password"
      class="ac-input"
      type={visible ? 'text' : 'password'}
      autocomplete="current-password"
      autocapitalize="off"
      spellcheck="false"
      required
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? 'login-error' : undefined}
      bind:value={password}
    />
  </div>
  <label class="ac-check">
    <input type="checkbox" bind:checked={visible} />
    <span>{t(locale, 'login.show')}</span>
  </label>

  {#if error}
    <p class="ac-error" id="login-error" role="alert">{t(locale, error)}</p>
  {/if}

  <div class="ac-actions">
    <button type="submit" class="ac-btn ac-btn-primary" disabled={busy || wait > 0}>
      {#if wait > 0}
        {t(locale, 'login.wait', { seconds: wait })}
      {:else if busy}
        {t(locale, 'login.working')}
      {:else}
        {t(locale, 'login.submit')}
      {/if}
    </button>
    <button type="button" class="ac-btn ac-btn-link" onclick={onForgot}>
      {t(locale, 'login.forgot')}
    </button>
  </div>
</form>
