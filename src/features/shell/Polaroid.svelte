<script lang="ts">
  import type { MemoryPayload } from '@/lib/validation';
  import FlowerMark from './FlowerMark.svelte';

  let { flower }: { flower: MemoryPayload['flower'] } = $props();
</script>

<span class="polaroid" aria-hidden="true">
  <span class="photo"><FlowerMark {flower} /></span>
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
    aspect-ratio: 1 / 1;
    background: var(--color-surface);
  }
</style>
