<script lang="ts">
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import { prefs } from './prefs.svelte';

  // Decorativo: quien lo usa le pone el nombre accesible (el enlace de la cabecera dice «Perfil y configuración»).
  let { size = 'small' }: { size?: 'small' | 'big' } = $props();
  const avatar = $derived(prefs.settings.avatar);
</script>

<span class="badge" class:big={size === 'big'} aria-hidden="true">
  {#if prefs.avatarUrl}
    <img class="photo" src={prefs.avatarUrl} alt="" />
  {:else if avatar?.kind === 'preset'}
    <span class="flower"><FlowerMark flower={avatar.id} /></span>
  {:else}
    <svg
      class="default"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      focusable="false"
    >
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="5.5" r="2.5" />
      <circle cx="12" cy="18.5" r="2.5" />
      <circle cx="5.5" cy="12" r="2.5" />
      <circle cx="18.5" cy="12" r="2.5" />
    </svg>
  {/if}
</span>

<style>
  .badge {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--radius-pill);
  }
  .photo {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .flower {
    display: block;
    width: 82%;
    height: 82%;
  }
  .big {
    border: 3px solid #fff;
    background: var(--color-surface-soft);
    box-shadow: var(--shadow-sm);
    color: var(--color-primary);
  }
  .big .default {
    width: 55%;
    height: 55%;
  }
</style>
