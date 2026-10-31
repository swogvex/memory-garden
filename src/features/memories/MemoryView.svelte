<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import type { GardenMemory } from '@/features/calendar';
  import { capitalize, formatLongDate, parseIso } from '@/lib/dates';
  import { scrollRegion } from '@/lib/dom/scroll-region';
  import { t, type Locale } from '@/lib/i18n';
  import { FLOWER_LABEL, SEASON_LABEL } from './defaults';

  let {
    locale,
    memory,
    loadImage,
    onTrash,
    onClose,
  }: {
    locale: Locale;
    memory: GardenMemory;
    loadImage: (index: number) => Promise<string | null>;
    onTrash: () => Promise<void>;
    onClose: (outcome: 'closed' | 'edit' | 'trashed') => void;
  } = $props();

  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;
  let images = $state<(string | null | undefined)[]>(
    untrack(() => memory.photos.map(() => undefined)),
  );
  let confirming = $state(false);
  let trashing = $state(false);
  let trashError = $state(false);
  let dialogEl = $state<HTMLDialogElement>();
  let keepEl = $state<HTMLButtonElement>();
  let errEl = $state<HTMLParagraphElement>();
  let closed = false;
  let alive = true;

  const longDate = $derived.by(() => {
    const d = parseIso(memory.date);
    return d ? capitalize(formatLongDate(d, locale)) : memory.date;
  });
  // El enlace ya pasó por la validación (solo http/https); se vuelve a comprobar al mostrarlo.
  const safeLink = $derived(memory.link && /^https?:\/\//i.test(memory.link) ? memory.link : null);

  function close(outcome: 'closed' | 'edit' | 'trashed') {
    if (closed) return;
    closed = true;
    onClose(outcome);
  }

  async function askTrash() {
    if (trashing) return;
    confirming = true;
    await tick();
    keepEl?.focus();
  }
  async function keep() {
    confirming = false;
    await tick();
    dialogEl?.querySelector<HTMLElement>('[data-act="trash"]')?.focus();
  }
  async function doTrash() {
    if (trashing) return;
    trashing = true;
    trashError = false;
    try {
      await onTrash();
      close('trashed');
    } catch {
      trashing = false;
      confirming = false;
      trashError = true;
      await tick();
      errEl?.focus();
    }
  }

  onMount(() => {
    const el = dialogEl;
    if (!el) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (trashing) return;
      if (confirming) void keep();
      else close('closed');
    };
    const onCancel = (event: Event) => event.preventDefault();
    const onNativeClose = () => close('closed');
    el.addEventListener('keydown', onKey);
    el.addEventListener('cancel', onCancel);
    el.addEventListener('close', onNativeClose);
    el.showModal();
    void (async () => {
      for (let i = 0; i < memory.photos.length; i++) {
        const url = await loadImage(i); // una a una (memoria del móvil)
        if (!alive) return;
        images[i] = url;
      }
    })();
    return () => {
      alive = false;
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('close', onNativeClose);
    };
  });
</script>

