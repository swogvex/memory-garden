<script lang="ts">
  import FlowerMark from '@/components/ui/FlowerMark.svelte';
  import type { MemoryPayload } from '@/lib/validation';

  let { flower, src = null }: { flower: MemoryPayload['flower']; src?: string | null } = $props();
  let broken = $state(false);
  $effect(() => {
    void src;
    broken = false;
  });
</script>

<span class="polaroid" aria-hidden="true">
  <span class="photo">
    {#if src && !broken}
      <img class="img" {src} alt="" onerror={() => (broken = true)} />
    {:else}
      <FlowerMark {flower} />
    {/if}
  </span>
</span>

<style>
  .polaroid {
    position: relative;
    display: block;
    width: 100%;
    padding: 2px 2px 6px;
    background: #fff;
    border-radius: 2px;
    box-shadow: 0 2px 6px rgb(55 49 63 / 16%);
    transform: rotate(-3deg);
  }
  /* Cinta washi (decorativa). */
  .polaroid::before {
    content: '';
    position: absolute;
    z-index: 1;
    top: -10%;
    left: 30%;
    width: 40%;
    height: 16%;
    background: var(--color-tape);
    opacity: 0.8;
    transform: rotate(3deg);
  }
  .photo {
    display: block;
    position: relative;
    width: 100%;
    padding-top: 100%;
    overflow: hidden;
    background: var(--color-surface);
  }
  .photo :global(.mark),
  .img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .img {
    object-fit: cover;
  }
</style>
