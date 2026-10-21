// @ts-check
/**
 * Rutas que solo existen con `astro dev` (D-049, PS-06).
 * Viven fuera de src/pages para que su código no entre en la compilación de producción.
 * @returns {import('astro').AstroIntegration}
 */
export function devRoutes() {
  return {
    name: 'memory-garden-dev-routes',
    hooks: {
      'astro:config:setup': ({ command, injectRoute, logger }) => {
        if (command !== 'dev') return;
        injectRoute({
          pattern: '/dev/componentes',
          entrypoint: './src/dev/componentes.astro',
        });
        logger.info('Ruta /dev/componentes inyectada (solo desarrollo).');
      },
    },
  };
}
