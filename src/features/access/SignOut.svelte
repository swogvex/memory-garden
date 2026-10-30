<script lang="ts">
  import { t, type Locale } from '@/lib/i18n';
  import { createAuthClient } from './auth-client';
  import { lockSession } from './session';

  let { locale }: { locale: Locale } = $props();
  let busy = $state(false);

  /** Cierra la sesión en el servidor, suelta las claves y recarga la página completa para liberar la memoria (crypto-spec §8.7). */
  async function signOut() {
    busy = true;
    await createAuthClient().logout();
    lockSession();
    window.location.reload();
  }
</script>

<button type="button" class="ac-btn ac-btn-secondary" onclick={signOut} disabled={busy}>
  {busy ? t(locale, 'shell.signout.working') : t(locale, 'shell.signout')}
</button>
