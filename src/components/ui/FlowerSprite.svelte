<script lang="ts">
  import { renderFlowerSprite } from '@/lib/flowers';
  import { mountSvg } from '@/lib/svg-mount';

  // Texto estático generado por nuestro código (sin datos del usuario). Se monta una sola vez en la página.
  const markup = renderFlowerSprite();
</script>

<div class="sprite" aria-hidden="true" use:mountSvg={markup}></div>

<style>
  .sprite {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }
</style>
