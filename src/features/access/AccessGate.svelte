<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import type { Keyring } from '@/lib/crypto';
  import { t, type Locale } from '@/lib/i18n';
  import { readStatus, type SpaceStatus } from './access-flow';
  import { createAuthClient } from './auth-client';
  import './access.css';
  import { startIdleLock, type IdleLock } from './idle-lock';
  import LoginScreen from './LoginScreen.svelte';
  import RecoverScreen from './RecoverScreen.svelte';
  import { installSource, lockSession, onLock, type LockReason } from './session';
  import SetupWizard from './SetupWizard.svelte';

  let {
    locale,
    bypass = false,
    children,
  }: {
    locale: Locale;
    /** Solo desarrollo: entrega directamente el contenido (con datos de prueba). En producción siempre es `false`. */
    bypass?: boolean;
    children: Snippet;
  } = $props();

  type Screen = 'checking' | 'unavailable' | 'setup' | 'login' | 'recover' | 'ready';
  let current = $state<Screen>('checking');
  const screen = $derived<Screen>(bypass ? 'ready' : current);
  let status = $state<SpaceStatus | null>(null);
  let notice = $state<LockReason | null>(null);
  const client = createAuthClient();
  let idle: IdleLock | null = null;
  let stopListening: (() => void) | null = null;
  let stopLockWatch: (() => void) | null = null;

  async function check() {
    current = 'checking';
    try {
      const next = await readStatus(client);
      status = next;
      current = next.configured ? 'login' : 'setup';
    } catch {
      current = 'unavailable';
    }
  }

  function startIdle() {
    stopIdle();
    const lock = startIdleLock({
      onIdle: () => {
        void client.logout(); // mejor esfuerzo: la sesión del servidor también se cierra
        lockSession('idle');
      },
    });
    idle = lock;
    const touch = () => lock.touch();
    const events = ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    stopListening = () => {
      for (const name of events) window.removeEventListener(name, touch);
    };
  }

  function stopIdle() {
    idle?.stop();
    idle = null;
    stopListening?.();
    stopListening = null;
  }

  function unlocked(keyring: Keyring) {
    installSource(keyring);
    notice = null;
    current = 'ready';
    startIdle();
  }

  onMount(() => {
    if (bypass) return;
    stopLockWatch = onLock((reason) => {
      stopIdle();
      notice = reason;
      void check(); // los parámetros pudieron cambiar desde otro dispositivo
    });
    void check();
  });
  onDestroy(() => {
    stopIdle();
    stopLockWatch?.();
  });
</script>

{#if screen === 'ready'}
  {@render children()}
{:else}
  <section class="ac" aria-labelledby="ac-brand">
    <div class="ac-card">
      <p class="ac-brand" id="ac-brand">{t(locale, 'app.name')}</p>
      <p class="handwritten ac-tagline">{t(locale, 'app.tagline')}</p>

      {#if screen === 'checking'}
        <p role="status">{t(locale, 'access.checking')}</p>
      {:else if screen === 'unavailable'}
        <div class="ac-form" role="alert">
          <h2>{t(locale, 'access.unavailable.title')}</h2>
          <p>{t(locale, 'access.unavailable.body')}</p>
          <div class="ac-actions">
            <button type="button" class="ac-btn ac-btn-primary" onclick={check}>
              {t(locale, 'access.retry')}
            </button>
          </div>
        </div>
      {:else if screen === 'setup'}
        <SetupWizard {locale} {client} onDone={unlocked} />
      {:else if screen === 'login' && status?.configured}
        <LoginScreen
          {locale}
          {client}
          {status}
          {notice}
          onUnlocked={unlocked}
          onForgot={() => (current = 'recover')}
        />
      {:else if screen === 'recover' && status?.configured}
        <RecoverScreen {locale} {client} {status} onDone={unlocked} onCancel={() => void check()} />
      {/if}
    </div>
  </section>
{/if}
