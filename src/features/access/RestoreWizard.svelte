<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    BackupError,
    backupErrorKey,
    readBackupHeader,
    type BackupProgress,
    type OpenedBackup,
    type RestoreSummary,
  } from '@/lib/backup';
  import type { Keyring } from '@/lib/crypto';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { AccessError } from './access-flow';
  import type { AuthClient } from './auth-client';
  import { createCountdown } from './countdown';
  import { failureKey } from './messages';
  import PasswordPair from './PasswordPair.svelte';
  import RecoveryKeyDisplay from './RecoveryKeyDisplay.svelte';
  import RecoveryKeyInput from './RecoveryKeyInput.svelte';
  import {
    openBackupWithPassword,
    openBackupWithRecoveryKey,
    uploadBackup,
    type BackupUnlock,
    type PendingRestore,
  } from './restore-flow';
  import { passwordIssues, recoveryInputState } from './setup-model';

  // Restaurar desde una copia `.mgx` en un espacio vacío. Se lee y se comprueba aquí; nada sale hasta «Restaurar».
  let {
    locale,
    client,
    onDone,
    onCancel,
  }: {
    locale: Locale;
    client: AuthClient;
    onDone: (keyring: Keyring) => void;
    onCancel: () => void;
  } = $props();

  type Step = 'file' | 'credential' | 'password' | 'key' | 'verify' | 'code' | 'upload';
  let step = $state<Step>('file');
  let file = $state.raw<File | null>(null);
  let mode = $state<'password' | 'recovery'>('password');
  let password = $state('');
  let keyInput = $state('');
  let newPassword = $state('');
  let repeat = $state('');
  let showPasswordErrors = $state(false);
  let recoveryKey = $state('');
  let typed = $state('');
  let saved = $state(false);
  let code = $state('');
  let busy = $state(false);
  let progress = $state.raw<BackupProgress | null>(null);
  let counts = $state.raw<BackupUnlock['counts'] | null>(null);
  let summary = $state.raw<RestoreSummary | null>(null);
  let error = $state<MessageKey | null>(null);
  let stopped = $state<MessageKey | null>(null);
  let wait = $state(0);
  let heading = $state<HTMLHeadingElement>();
  // Claves en memoria: nunca en estado reactivo.
  let unlocked: BackupUnlock | null = null;
  let pending: PendingRestore | null = null;
  let keyring: Keyring | null = null;
  let backup: OpenedBackup | null = null;
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
    discardAll();
    keyring?.lock();
  });

  function discardAll() {
    pending?.discard();
    pending = null;
    unlocked?.discard();
    unlocked = null;
  }

  function messageFor(e: unknown): MessageKey {
    if (e instanceof BackupError) return backupErrorKey(e.code);
    if (e instanceof AccessError) return failureKey(e.code);
    return 'backup.error.unavailable';
  }

  function go(next: Step) {
    error = null;
    step = next;
  }

  async function chooseFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0] ?? null;
    error = null;
    file = null;
    if (!chosen) return;
    try {
      await readBackupHeader(chosen); // solo la estructura: así un archivo equivocado se ve ya
      file = chosen;
    } catch (e) {
      error = messageFor(e);
    }
  }

  async function openCopy(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !file) return;
    if (mode === 'password' ? password.length === 0 : recoveryInputState(keyInput) !== 'ok') return;
    busy = true;
    error = null;
    progress = null;
    discardAll();
    try {
      const onProgress = (p: BackupProgress) => (progress = p);
      unlocked =
        mode === 'password'
          ? await openBackupWithPassword(client, file, password, {}, onProgress)
          : await openBackupWithRecoveryKey(client, file, keyInput, {}, onProgress);
      counts = unlocked.counts;
      backup = unlocked.backup;
      if (mode === 'password') await prepareKeys();
      else go('password');
    } catch (e) {
      error = messageFor(e);
    } finally {
      busy = false;
      progress = null;
    }
  }

  async function prepareKeys(choice?: string) {
    if (!unlocked) throw new AccessError('unavailable');
    pending = await unlocked.prepare(choice);
    unlocked = null; // `prepare` ya soltó la contraseña o la clave
    recoveryKey = pending.recoveryKey;
    password = keyInput = newPassword = repeat = '';
    go('key');
  }

  async function fromNewPassword(event: SubmitEvent) {
    event.preventDefault();
    showPasswordErrors = true;
    if (busy || passwordIssues(newPassword, repeat).length > 0) return;
    busy = true;
    try {
      await prepareKeys(newPassword);
    } catch (e) {
      error = messageFor(e);
    } finally {
      busy = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || wait > 0 || !pending || code.trim().length === 0) return;
    busy = true;
    error = null;
    try {
      keyring = await pending.submit(code);
      pending = null;
      code = typed = recoveryKey = '';
      go('upload');
      await upload();
    } catch (e) {
      const failure = e instanceof AccessError ? e : null;
      error = messageFor(e);
      if (failure?.code === 'rate_limited') countdown.start(failure.retryAfter ?? 5);
    } finally {
      busy = false;
    }
  }

  async function upload() {
    if (!keyring || !backup) return;
    busy = true;
    stopped = null;
    try {
      summary = await uploadBackup(keyring, backup, (p) => (progress = p));
    } catch (e) {
      stopped =
        e instanceof BackupError && e.code === 'quota'
          ? 'restore.partial.quota'
          : 'restore.partial';
    } finally {
      busy = false;
      progress = null;
    }
  }

  function enter() {
    if (!keyring) return;
    const ready = keyring;
    keyring = null;
    backup = null;
    onDone(ready);
  }

  function cancel() {
    discardAll();
    onCancel();
  }