<dialog class="dlg" bind:this={dialogEl} aria-labelledby={id('title')}>
  <div class="wrap">
    <div class="head">
      <h2 id={id('title')}>{memory.title}</h2>
      <button
        type="button"
        class="x"
        aria-label={t(locale, 'memory.view.close')}
        onclick={() => close('closed')}
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

    <!-- Si el cuerpo se desplaza (p. ej. con la confirmación de papelera), se puede enfocar (WCAG 2.1.1). -->
    <div class="body" use:scrollRegion={id('title')}>
      <p class="when">{longDate}</p>
      <dl class="meta">
        <div>
          <dt>{t(locale, 'memory.field.category')}</dt>
          <dd>{memory.category}</dd>
        </div>
        <div>
          <dt>{t(locale, 'memory.field.flower')}</dt>
          <dd>
            <span class="mark"><FlowerMark flower={memory.flower} /></span>
            {t(locale, FLOWER_LABEL[memory.flower])}
          </dd>
        </div>
        <div>
          <dt>{t(locale, 'memory.field.season')}</dt>
          <dd>{t(locale, SEASON_LABEL[memory.season])}</dd>
        </div>
      </dl>

      {#if memory.photos.length > 0}
        <ul class="gallery">
          {#each memory.photos as photo, i (photo.assetId)}
            {@const url = images[i]}
            <li>
              {#if url}
                <img src={url} alt={photo.alt || t(locale, 'memory.view.photo', { n: i + 1 })} />
              {:else}
                <span
                  class="nophoto"
                  role={url === null ? 'img' : undefined}
                  aria-label={url === null ? t(locale, 'memory.photo.unavailable') : undefined}
                >
                  {url === null ? t(locale, 'memory.photo.unavailable') : ''}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if memory.text}<p class="text">{memory.text}</p>{/if}

      {#if safeLink}
        <p>
          <a href={safeLink} target="_blank" rel="noopener noreferrer"
            >{t(locale, 'memory.view.link')}</a
          >
          <span class="visually-hidden">{t(locale, 'memory.view.newtab')}</span>
        </p>
      {/if}
    </div>

    <div class="actions">
      {#if confirming}
        <div
          class="discard"
          role="group"
          aria-labelledby={id('t-title')}
          aria-describedby={id('t-body')}
        >
          <p class="discard-text">
            <strong id={id('t-title')}>{t(locale, 'memory.trash.title')}</strong>
            <span id={id('t-body')}>{t(locale, 'memory.trash.body')}</span>
          </p>
          <button type="button" class="secondary" bind:this={keepEl} onclick={keep}
            >{t(locale, 'memory.trash.keep')}</button
          >
          <button
            type="button"
            class="danger"
            aria-disabled={trashing ? 'true' : undefined}
            onclick={doTrash}>{t(locale, 'memory.trash.confirm')}</button
          >
        </div>
      {:else}
        {#if trashError}
          <p class="error" role="alert" tabindex="-1" bind:this={errEl}>
            {t(locale, 'memory.error.trash')}
          </p>
        {/if}
        <button type="button" class="secondary" data-act="trash" onclick={askTrash}
          >{t(locale, 'memory.view.trash')}</button
        >
        <button type="button" class="primary" onclick={() => close('edit')}
          >{t(locale, 'memory.view.edit')}</button
        >
      {/if}
    </div>
  </div>
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
    background: var(--color-card);
    color: var(--color-text);
    box-shadow: var(--shadow-lg);
    touch-action: pan-y;
  }
  .dlg::backdrop {
    background: rgb(55 49 63 / 45%);
  }
  .wrap {
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
    overflow-wrap: anywhere;
  }
  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--tap-min);
    height: var(--tap-min);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-control);
    background: var(--color-card);
    color: var(--color-primary);
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    touch-action: pan-y;
  }
  /* El diálogo recorta lo que sobresale: el aro de foco va por dentro. */
  .body:focus-visible {
    outline-offset: -3px;
  }
  .when {
    margin: 0;
    color: var(--color-text-muted);
  }
  .meta {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: var(--space-3);
    margin: 0;
    min-width: 0;
  }
  dt {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  dd {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .mark {
    display: block;
    width: 1.5rem;
    height: 1.5rem;
  }
  .gallery {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 0;
  }
  .gallery img {
    display: block;
    width: 100%;
    height: auto;
    max-height: 28rem;
    object-fit: contain;
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  .nophoto {
    display: grid;
    place-items: center;
    min-height: 8rem;
    border: 1px dashed var(--color-border-control);
    border-radius: var(--radius-md);
    background: var(--color-surface-accent);
    color: var(--color-text-muted);
    text-align: center;
  }
  .text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    position: relative;
    isolation: isolate;
    overflow: hidden;
    padding: var(--space-3) var(--space-5) calc(var(--space-3) + env(safe-area-inset-bottom));
    border-top: 1px solid var(--color-border-decor);
  }
  /* Flores en la esquina inferior izquierda de la barra de botones (los botones van a la derecha).
     Nacen del borde, se mecen despacio y se ocultan si aparece un aviso en la barra. */
  .actions::before {
    content: '';
    position: absolute;
    z-index: -1;
    left: 0;
    bottom: 0;
    /* Alto fijo (el de la barra con un botón). Con `100%` el ramillete crecía al abrir la confirmación. */
    height: calc(var(--tap-min) + 2 * var(--space-3));
    aspect-ratio: 1;
    background: url('/decor/k1.svg') no-repeat left bottom / contain;
    transform-origin: 0 100%;
    pointer-events: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .actions::before {
      animation: mg-sway 7.5s ease-in-out infinite alternate;
    }
  }
  .primary,
  .secondary,
  .danger {
    min-height: var(--tap-min);
    padding: 0 var(--space-5);
    border-radius: var(--radius-control);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--color-primary);
    color: var(--color-on-primary);
  }
  .secondary {
    border: 1px solid var(--color-border-control);
    background: #fff;
    color: var(--color-primary);
  }
  .danger {
    border: 0;
    background: var(--color-error);
    color: #fff;
  }
  [aria-disabled='true'] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .error {
    flex: 1 1 100%;
    margin: 0;
    color: var(--color-error);
    font-size: var(--text-sm);
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
    /* Que el texto de la confirmación no quede encima del ramillete de la esquina. */
    padding-left: var(--space-7);
    text-align: left;
  }
  .discard-text strong {
    display: block;
  }
  @media (max-width: 47.99rem) {
    .dlg {
      box-sizing: border-box;
      width: 100vw;
      max-width: 100vw;
      max-height: 100dvh;
      height: 100dvh;
      margin: 0;
      border-radius: 0;
    }
    .wrap {
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
