<script lang="ts">
  import { tick } from 'svelte';
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import type { GardenSource } from '@/features/calendar';
  import { flowerKey } from '@/lib/flowers';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import {
    addCategory,
    canAddCategory,
    canRemoveCategory,
    categoryNameIssue,
    removeCategory,
    renameCategory,
    type Flower,
  } from '@/lib/settings';
  import { FLOWERS, LIMITS, MAX_CATEGORIES } from '@/lib/validation';
  import { countInCategory, moveCategory, type MoveProgress } from './categories-flow';
  import { categoryErrorStatus, type Status } from './messages';
  import { prefs, updatePrefs } from './prefs.svelte';

  let { locale, openGarden }: { locale: Locale; openGarden: () => Promise<GardenSource> } =
    $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  const categories = $derived(prefs.settings.categories);
  const flowerName = (f: Flower) => t(locale, flowerKey(f, 'name') as MessageKey);

  let sectionEl = $state<HTMLElement>();
  let busy = $state(false);
  let progress = $state<MoveProgress | null>(null);
  let status = $state<Status | null>(null);

  // Edición de una categoría (renombrar y/o cambiar su flor por defecto).
  let editing = $state<string | null>(null);
  let editName = $state('');
  let editFlower = $state<Flower>('rosa');
  let editError = $state<MessageKey | null>(null);

  // Alta.
  let newName = $state('');
  let newFlower = $state<Flower>('margarita');
  let addError = $state<MessageKey | null>(null);

  // Eliminación con destino para sus recuerdos.
  let removing = $state<{ name: string; count: number | null } | null>(null);
  let removeTarget = $state('');

  async function focusSel(selector: string) {
    await tick();
    sectionEl?.querySelector<HTMLElement>(selector)?.focus();
  }
  const rowButton = (name: string, kind: 'edit' | 'remove') =>
    `[data-cat="${CSS.escape(name)}"][data-action="${kind}"]`;

  function startEdit(name: string) {
    if (busy) return;
    const c = categories.find((x) => x.name === name);
    if (!c) return;
    removing = null;
    editing = name;
    editName = c.name;
    editFlower = c.flower;
    editError = null;
    status = null;
    void focusSel(`#${CSS.escape(id('edit-name'))}`);
  }

  function cancelEdit() {
    const name = editing;
    editing = null;
    if (name) void focusSel(rowButton(name, 'edit'));
  }

  async function saveEdit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || editing === null) return;
    const from = editing;
    editError = categoryNameIssue(editName, categories, from);
    if (editError) return void focusSel(`#${CSS.escape(id('edit-name'))}`);
    const to = editName.trim();
    busy = true;
    status = null;
    try {
      if (to !== from) await moveCategory(await openGarden(), from, to, (p) => (progress = p));
      await updatePrefs((s) => ({
        ...s,
        categories: renameCategory(s.categories, from, to, editFlower),
      }));
      editing = null;
      status = { kind: 'ok', key: 'settings.categories.renamed' };
      void focusSel(rowButton(to, 'edit'));
    } catch (error) {
      status = categoryErrorStatus(error);
    } finally {
      busy = false;
      progress = null;
    }
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    addError = canAddCategory(categories) ? categoryNameIssue(newName, categories) : null;
    if (addError) return void focusSel(`#${CSS.escape(id('new-name'))}`);
    if (!canAddCategory(categories)) return;
    const name = newName.trim();
    busy = true;
    status = null;
    try {
      await updatePrefs((s) => ({ ...s, categories: addCategory(s.categories, name, newFlower) }));
      newName = '';
      status = { kind: 'ok', key: 'settings.categories.added' };
    } catch (error) {
      status = categoryErrorStatus(error);
    } finally {
      busy = false;
    }
  }

  async function askRemove(name: string) {
    if (busy || !canRemoveCategory(categories)) return;
    editing = null;
    status = null;
    removeTarget = categories.find((c) => c.name !== name)?.name ?? '';
    removing = { name, count: null };
    void focusSel(`#${CSS.escape(id('remove-panel'))}`);
    try {
      const count = await countInCategory(await openGarden(), name);
      if (removing?.name === name) removing = { ...removing, count };
    } catch {
      removing = null;
      status = { kind: 'error', key: 'settings.categories.error.load' };
      void focusSel(rowButton(name, 'remove'));
    }
  }

  function cancelRemove() {
    const name = removing?.name;
    removing = null;
    if (name) void focusSel(rowButton(name, 'remove'));
  }

  async function confirmRemove() {
    if (busy || !removing) return;
    const { name } = removing;
    const count = removing.count;
    const target = removeTarget;
    if (count === null || (count > 0 && target === '')) return;
    busy = true;
    status = null;
    try {
      if (count > 0) await moveCategory(await openGarden(), name, target, (p) => (progress = p));
      await updatePrefs((s) => ({ ...s, categories: removeCategory(s.categories, name) }));
      removing = null;
      status = { kind: 'ok', key: 'settings.categories.removed' };
      void focusSel(`#${CSS.escape(id('new-name'))}`);
    } catch (error) {
      status = categoryErrorStatus(error);
    } finally {
      busy = false;
      progress = null;
    }
  }

  const removeText = (count: number) =>
    count === 0
      ? t(locale, 'settings.categories.remove.none')
      : count === 1
        ? t(locale, 'settings.categories.remove.one')
        : t(locale, 'settings.categories.remove.many', { count });
