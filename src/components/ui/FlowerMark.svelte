<script lang="ts">
  import type { MemoryPayload } from '@/lib/validation';

  let { flower }: { flower: MemoryPayload['flower'] } = $props();
  const ANGLES = [0, 72, 144, 216, 288];
</script>

<svg
  class="mark"
  data-flower={flower}
  viewBox="0 0 24 24"
  width="24"
  height="24"
  aria-hidden="true"
  focusable="false"
>
  {#each ANGLES as angle (angle)}
    <ellipse class="petal" cx="12" cy="6.5" rx="3.6" ry="5" transform="rotate({angle} 12 12)" />
  {/each}
  <circle class="core" cx="12" cy="12" r="2.6" />
</svg>

<style>
  .mark {
    display: block;
    width: 100%;
    height: 100%;
    --petal: #b8a0d9;
    --core: #f2d98b;
  }
  .petal {
    fill: var(--petal);
    stroke: rgb(55 49 63 / 30%);
    stroke-width: 0.5;
  }
  .core {
    fill: var(--core);
  }
  [data-flower='lavanda'] {
    --petal: #b8a0d9;
  }
  [data-flower='hortensia'] {
    --petal: #8fb0e3;
  }
  [data-flower='margarita'] {
    --petal: #fbf8f0;
  }
  [data-flower='rosa'] {
    --petal: #e58fa4;
  }
  [data-flower='tulipan'] {
    --petal: #f2a05a;
  }
  [data-flower='girasol'] {
    --petal: #f2c94c;
    --core: #7a4b2a;
  }
  [data-flower='dalia'] {
    --petal: #d9708f;
  }
  [data-flower='camelia'] {
    --petal: #f4b8c8;
  }
</style>
