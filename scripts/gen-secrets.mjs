// Genera PEPPER y SETUP_CODE (D-160) con el generador criptográfico del sistema.
//   npm run gen-secrets            -> los imprime (para producción: pégalos en `wrangler secret put`)
//   npm run gen-secrets -- --dev   -> crea `.dev.vars` local si NO existe (nunca sobrescribe)
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

// Sin I, L, O, U (se confunden con 1, 0 o V al leerlos); el servidor normaliza O→0 e I/L→1.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const pepper = randomBytes(32).toString('base64url');
const groups = Array.from({ length: 5 }, () =>
  Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
);
const setupCode = groups.join('-');

if (process.argv.includes('--dev')) {
  if (existsSync('.dev.vars')) {
    console.error('.dev.vars ya existe: no lo toco. Bórralo tú si quieres regenerarlo.');
    process.exit(1);
  }
  writeFileSync('.dev.vars', `MG_ENV=local\nPEPPER=${pepper}\nSETUP_CODE=${setupCode}\n`, {
    flag: 'wx',
  });
  console.log('Creado .dev.vars (Git lo ignora). Código de primer acceso local:', setupCode);
} else {
  console.log('PEPPER     =', pepper);
  console.log('SETUP_CODE =', setupCode);
  console.log(
    '\nProducción: `npx wrangler secret put PEPPER` y `npx wrangler secret put SETUP_CODE` (pega el valor cuando lo pida).',
  );
  console.log(
    'Guarda el PEPPER en tu gestor de contraseñas: si se pierde, nadie podrá iniciar sesión. Limpia el historial de la terminal.',
  );
}
