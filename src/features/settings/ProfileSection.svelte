<script lang="ts">
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { LIMITS, isCleanText } from '@/lib/validation';
  import { saveErrorKey, type Status } from './messages';
  import { prefs, updatePrefs } from './prefs.svelte';

  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  let name = $state(prefs.settings.displayName);
  let welcome = $state(prefs.settings.welcomeMessage);
  let busy = $state(false);
  let status = $state<Status | null>(null);
  let errors = $state<{ name?: MessageKey; welcome?: MessageKey }>({});

  function validate(): boolean {
    const next: typeof errors = {};
    if (name.trim().length > LIMITS.displayName || !isCleanText(name.trim()))
      next.name = 'settings.profile.error.name';
    if (welcome.length > LIMITS.welcome || !isCleanText(welcome, true))
      next.welcome = 'settings.profile.error.welcome';
    errors = next;
    return Object.keys(next).length === 0;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return; // sin guardados duplicados
    status = null;
    if (!validate()) return;
    busy = true;
    try {
      await updatePrefs((s) => ({
        ...s,
        displayName: name.trim(),
        welcomeMessage: welcome.trim(),
      }));
      name = prefs.settings.displayName;
      welcome = prefs.settings.welcomeMessage;
      status = { kind: 'ok', key: 'settings.saved' };
    } catch (error) {
      // Lo escrito se conserva en los campos para poder reintentar (salvo conflicto: se ve lo del otro dispositivo).
      if (saveErrorKey(error) === 'settings.error.conflict') {
        name = prefs.settings.displayName;
        welcome = prefs.settings.welcomeMessage;
      }
      status = { kind: 'error', key: saveErrorKey(error) };
    } finally {
      busy = false;
    }
  }
</script>

<section class="st-card" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'settings.profile.title')}</h2>
  <form class="st-form" novalidate onsubmit={submit}>
    <div class="ac-field">
      <label class="ac-label" for={id('name')}>{t(locale, 'settings.profile.name')}</label>
      <input
        id={id('name')}
        class="ac-input"
        type="text"
        autocomplete="off"
        maxlength={LIMITS.displayName}
        bind:value={name}
        aria-invalid={errors.name ? 'true' : undefined}
        aria-describedby={`${id('name-hint')}${errors.name ? ` ${id('name-err')}` : ''}`}
      />
      <p class="ac-hint" id={id('name-hint')}>{t(locale, 'settings.profile.name.hint')}</p>
      {#if errors.name}
        <p class="ac-error" id={id('name-err')}>
          {t(locale, errors.name, { max: LIMITS.displayName })}
        </p>
      {/if}
    </div>
    <div class="ac-field">
      <label class="ac-label" for={id('welcome')}>{t(locale, 'settings.profile.welcome')}</label>
      <textarea
        id={id('welcome')}
        class="ac-input st-textarea"
        autocomplete="off"
        maxlength={LIMITS.welcome}
        bind:value={welcome}
        aria-invalid={errors.welcome ? 'true' : undefined}
        aria-describedby={`${id('welcome-hint')} ${id('welcome-count')}${errors.welcome ? ` ${id('welcome-err')}` : ''}`}
      ></textarea>
      <p class="ac-hint" id={id('welcome-hint')}>{t(locale, 'settings.profile.welcome.hint')}</p>
      <p class="ac-hint" id={id('welcome-count')}>
        {t(locale, 'settings.profile.welcome.count', {
          count: welcome.length,
          max: LIMITS.welcome,
        })}
      </p>
      {#if errors.welcome}
        <p class="ac-error" id={id('welcome-err')}>
          {t(locale, errors.welcome, { max: LIMITS.welcome })}
        </p>
      {/if}
    </div>
    <div class="ac-actions">
      <button type="submit" class="ac-btn ac-btn-primary" aria-disabled={busy ? 'true' : undefined}>
        {busy ? t(locale, 'settings.saving') : t(locale, 'settings.profile.save')}
      </button>
    </div>
    <p
      class="st-status"
      class:ok={status?.kind === 'ok'}
      class:error={status?.kind === 'error'}
      role="status"
    >
      {status ? t(locale, status.key) : ''}
    </p>
  </form>
</section>
