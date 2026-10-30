<script lang="ts">
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import { flowerKey } from '@/lib/flowers';
  import { t, type Locale, type MessageKey } from '@/lib/i18n';
  import { createBrowserCodec, processAvatar } from '@/lib/photos';
  import { AVATAR_PRESETS, type Flower } from '@/lib/settings';
  import AvatarBadge from './AvatarBadge.svelte';
  import { avatarErrorKey, type Status } from './messages';
  import { choosePresetAvatar, clearAvatar, prefs, uploadAvatar } from './prefs.svelte';

  let { locale }: { locale: Locale } = $props();
  const uid = $props.id();
  const id = (name: string) => `${uid}-${name}`;

  let busy = $state(false);
  let processing = $state(false);
  let status = $state<Status | null>(null);
  let fileEl = $state<HTMLInputElement>();
  let uploadEl = $state<HTMLButtonElement>();

  const avatar = $derived(prefs.settings.avatar);
  const flowerName = (f: Flower) => t(locale, flowerKey(f, 'name') as MessageKey);

  async function run(task: () => Promise<void>) {
    if (busy) return; // un cambio de avatar cada vez
    busy = true;
    status = null;
    try {
      await task();
      status = { kind: 'ok', key: 'settings.avatar.saved' };
    } catch (error) {
      status = { kind: 'error', key: avatarErrorKey(error) };
    } finally {
      busy = false;
      processing = false;
    }
  }

  function pick(flower: Flower) {
    if (avatar?.kind === 'preset' && avatar.id === flower) return;
    void run(() => choosePresetAvatar(flower));
  }

  async function remove() {
    await run(clearAvatar);
    // El botón «Quitar» desaparece: el foco no se pierde, pasa a «Subir una foto».
    if (prefs.settings.avatar === null) uploadEl?.focus();
  }

  function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    void run(async () => {
      processing = true;
      // Tipo real, decodificar, JPEG nuevo sin metadatos y ≤ 256 px; se cifra al subir (lib/settings).
      const out = await processAvatar(file, createBrowserCodec());
      await uploadAvatar(out.bytes);
    });
  }
</script>

<section class="st-card" aria-labelledby={id('title')}>
  <h2 id={id('title')}>{t(locale, 'settings.avatar.title')}</h2>
  <div class="st-avatar-row">
    <span class="st-avatar-big"><AvatarBadge size="big" /></span>
    <div class="ac-actions">
      <button
        bind:this={uploadEl}
        type="button"
        class="ac-btn ac-btn-secondary"
        aria-describedby={id('upload-hint')}
        aria-disabled={busy ? 'true' : undefined}
        onclick={() => {
          if (!busy) fileEl?.click();
        }}
      >
        {processing ? t(locale, 'settings.avatar.processing') : t(locale, 'settings.avatar.upload')}
      </button>
      {#if avatar !== null}
        <button
          type="button"
          class="ac-btn ac-btn-link"
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => void remove()}
        >
          {t(locale, 'settings.avatar.remove')}
        </button>
      {/if}
    </div>
  </div>
  <p class="ac-hint" id={id('upload-hint')}>{t(locale, 'settings.avatar.upload.hint')}</p>
  <input
    bind:this={fileEl}
    type="file"
    accept="image/jpeg,image/png,image/webp"
    hidden
    onchange={onFile}
  />

  <fieldset class="st-fieldset">
    <legend>{t(locale, 'settings.avatar.presets')}</legend>
    <div class="st-presets">
      {#each AVATAR_PRESETS as flower (flower)}
        <button
          type="button"
          class="st-preset"
          aria-pressed={avatar?.kind === 'preset' && avatar.id === flower}
          aria-label={t(locale, 'settings.avatar.preset', { flower: flowerName(flower) })}
          aria-disabled={busy ? 'true' : undefined}
          onclick={() => pick(flower)}
        >
          <span class="st-preset-mark"><FlowerMark {flower} /></span>
        </button>
      {/each}
    </div>
  </fieldset>

  <p
    class="st-status"
    class:ok={status?.kind === 'ok'}
    class:error={status?.kind === 'error'}
    role="status"
  >
    {status ? t(locale, status.key) : ''}
  </p>
</section>