</script>

{#snippet progressLine()}
  {#if progress}
    <p class="ac-hint" role="status">
      {t(locale, progress.phase === 'upload' ? 'restore.uploading' : 'restore.checking', {
        done: progress.done,
        total: progress.total,
      })}
    </p>
  {/if}
{/snippet}

<div class="ac-form">
  {#if step === 'file'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        if (file) go('credential');
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'restore.title')}</h2>
      <p>{t(locale, 'restore.file.intro')}</p>
      <div class="ac-field">
        <label class="ac-label" for="restore-file">{t(locale, 'restore.file.label')}</label>
        <!-- Sin `accept`: iOS no reconoce la extensión .mgx y dejaría el archivo sin poder elegirse. Se comprueba el contenido. -->
        <input
          id="restore-file"
          class="ac-input"
          type="file"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'restore-error' : undefined}
          onchange={chooseFile}
        />
      </div>
      {#if error}
        <p class="ac-error" id="restore-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={cancel}>
          {t(locale, 'access.back')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary" disabled={!file}>
          {t(locale, 'access.continue')}
        </button>
      </div>
    </form>
  {:else if step === 'credential'}
    <form class="ac-form" onsubmit={openCopy} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'restore.credential.title')}</h2>
      <p>{t(locale, 'restore.credential.intro')}</p>
      <fieldset class="ac-fieldset">
        <legend class="ac-label">{t(locale, 'restore.credential.mode')}</legend>
        <label class="ac-check">
          <input type="radio" name="restore-mode" value="password" bind:group={mode} />
          <span>{t(locale, 'restore.credential.password')}</span>
        </label>
        <label class="ac-check">
          <input type="radio" name="restore-mode" value="recovery" bind:group={mode} />
          <span>{t(locale, 'restore.credential.key')}</span>
        </label>
      </fieldset>
      {#if mode === 'password'}
        <div class="ac-field">
          <label class="ac-label" for="restore-password">{t(locale, 'login.password')}</label>
          <input
            id="restore-password"
            class="ac-input"
            type="password"
            autocomplete="current-password"
            autocapitalize="off"
            spellcheck="false"
            required
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'restore-error' : undefined}
            bind:value={password}
          />
        </div>
      {:else}
        <RecoveryKeyInput
          {locale}
          id="restore-key"
          label={t(locale, 'key.label')}
          bind:value={keyInput}
        />
      {/if}
      {@render progressLine()}
      {#if busy && !progress}
        <p class="ac-hint" role="status">{t(locale, 'restore.opening')}</p>
      {/if}
      {#if error}
        <p class="ac-error" id="restore-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => go('file')}>
          {t(locale, 'access.back')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary" disabled={busy}>
          {t(locale, 'access.continue')}
        </button>
      </div>
    </form>
  {:else if step === 'password'}
    <form class="ac-form" onsubmit={fromNewPassword} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'restore.newpassword.title')}</h2>
      {#if counts}
        <p class="ac-ok">
          {t(locale, 'restore.found', { memories: counts.memories, photos: counts.photos })}
        </p>
      {/if}
      <p>{t(locale, 'restore.newpassword.intro')}</p>
      <PasswordPair
        {locale}
        idPrefix="restore"
        bind:password={newPassword}
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
      {#if counts && mode === 'password'}
        <p class="ac-ok">
          {t(locale, 'restore.found', { memories: counts.memories, photos: counts.photos })}
        </p>
      {/if}
      <p>{t(locale, 'restore.key.intro')}</p>
      <RecoveryKeyDisplay {locale} {recoveryKey} />
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={cancel}>
          {t(locale, 'access.cancel')}
        </button>
        <button type="submit" class="ac-btn ac-btn-primary">{t(locale, 'access.continue')}</button>
      </div>
    </form>
  {:else if step === 'verify'}
    <form
      class="ac-form"
      onsubmit={(e) => {
        e.preventDefault();
        if (keyState === 'ok' && saved) go('code');
      }}
    >
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'setup.verify.title')}</h2>
      <p>{t(locale, 'setup.verify.body')}</p>
      <RecoveryKeyInput
        {locale}
        id="restore-verify"
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
  {:else if step === 'code'}
    <form class="ac-form" onsubmit={create} novalidate>
      <h2 tabindex="-1" bind:this={heading}>{t(locale, 'restore.code.title')}</h2>
      <p>{t(locale, 'restore.code.body')}</p>
      <div class="ac-field">
        <label class="ac-label" for="restore-code">{t(locale, 'setup.code.label')}</label>
        <input
          id="restore-code"
          class="ac-input ac-input-key"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          autocorrect="off"
          spellcheck="false"
          required
          aria-describedby={error ? 'restore-code-hint restore-error' : 'restore-code-hint'}
          aria-invalid={error ? 'true' : undefined}
          bind:value={code}
        />
        <p class="ac-hint" id="restore-code-hint">{t(locale, 'setup.code.hint')}</p>
      </div>
      {#if error}
        <p class="ac-error" id="restore-error" role="alert">{t(locale, error)}</p>
      {/if}
      <div class="ac-actions ac-actions-row">
        <button type="button" class="ac-btn ac-btn-secondary" onclick={() => go('verify')}>
          {t(locale, 'access.back')}
        </button>
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          disabled={busy || wait > 0 || code.trim().length === 0}
        >
          {#if wait > 0}
            {t(locale, 'login.wait', { seconds: wait })}
          {:else if busy}
            {t(locale, 'restore.creating')}
          {:else}
            {t(locale, 'restore.submit')}
          {/if}
        </button>
      </div>
    </form>
  {:else}
    <div class="ac-form">
      <h2 tabindex="-1" bind:this={heading}>
        {t(locale, summary ? 'restore.done.title' : 'restore.title')}
      </h2>
      {@render progressLine()}
      {#if summary}
        <p class="ac-ok" role="status">
          {t(locale, 'restore.done.body', { restored: summary.restored, photos: summary.photos })}
        </p>
        <div class="ac-actions">
          <button type="button" class="ac-btn ac-btn-primary" onclick={enter}>
            {t(locale, 'restore.enter')}
          </button>
        </div>
      {:else if stopped}
        <p class="ac-error" role="alert">{t(locale, stopped)}</p>
        <div class="ac-actions ac-actions-row">
          <button type="button" class="ac-btn ac-btn-secondary" onclick={enter}>
            {t(locale, 'restore.later')}
          </button>
          <button
            type="button"
            class="ac-btn ac-btn-primary"
            disabled={busy}
            onclick={() => void upload()}
          >
            {t(locale, 'restore.retry')}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
