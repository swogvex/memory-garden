<script lang="ts">
  import {
    deviceTimeZone,
    formatCompactDate,
    isKnownTimeZone,
    listTimeZones,
    todayIn,
  } from '@/lib/dates';
  import { LOCALES, t, type Locale, type MessageKey } from '@/lib/i18n';
  import type { DateFormat } from '@/lib/settings';
  import { DATE_FORMATS } from '@/lib/validation';
  import { saveErrorKey, type Status } from './messages';
  import { prefs, updatePrefs } from './prefs.svelte';

  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  const device = deviceTimeZone();
  const zones = listTimeZones(device);
  const FORMAT_KEY = {
    dmy: 'settings.prefs.dateFormat.dmy',
    mdy: 'settings.prefs.dateFormat.mdy',
    ymd: 'settings.prefs.dateFormat.ymd',
  } as const satisfies Record<DateFormat, MessageKey>;

  let language = $state<Locale>(prefs.settings.language);
  let dateFormat = $state<DateFormat>(prefs.settings.dateFormat);
  let zoneMode = $state<'auto' | 'manual'>(prefs.settings.timeZone === null ? 'auto' : 'manual');
  let zone = $state(prefs.settings.timeZone ?? device);
  let busy = $state(false);
  let status = $state<Status | null>(null);

  const saved = $derived(prefs.settings.timeZone);
  const savedUnknown = $derived(saved !== null && !isKnownTimeZone(saved));
  const today = $derived(todayIn(prefs.settings.timeZone ?? undefined));
  // Una zona guardada en otro navegador que este no conoce sigue en la lista: así no se cambia sin querer al guardar.
  const zoneOptions = $derived(zones.includes(zone) ? zones : [zone, ...zones]);

  function syncFromSaved() {
    language = prefs.settings.language;
    dateFormat = prefs.settings.dateFormat;
    zoneMode = prefs.settings.timeZone === null ? 'auto' : 'manual';
    zone = prefs.settings.timeZone ?? device;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    status = null;
    try {
      await updatePrefs((s) => ({
        ...s,
        language,
        dateFormat,
        timeZone: zoneMode === 'auto' ? null : zone,
      }));
      status = { kind: 'ok', key: 'settings.saved' };
    } catch (error) {
      if (saveErrorKey(error) === 'settings.error.conflict') syncFromSaved();
      status = { kind: 'error', key: saveErrorKey(error) };
    } finally {
      busy = false;
    }
  }
</script>

<section class="st-card" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'settings.prefs.title')}</h2>
  <form class="st-form" novalidate onsubmit={submit}>
    <fieldset class="st-fieldset" aria-describedby={id('lang-hint')}>
      <legend>{t(locale, 'settings.prefs.language')}</legend>
      {#each LOCALES as code (code)}
        <label class="st-radio">
          <input type="radio" name={id('lang')} value={code} bind:group={language} />
          <span lang={code}>{t(code, code === 'es' ? 'language.es' : 'language.en')}</span>
        </label>
      {/each}
      <p class="ac-hint" id={id('lang-hint')}>{t(locale, 'settings.prefs.language.hint')}</p>
    </fieldset>

    <div class="ac-field">
      <label class="ac-label" for={id('format')}>{t(locale, 'settings.prefs.dateFormat')}</label>
      <select
        id={id('format')}
        class="ac-input st-select"
        bind:value={dateFormat}
        aria-describedby={id('format-hint')}
      >
        {#each DATE_FORMATS as format (format)}
          <option value={format}>
            {t(locale, FORMAT_KEY[format], {
              example: formatCompactDate(today, locale, format),
            })}
          </option>
        {/each}
      </select>
      <p class="ac-hint" id={id('format-hint')}>{t(locale, 'settings.prefs.dateFormat.hint')}</p>
    </div>

    <fieldset class="st-fieldset" aria-describedby={id('zone-hint')}>
      <legend>{t(locale, 'settings.prefs.timeZone')}</legend>
      <label class="st-radio">
        <input type="radio" name={id('zone-mode')} value="auto" bind:group={zoneMode} />
        <span>{t(locale, 'settings.prefs.timeZone.auto', { zone: device })}</span>
      </label>
      <label class="st-radio">
        <input type="radio" name={id('zone-mode')} value="manual" bind:group={zoneMode} />
        <span>{t(locale, 'settings.prefs.timeZone.manual')}</span>
      </label>
      {#if zoneMode === 'manual'}
        <div class="ac-field">
          <label class="ac-label" for={id('zone')}
            >{t(locale, 'settings.prefs.timeZone.select')}</label
          >
          <select id={id('zone')} class="ac-input st-select" bind:value={zone}>
            {#each zoneOptions as z (z)}
              <option value={z}>{z}</option>
            {/each}
          </select>
        </div>
      {/if}
      <p class="ac-hint" id={id('zone-hint')}>{t(locale, 'settings.prefs.timeZone.hint')}</p>
      {#if savedUnknown && saved}
        <p class="ac-hint">{t(locale, 'settings.prefs.timeZone.unknown', { zone: saved })}</p>
      {/if}
    </fieldset>

    <div class="ac-actions">
      <button type="submit" class="ac-btn ac-btn-primary" aria-disabled={busy ? 'true' : undefined}>
        {busy ? t(locale, 'settings.saving') : t(locale, 'settings.prefs.save')}
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
