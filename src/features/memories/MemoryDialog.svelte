<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import type {
    CreateMemoryResult,
    GardenMemory,
    PhotoSlot,
    SaveMemoryInput,
  } from '@/features/calendar';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import {
    createBrowserCodec,
    PHOTO_ERROR_MESSAGE,
    PhotoError,
    processPhoto,
    type ImageCodec,
  } from '@/lib/photos';
  import { FLOWERS, LIMITS, MAX_PHOTOS, SEASONS } from '@/lib/validation';
  import {
    FLOWER_LABEL,
    SEASON_LABEL,
    type CategoryOption,
    type Flower,
    type Season,
  } from './defaults';
  import {
    flowerForCategory,
    initialFields,
    isDirty,
    makeCover,
    moveItem,
    removeAt,
    seasonOfDate,
    validateFields,
    type FieldErrors,
    type FormFields,
  } from './form-model';

  type PhotoItem = {
    key: number;
    alt: string;
    /** `''` = aún sin miniatura (o no disponible). */
    url: string;
    /** `true` si la URL la creó este diálogo y debe revocarla (las de la fuente no). */
    owned: boolean;
  } & (
    | { kind: 'kept'; assetId: string; thumbId: string }
    | { kind: 'new'; photo: Uint8Array; thumb: Uint8Array }
  );

  interface PhotoProblem {
    id: number;
    name: string;
    message: MessageKey;
  }

  let {
    locale,
    date,
    categories,
    memory = null,
    loadThumb,
    onSave,
    onClose,
  }: {
    locale: Locale;
    date: string;
    categories: readonly CategoryOption[];
    memory?: GardenMemory | null;
    loadThumb?: (memory: GardenMemory, index: number) => Promise<string | null>;
    onSave: (input: SaveMemoryInput) => Promise<CreateMemoryResult>;
    onClose: (result: CreateMemoryResult | null) => void;
  } = $props();

  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  let nextKey = 0;
  const initial: FormFields = untrack(() =>
    memory
      ? {
          title: memory.title,
          date: memory.date,
          category: memory.category,
          text: memory.text,
          link: memory.link ?? '',
          flower: memory.flower,
          season: memory.season,
        }
      : initialFields(date, categories),
  );
  const initialKept = untrack(() => memory?.photos ?? []).map((p, index) => ({ p, index }));
  const codec: ImageCodec = createBrowserCodec();
  const controller = new AbortController();

  let fields = $state<FormFields>({ ...initial });
  let flowerTouched = $state(untrack(() => memory !== null));
  let seasonTouched = $state(untrack(() => memory !== null));
  let photos = $state<PhotoItem[]>(
    initialKept.map(({ p }) => ({
      key: nextKey++,
      kind: 'kept' as const,
      assetId: p.assetId,
      thumbId: p.thumbId,
      alt: p.alt,
      url: '',
      owned: false,
    })),
  );
  let errors = $state<FieldErrors>({});
  let problems = $state<PhotoProblem[]>([]);
  let limitHit = $state(false);
  let processing = $state(false);
  let progress = $state<{ current: number; total: number } | null>(null);
  let saving = $state(false);
  let saveError = $state(false);
  let confirming = $state(false);

  let dialogEl = $state<HTMLDialogElement>();
  let titleEl = $state<HTMLInputElement>();
  let fileEl = $state<HTMLInputElement>();
  let addEl = $state<HTMLButtonElement>();
  let keepEl = $state<HTMLButtonElement>();
  let saveErrEl = $state<HTMLParagraphElement>();
  let closed = false;
  let lastFocus: HTMLElement | null = null;

  const signature = (list: readonly PhotoItem[]) =>
    list.map((p) => (p.kind === 'kept' ? `k:${p.assetId}:${p.alt}` : `n:${p.key}`)).join('|');
  const initialSignature = untrack(() => signature(photos));
  const photosChanged = $derived(signature(photos) !== initialSignature);
  const dirty = $derived(isDirty(initial, fields, photosChanged ? 1 : 0));
  const categoryOptions = $derived(
    memory && !categories.some((c) => c.name === memory.category)
      ? [...categories, { name: memory.category, flower: memory.flower }]
      : categories,
  );
  const full = $derived(photos.length >= MAX_PHOTOS);
  const busy = $derived(saving || processing);

  function close(result: CreateMemoryResult | null) {
    if (closed) return;
    closed = true;
    onClose(result);
  }

  function requestClose() {
    if (saving) return;
    if (!dirty) return close(null);
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirming = true;
    void tick().then(() => keepEl?.focus());
  }

  async function keepEditing() {
    confirming = false;
    await tick();
    (lastFocus?.isConnected ? lastFocus : titleEl)?.focus();
  }

  onMount(() => {
    const el = dialogEl;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); // D-137: el cierre lo decidimos nosotros
      if (saving) return;
      if (confirming) void keepEditing();
      else requestClose();
    };
    const onCancel = (event: Event) => event.preventDefault();
    const onNativeClose = () => close(null);
    el.addEventListener('keydown', onKey);
    el.addEventListener('cancel', onCancel);
    el.addEventListener('close', onNativeClose);
    el.showModal();
    if (window.matchMedia('(min-width: 48rem)').matches) titleEl?.focus();

    // D-139: en móvil el teclado no debe tapar los botones (CSSOM, no atributo style).
    const vv = window.visualViewport;
    const sync = () => {
      if (!vv) return;
      el.style.setProperty('--vv-h', `${vv.height}px`);
      el.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    };
    sync();
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);

    if (memory && loadThumb) {
      const source = memory;
      void (async () => {
        for (const { index, p } of initialKept) {
          const url = await loadThumb(source, index);
          if (closed || controller.signal.aborted) return;
          const item = photos.find((x) => x.kind === 'kept' && x.assetId === p.assetId);
          if (item && url) item.url = url;
        }
      })();
    }
    return () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('close', onNativeClose);
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
    };
  });

  onDestroy(() => {
    controller.abort();
    for (const p of photos) if (p.owned) URL.revokeObjectURL(p.url);
  });

  $effect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  });

  function clearError(name: string) {
    if (errors[name]) errors = { ...errors, [name]: undefined };
  }
  function clearAltErrors() {
    errors = Object.fromEntries(Object.entries(errors).filter(([k]) => !k.startsWith('alt-')));
  }

  function setCategory(name: string) {
    fields.category = name;
    clearError('category');
    if (!flowerTouched) fields.flower = flowerForCategory(categories, name, fields.flower);
  }
  function setDate(value: string) {
    fields.date = value;
    clearError('date');
    if (!seasonTouched) {
      const season = seasonOfDate(value);
      if (season) fields.season = season;
    }
  }

  async function onFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0 || processing) return;
    const accepted = files.slice(0, Math.max(0, MAX_PHOTOS - photos.length));
    limitHit = files.length > accepted.length;
    problems = [];
    processing = true;
    try {
      for (const [index, file] of accepted.entries()) {
        if (controller.signal.aborted) break;
        progress = { current: index + 1, total: accepted.length };
        try {
          const done = await processPhoto(file, codec); // UNA a la vez (memoria del móvil)
          if (controller.signal.aborted) break;
          const url = URL.createObjectURL(
            new Blob([done.thumb.bytes.slice().buffer], { type: 'image/jpeg' }),
          );
          photos = [
            ...photos,
            {
              key: nextKey++,
              kind: 'new',
              photo: done.photo.bytes,
              thumb: done.thumb.bytes,
              alt: '',
              url,
              owned: true,
            },
          ];
        } catch (error) {
          const code = error instanceof PhotoError ? error.code : 'decode_failed';
          problems = [
            ...problems,
            { id: nextKey++, name: file.name, message: PHOTO_ERROR_MESSAGE[code] },
          ];
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      processing = false;
      progress = null;
    }
  }

  const focusAction = (key: number, act: string) =>
    dialogEl?.querySelector<HTMLElement>(`[data-key="${key}"][data-act="${act}"]`)?.focus();

  async function movePhoto(index: number, delta: -1 | 1) {
    const item = photos[index];
    if (!item || index + delta < 0 || index + delta >= photos.length) return;
    photos = moveItem(photos, index, index + delta);
    clearAltErrors();
    await tick();
    focusAction(item.key, delta < 0 ? 'earlier' : 'later');
  }
  async function coverPhoto(index: number) {
    const item = photos[index];
    if (!item || index === 0) return;
    photos = makeCover(photos, index);
    clearAltErrors();
    await tick();
    focusAction(item.key, 'later');
  }
  async function removePhoto(index: number) {
    const item = photos[index];
    if (!item) return;
    if (item.owned) URL.revokeObjectURL(item.url);
    photos = removeAt(photos, index);
    clearAltErrors();
    limitHit = false;
    await tick();
    addEl?.focus();
  }

  async function focusFirstError() {
    await tick();
    const order = ['title', 'date', 'category', 'text', 'link'];
    const name = order.find((n) => errors[n]);
    const target = name
      ? document.getElementById(id(name))
      : (() => {
          const alt = photos.findIndex((_, i) => errors[`alt-${i}`]);
          const item = photos[alt];
          return item ? document.getElementById(id(`alt-${item.key}`)) : null;
        })();
    target?.focus();
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving || processing || closed) return;
    const result = validateFields(
      fields,
      photos.map((p) => p.alt.trim()),
    );
    if (!result.ok) {
      errors = result.errors;
      saveError = false;
      void focusFirstError();
      return;
    }
    errors = {};
    saving = true; // síncrono: un segundo envío en el mismo instante ya no entra
    saveError = false;
    try {
      const slots: PhotoSlot[] = photos.map((p) =>
        p.kind === 'kept'
          ? { kind: 'kept', assetId: p.assetId, thumbId: p.thumbId, alt: p.alt.trim() }
          : { kind: 'new', photo: p.photo, thumb: p.thumb, alt: p.alt.trim() },
      );
      const outcome = await onSave({ fields: result.fields, photos: slots });
      close(outcome);
    } catch {
      saving = false;
      saveError = true;
      await tick();
      saveErrEl?.focus();
    }
  }
