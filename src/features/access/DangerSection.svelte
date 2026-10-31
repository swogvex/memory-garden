<script lang="ts">
  import { tick } from 'svelte';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { createAuthClient } from './auth-client';
  import { deleteAllMemories, deleteWholeSpace } from './danger-flow';
  import { securityErrorKey } from './security-messages';
  import { lockSession } from './session';

  // Zona de peligro: borrar todos los recuerdos y eliminar el espacio. Contraseña actual + palabra escrita.
  // Vive en `access` porque usa la prueba de contraseña y cierra la sesión.
  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  const client = createAuthClient();

  type Action = 'memories' | 'space';
  const WORD: Record<Action, MessageKey> = {
    memories: 'danger.memories.word',
    space: 'danger.space.word',
  };

  let open = $state<Action | null>(null);
  let password = $state('');
  let typed = $state('');
  let busy = $state(false);
  let error = $state<MessageKey | null>(null);
  let done = $state<Action | null>(null);
  let passwordEl = $state<HTMLInputElement>();
  let memoriesBtn = $state<HTMLButtonElement>();
  let spaceBtn = $state<HTMLButtonElement>();

  const word = $derived(open ? t(locale, WORD[open]) : '');
  const wordOk = $derived(typed.trim().toLocaleUpperCase(locale) === word);

  async function start(action: Action) {
    open = action;
    password = typed = '';
    error = null;
    done = null;
    await tick();
    passwordEl?.focus();
  }

  async function close() {
    const was = open;
    open = null;
    password = typed = '';
    error = null;
    await tick();
    (was === 'space' ? spaceBtn : memoriesBtn)?.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !open) return;
    if (password.length === 0) {
      error = 'danger.error.password';
      passwordEl?.focus();
      return;
    }
    if (!wordOk) {
      error = 'danger.error.word';
      return;
    }
    busy = true;
    error = null;
    const action = open;
    try {
      if (action === 'memories') {
        await deleteAllMemories(client, password);
        window.dispatchEvent(new CustomEvent('mg:memories-deleted')); // la Papelera se recarga
      } else {
        await deleteWholeSpace(client, password);
        lockSession(); // la sesión ya no existe: se sueltan las claves
      }
      done = action;
      await close();
    } catch (failure) {
      const key = securityErrorKey(failure);
      // Pudo borrarse una parte antes del fallo: nunca se dice «no se ha cambiado nada».
      error =
        key === 'security.error.generic' || key === 'access.error.network'
          ? 'danger.error.retry'
          : key;
      if (error === 'security.password.error.current') passwordEl?.focus();
    } finally {
      busy = false;
      password = '';
    }
  }
</script>

{#snippet form(action: Action)}
  <form class="st-form" novalidate onsubmit={submit}>
    <div class="ac-field">
      <label class="ac-label" for={id('password')}>{t(locale, 'security.password.current')}</label>
      <input
        bind:this={passwordEl}
        id={id('password')}
        class="ac-input"
        type="password"
        autocomplete="current-password"
        autocapitalize="off"
        spellcheck="false"
        bind:value={password}
        aria-invalid={error === 'security.password.error.current' ||
        error === 'danger.error.password'
          ? 'true'
          : undefined}
        aria-describedby={error ? id('error') : undefined}
      />
    </div>
    <div class="ac-field">
      <label class="ac-label" for={id('word')}>
        {t(locale, 'danger.word.label', { word: t(locale, WORD[action]) })}
      </label>
      <input
        id={id('word')}
        class="ac-input"
        type="text"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        bind:value={typed}
        aria-invalid={error === 'danger.error.word' ? 'true' : undefined}
      />
    </div>
    {#if error}
      <p class="ac-error" id={id('error')} role="alert">{t(locale, error)}</p>
    {/if}
    {#if busy}
      <p class="ac-hint" role="status">{t(locale, 'danger.working')}</p>
    {/if}
    <div class="ac-actions">
      <button
        type="submit"
        class="ac-btn ac-btn-danger"
        aria-disabled={busy || !wordOk ? 'true' : undefined}
      >
        {t(locale, action === 'memories' ? 'danger.memories.submit' : 'danger.space.submit')}
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
{/snippet}

<section class="st-card st-wide st-danger" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'danger.title')}</h2>
  {#if done === 'space'}
    <div role="status">
      <p class="st-status ok">{t(locale, 'danger.space.done')}</p>
      <ul class="ac-list">
        <li>{t(locale, 'danger.space.left1')}</li>
        <li>{t(locale, 'danger.space.left2')}</li>
        <li>{t(locale, 'danger.space.left3')}</li>
      </ul>
    </div>
    <div class="ac-actions">
      <button
        type="button"
        class="ac-btn ac-btn-primary"
        onclick={() => window.location.assign('/')}
      >
        {t(locale, 'danger.space.exit')}
      </button>
    </div>
  {:else}
    <p>{t(locale, 'danger.intro')}</p>

    <h3>{t(locale, 'danger.memories.title')}</h3>
    <p>{t(locale, 'danger.memories.body')}</p>
    {#if open === 'memories'}
      {@render form('memories')}
    {:else}
      <div class="ac-actions">
        <button
          bind:this={memoriesBtn}
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={open !== null ? 'true' : undefined}
          onclick={() => {
            if (open === null) void start('memories');
          }}
        >
          {t(locale, 'danger.memories.start')}
        </button>
      </div>
    {/if}
    <p class="st-status ok" role="status">
      {done === 'memories' ? t(locale, 'danger.memories.done') : ''}
    </p>

    <h3>{t(locale, 'danger.space.title')}</h3>
    <p>{t(locale, 'danger.space.body')}</p>
    {#if open === 'space'}
      {@render form('space')}
    {:else}
      <div class="ac-actions">
        <button
          bind:this={spaceBtn}
          type="button"
          class="ac-btn ac-btn-secondary"
          aria-disabled={open !== null ? 'true' : undefined}
          onclick={() => {
            if (open === null) void start('space');
          }}
        >
          {t(locale, 'danger.space.start')}
        </button>
      </div>
    {/if}
  {/if}
</section>
