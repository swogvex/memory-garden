<script lang="ts">
  import { tick } from 'svelte';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { createAuthClient } from './auth-client';
  import { commonPasswordsOrNull } from './common-list';
  import { changeOwnPassword } from './credentials-flow';
  import PasswordPair from './PasswordPair.svelte';
  import { securityErrorKey } from './security-messages';
  import { passwordIssues } from './setup-model';

  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  const client = createAuthClient();

  let open = $state(false);
  let current = $state('');
  let next = $state('');
  let repeat = $state('');
  let showErrors = $state(false);
  let busy = $state(false);
  let error = $state<MessageKey | null>(null);
  let done = $state(false);
  let startEl = $state<HTMLButtonElement>();
  let currentEl = $state<HTMLInputElement>();

  async function start() {
    open = true;
    done = false;
    error = null;
    await tick();
    currentEl?.focus();
  }

  async function close() {
    open = false;
    current = '';
    next = '';
    repeat = '';
    showErrors = false;
    error = null;
    await tick();
    startEl?.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // un solo envío
    showErrors = true;
    error = null;
    if (passwordIssues(next, repeat, await commonPasswordsOrNull()).length > 0) return;
    if (next === current) {
      error = 'security.password.error.same';
      return;
    }
    busy = true;
    try {
      await changeOwnPassword(client, current, next);
      done = true;
      await close();
    } catch (failure) {
      error = securityErrorKey(failure);
      if (error === 'security.password.error.current') currentEl?.focus();
    } finally {
      busy = false;
    }
  }
</script>

<section class="st-card" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'security.password.title')}</h2>
  <p>{t(locale, 'security.password.intro')}</p>
  {#if !open}
    <div class="ac-actions">
      <button bind:this={startEl} type="button" class="ac-btn ac-btn-secondary" onclick={start}>
        {t(locale, 'security.password.start')}
      </button>
    </div>
  {:else}
    <form class="st-form" novalidate onsubmit={submit}>
      <div class="ac-field">
        <label class="ac-label" for={id('current')}>{t(locale, 'security.password.current')}</label>
        <input
          bind:this={currentEl}
          id={id('current')}
          class="ac-input"
          type="password"
          autocomplete="current-password"
          autocapitalize="off"
          spellcheck="false"
          bind:value={current}
          aria-invalid={error === 'security.password.error.current' ? 'true' : undefined}
          aria-describedby={error ? id('error') : undefined}
        />
      </div>
      <PasswordPair
        {locale}
        idPrefix={id('new')}
        bind:password={next}
        bind:repeat
        {showErrors}
        labelKey="security.password.new"
        repeatKey="security.password.repeat"
      />
      {#if error}
        <p class="ac-error" id={id('error')} role="alert">{t(locale, error)}</p>
      {/if}
      {#if busy}
        <p class="ac-hint" role="status">{t(locale, 'security.password.working')}</p>
      {/if}
      <div class="ac-actions">
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          aria-disabled={busy ? 'true' : undefined}
        >
          {t(locale, 'security.password.submit')}
        </button>
        <button
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => {
            if (!busy) void close();
          }}>{t(locale, 'security.cancel')}</button
        >
      </div>
    </form>
  {/if}
  <p class="st-status ok" role="status">{done ? t(locale, 'security.password.done') : ''}</p>
</section>
