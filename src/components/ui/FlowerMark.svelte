<script lang="ts">
  import { SPRITE_VIEWBOX, spriteHref } from '@/lib/flowers';
  import type { MemoryPayload } from '@/lib/validation';

  // Requiere <FlowerSprite /> montado una vez en la página (AppShell).
  let { flower }: { flower: MemoryPayload['flower'] } = $props();
</script>

<svg class="mark" viewBox={SPRITE_VIEWBOX} aria-hidden="true" focusable="false">
  <use href={spriteHref(flower)} />
</svg>

<style>
  .mark {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