</script>

{#snippet flowerSelect(selectId: string, value: Flower, onChange: (f: Flower) => void)}
  <div class="ac-field">
    <label class="ac-label" for={selectId}>{t(locale, 'settings.categories.flower')}</label>
    <select
      id={selectId}
      class="ac-input st-select"
      {value}
      onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as Flower)}
    >
      {#each FLOWERS as f (f)}
        <option value={f}>{flowerName(f)}</option>
      {/each}
    </select>
  </div>
{/snippet}

<section class="st-card" aria-labelledby={id('title')} bind:this={sectionEl}>
  <h2 id={id('title')}>{t(locale, 'settings.categories.title')}</h2>
  <p>{t(locale, 'settings.categories.intro')}</p>
  <p class="ac-hint">
    {t(locale, 'settings.categories.count', { count: categories.length, max: MAX_CATEGORIES })}
  </p>

  <ul class="st-cats">
    {#each categories as c (c.name)}
      <li class="st-cat">
        <span class="st-cat-mark" aria-hidden="true"><FlowerMark flower={c.flower} /></span>
        <span class="st-cat-text">
          <span class="st-cat-name">{c.name}</span>
          <span class="st-cat-flower">{flowerName(c.flower)}</span>
        </span>
        <span class="st-cat-actions">
          <button
            type="button"
            class="ac-btn ac-btn-secondary"
            data-cat={c.name}
            data-action="edit"
            aria-label={t(locale, 'settings.categories.edit.label', { name: c.name })}
            aria-disabled={busy ? 'true' : undefined}
            onclick={() => startEdit(c.name)}>{t(locale, 'settings.categories.edit')}</button
          >
          <button
            type="button"
            class="ac-btn ac-btn-link"
            data-cat={c.name}
            data-action="remove"
            aria-label={t(locale, 'settings.categories.remove.label', { name: c.name })}
            aria-disabled={busy || !canRemoveCategory(categories) ? 'true' : undefined}
            aria-describedby={canRemoveCategory(categories) ? undefined : id('last')}
            onclick={() => void askRemove(c.name)}>{t(locale, 'settings.categories.remove')}</button
          >
        </span>

        {#if editing === c.name}
          <form class="st-panel" novalidate onsubmit={saveEdit}>
            <div class="st-two">
              <div class="ac-field">
                <label class="ac-label" for={id('edit-name')}
                  >{t(locale, 'settings.categories.name')}</label
                >
                <input
                  id={id('edit-name')}
                  class="ac-input"
                  type="text"
                  autocomplete="off"
                  maxlength={LIMITS.category}
                  bind:value={editName}
                  aria-invalid={editError ? 'true' : undefined}
                  aria-describedby={editError ? id('edit-err') : undefined}
                />
              </div>
              {@render flowerSelect(id('edit-flower'), editFlower, (f) => (editFlower = f))}
            </div>
            {#if editError}
              <p class="ac-error" id={id('edit-err')}>
                {t(locale, editError, { max: LIMITS.category })}
              </p>
            {/if}
            <div class="ac-actions">
              <button
                type="submit"
                class="ac-btn ac-btn-primary"
                aria-disabled={busy ? 'true' : undefined}
              >
                {busy ? t(locale, 'settings.saving') : t(locale, 'settings.categories.save')}
              </button>
              <button
                type="button"
                class="ac-btn ac-btn-secondary"
                aria-disabled={busy ? 'true' : undefined}
                onclick={() => {
                  if (!busy) cancelEdit();
                }}>{t(locale, 'settings.categories.cancel')}</button
              >
            </div>
          </form>
        {/if}

        {#if removing?.name === c.name}
          <div
            class="st-panel"
            id={id('remove-panel')}
            tabindex="-1"
            role="group"
            aria-labelledby={id('remove-title')}
          >
            <h3 id={id('remove-title')}>
              {t(locale, 'settings.categories.remove.title', { name: c.name })}
            </h3>
            {#if removing.count === null}
              <p role="status">{t(locale, 'settings.categories.counting')}</p>
            {:else}
              <p>{removeText(removing.count)}</p>
              {#if removing.count > 0}
                <div class="ac-field">
                  <label class="ac-label" for={id('target')}
                    >{t(locale, 'settings.categories.remove.target')}</label
                  >
                  <select id={id('target')} class="ac-input st-select" bind:value={removeTarget}>
                    {#each categories.filter((x) => x.name !== c.name) as other (other.name)}
                      <option value={other.name}>{other.name}</option>
                    {/each}
                  </select>
                </div>
                <p class="ac-hint">{t(locale, 'settings.categories.trashNote')}</p>
              {/if}
              <div class="ac-actions">
                <button
                  type="button"
                  class="ac-btn ac-btn-primary"
                  aria-disabled={busy ? 'true' : undefined}
                  onclick={() => void confirmRemove()}
                >
                  {busy
                    ? t(locale, 'settings.saving')
                    : t(locale, 'settings.categories.remove.confirm')}
                </button>
                <button
                  type="button"
                  class="ac-btn ac-btn-secondary"
                  aria-disabled={busy ? 'true' : undefined}
                  onclick={() => {
                    if (!busy) cancelRemove();
                  }}>{t(locale, 'settings.categories.cancel')}</button
                >
              </div>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
  {#if !canRemoveCategory(categories)}
    <p class="ac-hint" id={id('last')}>{t(locale, 'settings.categories.last')}</p>
  {/if}

  <form class="st-panel" novalidate onsubmit={add} aria-labelledby={id('add-title')}>
    <h3 id={id('add-title')}>{t(locale, 'settings.categories.add.title')}</h3>
    {#if canAddCategory(categories)}
      <div class="st-two">
        <div class="ac-field">
          <label class="ac-label" for={id('new-name')}
            >{t(locale, 'settings.categories.name')}</label
          >
          <input
            id={id('new-name')}
            class="ac-input"
            type="text"
            autocomplete="off"
            maxlength={LIMITS.category}
            bind:value={newName}
            aria-invalid={addError ? 'true' : undefined}
            aria-describedby={addError ? id('add-err') : undefined}
          />
        </div>
        {@render flowerSelect(id('new-flower'), newFlower, (f) => (newFlower = f))}
      </div>
      {#if addError}
        <p class="ac-error" id={id('add-err')}>{t(locale, addError, { max: LIMITS.category })}</p>
      {/if}
      <div class="ac-actions">
        <button
          type="submit"
          class="ac-btn ac-btn-primary"
          aria-disabled={busy ? 'true' : undefined}
        >
          {t(locale, 'settings.categories.add')}
        </button>
      </div>
    {:else}
      <p id={id('new-name')} tabindex="-1">
        {t(locale, 'settings.categories.full', { max: MAX_CATEGORIES })}
      </p>
    {/if}
  </form>

  <p
    class="st-status"
    class:ok={status?.kind === 'ok'}
    class:error={status?.kind === 'error'}
    role="status"
  >
    {#if progress}
      {t(locale, 'settings.categories.progress', { done: progress.done, total: progress.total })}
    {:else if status}
      {t(locale, status.key, status.params)}
    {/if}
  </p>
</section>
