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
    display: block;
    width: 100%;
    padding: 2px 2px 6px;
    background: #fff;
    border-radius: 2px;
    box-shadow: var(--shadow-sm);
    transform: rotate(-3deg);
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
