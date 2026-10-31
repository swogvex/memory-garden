<script lang="ts">
  import type { Locale } from '@/lib/i18n';
  import PasswordChangeCard from './PasswordChangeCard.svelte';
  import RecoveryKeyCard from './RecoveryKeyCard.svelte';

  // Dos tarjetas de Configuración. Viven en `access` porque usan sus flujos y componentes de contraseña y clave.
  let { locale }: { locale: Locale } = $props();
</script>

<PasswordChangeCard {locale} />
<RecoveryKeyCard {locale} />