</script>

<dialog class="dlg" bind:this={dialogEl} aria-labelledby={id('heading')}>
  <form class="form" novalidate onsubmit={submit}>
    <div class="head">
      <h2 id={id('heading')}>{memory ? t(locale, 'memory.edit') : t(locale, 'memory.new')}</h2>
      <button
        type="button"
        class="x"
        aria-label={t(locale, 'memory.close')}
        aria-disabled={saving ? 'true' : undefined}
        onclick={requestClose}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
          focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg
        >
      </button>
    </div>

    <div class="body">
      <section class="photos" aria-labelledby={id('photos')}>
        <div class="photos-head">
          <h3 id={id('photos')}>{t(locale, 'memory.photos.heading')}</h3>
          <p class="count" aria-live="polite">
            {t(locale, 'memory.photos.count', { count: photos.length, max: MAX_PHOTOS })}
          </p>
        </div>
        <p class="hint">{t(locale, 'memory.photos.hint')}</p>

        {#if photos.length > 0}
          <ul class="photo-list">
            {#each photos as item, i (item.key)}
              <li class="photo">
                <span class="frame">
                  {#if item.url}
                    <img
                      src={item.url}
                      alt={t(locale, 'memory.photos.preview', { n: i + 1 })}
                      width="96"
                      height="96"
                    />
                  {:else}
                    <span class="nothumb">{t(locale, 'memory.photo.unavailable')}</span>
                  {/if}
                  {#if i === 0}<span class="badge">{t(locale, 'memory.photos.cover')}</span>{/if}
                </span>
                <div class="photo-fields">
                  <label for={id(`alt-${item.key}`)}>
                    {t(locale, 'memory.photos.alt', { n: i + 1 })}
                  </label>
                  <input
                    id={id(`alt-${item.key}`)}
                    type="text"
                    bind:value={item.alt}
                    maxlength={LIMITS.alt}
                    autocomplete="off"
                    aria-invalid={errors[`alt-${i}`] ? 'true' : undefined}
                    aria-describedby={errors[`alt-${i}`] ? id(`alt-${item.key}-err`) : undefined}
                    oninput={() => clearError(`alt-${i}`)}
                  />
                  {#if errors[`alt-${i}`]}
                    {@const key = errors[`alt-${i}`]}
                    {#if key}<p class="error" id={id(`alt-${item.key}-err`)}>
                        {t(locale, key, { max: LIMITS.alt })}
                      </p>{/if}
                  {/if}
                  <div class="photo-actions">
                    <button
                      type="button"
                      class="small"
                      data-key={item.key}
                      data-act="earlier"
                      aria-disabled={i === 0 ? 'true' : undefined}
                      aria-label={t(locale, 'memory.photos.earlier.label', { n: i + 1 })}
                      onclick={() => movePhoto(i, -1)}>{t(locale, 'memory.photos.earlier')}</button
                    >
                    <button
                      type="button"
                      class="small"
                      data-key={item.key}
                      data-act="later"
                      aria-disabled={i === photos.length - 1 ? 'true' : undefined}
                      aria-label={t(locale, 'memory.photos.later.label', { n: i + 1 })}
                      onclick={() => movePhoto(i, 1)}>{t(locale, 'memory.photos.later')}</button
                    >
                    {#if i > 0}
                      <button
                        type="button"
                        class="small"
                        data-key={item.key}
                        data-act="cover"
                        aria-label={t(locale, 'memory.photos.makeCover.label', { n: i + 1 })}
                        onclick={() => coverPhoto(i)}>{t(locale, 'memory.photos.makeCover')}</button
                      >
                    {/if}
                    <button
                      type="button"
                      class="small"
                      data-key={item.key}
                      data-act="remove"
                      aria-label={t(locale, 'memory.photos.remove.label', { n: i + 1 })}
                      onclick={() => removePhoto(i)}>{t(locale, 'memory.photos.remove')}</button
                    >
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <input bind:this={fileEl} type="file" accept="image/*" multiple hidden onchange={onFiles} />
        <button
          type="button"
          class="secondary"
          bind:this={addEl}
          aria-disabled={processing || full ? 'true' : undefined}
          onclick={() => {
            if (!processing && !full) fileEl?.click();
          }}>{t(locale, 'memory.photos.add')}</button
        >
        <p class="hint" role="status">
          {#if progress}{t(locale, 'memory.photos.progress', progress)}{/if}
          {#if limitHit}{t(locale, 'memory.photos.limit')}{/if}
        </p>
        {#if problems.length > 0}
          <ul class="problems" role="alert">
            {#each problems as p (p.id)}
              <li><strong class="file">{p.name}</strong>: {t(locale, p.message)}</li>
            {/each}
          </ul>
        {/if}
      </section>

      <div class="field">
        <label for={id('title')}>{t(locale, 'memory.field.title')}</label>
        <input
          id={id('title')}
          bind:this={titleEl}
          type="text"
          bind:value={fields.title}
          maxlength={LIMITS.title}
          autocomplete="off"
          aria-required="true"
          aria-invalid={errors.title ? 'true' : undefined}
          aria-describedby={errors.title ? id('title-err') : undefined}
          oninput={() => clearError('title')}
        />
        {#if errors.title}<p class="error" id={id('title-err')}>
            {t(locale, errors.title, { max: LIMITS.title })}
          </p>{/if}
      </div>

      <div class="row">
        <div class="field">
          <label for={id('date')}>{t(locale, 'memory.field.date')}</label>
          <input
            id={id('date')}
            type="date"
            min="1900-01-01"
            max="2200-12-31"
            value={fields.date}
            aria-required="true"
            aria-invalid={errors.date ? 'true' : undefined}
            aria-describedby={errors.date ? id('date-err') : undefined}
            oninput={(e) => setDate(e.currentTarget.value)}
          />
          {#if errors.date}<p class="error" id={id('date-err')}>{t(locale, errors.date)}</p>{/if}
        </div>
        <div class="field">
          <label for={id('season')}>{t(locale, 'memory.field.season')}</label>
          <select
            id={id('season')}
            value={fields.season}
            onchange={(e) => {
              fields.season = e.currentTarget.value as Season;
              seasonTouched = true;
            }}
          >
            {#each SEASONS as s (s)}
              <option value={s}>{t(locale, SEASON_LABEL[s])}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="field">
        <label for={id('category')}>{t(locale, 'memory.field.category')}</label>
        <select
          id={id('category')}
          value={fields.category}
          aria-required="true"
          aria-invalid={errors.category ? 'true' : undefined}
          aria-describedby={errors.category ? id('category-err') : undefined}
          onchange={(e) => setCategory(e.currentTarget.value)}
        >
          {#each categoryOptions as c (c.name)}
            <option value={c.name}>{c.name}</option>
          {/each}
        </select>
        {#if errors.category}<p class="error" id={id('category-err')}>
            {t(locale, errors.category)}
          </p>{/if}
      </div>

      <fieldset class="flowers">
        <legend>{t(locale, 'memory.field.flower')}</legend>
        <div class="flower-grid">
          {#each FLOWERS as f (f)}
            <label class="flower">
              <input
                type="radio"
                class="visually-hidden"
                name={id('flower')}
                value={f}
                checked={fields.flower === f}
                onchange={() => {
                  fields.flower = f as Flower;
                  flowerTouched = true;
                }}
              />
              <span class="mark"><FlowerMark flower={f} /></span>
              <span class="flower-name">{t(locale, FLOWER_LABEL[f])}</span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="field">
        <label for={id('text')}>{t(locale, 'memory.field.text')}</label>
        <textarea
          id={id('text')}
          rows="6"
          bind:value={fields.text}
          maxlength={LIMITS.text}
          aria-invalid={errors.text ? 'true' : undefined}
          aria-describedby={errors.text
            ? `${id('text-count')} ${id('text-err')}`
            : id('text-count')}
          oninput={() => clearError('text')}></textarea>
        <p class="hint" id={id('text-count')}>
          {t(locale, 'memory.field.text.count', { count: fields.text.length, max: LIMITS.text })}
        </p>
        {#if errors.text}<p class="error" id={id('text-err')}>
            {t(locale, errors.text, { max: LIMITS.text })}
          </p>{/if}
      </div>

      <div class="field">
        <label for={id('link')}>{t(locale, 'memory.field.link')}</label>
        <input
          id={id('link')}
          type="url"
          inputmode="url"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          bind:value={fields.link}
          maxlength={LIMITS.link}
          aria-invalid={errors.link ? 'true' : undefined}
          aria-describedby={errors.link ? `${id('link-hint')} ${id('link-err')}` : id('link-hint')}
          oninput={() => clearError('link')}
        />
        <p class="hint" id={id('link-hint')}>{t(locale, 'memory.field.link.hint')}</p>
        {#if errors.link}<p class="error" id={id('link-err')}>{t(locale, errors.link)}</p>{/if}
      </div>
    </div>

    <div class="actions">
      {#if confirming}
        <div
          class="discard"
          role="group"
          aria-labelledby={id('discard-title')}
          aria-describedby={id('discard-body')}
        >
          <p class="discard-text">
            <strong id={id('discard-title')}>{t(locale, 'memory.discard.title')}</strong>
            <span id={id('discard-body')}>{t(locale, 'memory.discard.body')}</span>
          </p>
          <button type="button" class="secondary" bind:this={keepEl} onclick={keepEditing}>
            {t(locale, 'memory.discard.keep')}
          </button>
          <button type="button" class="secondary" onclick={() => close(null)}>
            {t(locale, 'memory.discard.confirm')}
          </button>
        </div>
      {:else}
        {#if saveError}
          <p class="error grow" role="alert" tabindex="-1" bind:this={saveErrEl}>
            {t(locale, 'memory.error.save')}
          </p>
        {/if}
        <button
          type="button"
          class="secondary"
          aria-disabled={saving ? 'true' : undefined}
          onclick={requestClose}>{t(locale, 'memory.cancel')}</button
        >
        <button type="submit" class="primary" aria-disabled={busy ? 'true' : undefined}>
          {saving ? t(locale, 'memory.saving') : t(locale, 'memory.save')}
        </button>
      {/if}
    </div>
  </form>
</dialog>

<style>
  .dlg {
    width: min(42rem, calc(100% - 2 * var(--gutter)));
    max-width: none;
    max-height: 90dvh;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--color-bg);
    color: var(--color-text);
    box-shadow: var(--shadow-lg);
  }
  .dlg::backdrop {
    background: rgb(55 49 63 / 45%);
  }
  .form {
    display: flex;
    flex-direction: column;
    max-height: 90dvh;
  }
  .head {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--color-border-decor);
  }
  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }
  h3 {
    margin: 0;
    font-size: var(--text-base);
  }
  .x {
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-pill);
    background: #fff;
    color: var(--color-primary);
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    overflow-y: auto;
  }
  .actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-5) calc(var(--space-3) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--color-border-decor);
    background: var(--color-bg);
  }
  .field {
    display: grid;
    gap: var(--space-1);
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-4);
  }
  label,
  legend {
    font-weight: 600;
  }
  input[type='text'],
  input[type='url'],
  input[type='date'],
  select,
  textarea {
    width: 100%;
    min-height: var(--tap-min);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    background: #fff;
    color: inherit;
    font: inherit;
  }
  textarea {
    resize: vertical;
  }
  [aria-invalid='true'] {
    border: 2px solid var(--color-error);
  }
  .error {
    margin: 0;
    color: var(--color-error);
    font-size: var(--text-sm);
  }
  .error.grow {
    flex: 1 1 100%;
    text-align: left;
  }
  .hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .photos {
    display: grid;
    gap: var(--space-2);
  }
  .photos-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .count {
    margin: 0;
    font-weight: 600;
  }
  .photo-list,
  .problems {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .problems {
    color: var(--color-error);
    font-size: var(--text-sm);
  }
  .file {
    overflow-wrap: anywhere;
  }
  .photo {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--color-border-decor);
    border-radius: var(--radius-md);
    background: #fff;
  }
  .frame {
    position: relative;
    flex: none;
    align-self: flex-start;
    padding: 4px 4px 12px;
    background: #fff;
    box-shadow: var(--shadow-sm);
    transform: rotate(-2deg);
  }
  .frame img {
    display: block;
    width: 6rem;
    height: 6rem;
    object-fit: cover;
  }
  .nothumb {
    display: grid;
    place-items: center;
    width: 6rem;
    height: 6rem;
    background: var(--color-surface);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    text-align: center;
  }
  .badge {
    position: absolute;
    left: 6px;
    bottom: 14px;
    padding: 0 6px;
    border-radius: var(--radius-pill);
    background: var(--color-primary);
    color: var(--color-on-primary);
    font-size: 0.75rem;
  }
  .photo-fields {
    flex: 1 1 auto;
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  .photo-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .flowers {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .flower-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  .flower {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: var(--space-2);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    background: #fff;
    font-weight: 400;
    cursor: pointer;
  }
  .flower:has(input:checked) {
    border: 2px solid var(--color-primary);
    background: var(--color-surface);
    font-weight: 600;
  }
  .flower:has(input:focus-visible) {
    outline: 3px solid var(--color-focus);
    outline-offset: 2px;
  }
  .mark {
    display: block;
    width: 2rem;
    height: 2rem;
  }
  .flower-name {
    font-size: var(--text-sm);
  }
  .primary,
  .secondary,
  .small {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border-radius: var(--radius-pill);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  .primary:hover {
    background: var(--color-primary-hover);
  }
  .secondary,
  .small {
    border: 1px solid var(--color-border-control);
    background: #fff;
    color: var(--color-primary);
  }
  .small {
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
  }
  [aria-disabled='true'] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .discard {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    width: 100%;
  }
  .discard-text {
    flex: 1 1 14rem;
    margin: 0;
    text-align: left;
  }
  .discard-text strong {
    display: block;
  }

  @media (max-width: 47.99rem) {
    .dlg {
      position: fixed;
      inset: var(--vv-top, 0px) 0 auto 0;
      box-sizing: border-box;
      width: 100vw;
      max-width: 100vw;
      height: var(--vv-h, 100dvh);
      max-height: none;
      margin: 0;
      border-radius: 0;
    }
    .form {
      height: 100%;
      max-height: none;
    }
    .head,
    .body,
    .actions {
      padding-inline: var(--gutter);
    }
  }
</style>
