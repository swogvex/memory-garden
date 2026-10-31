import type { Action } from 'svelte/action';

/**
 * Acción de Svelte para zonas con desplazamiento propio (tarjeta de acceso, cuerpo de un recuerdo).
 *
 * Una zona que se desplaza tiene que poder alcanzarse con el teclado para moverla con las flechas
 * (WCAG 2.1.1; axe `scrollable-region-focusable`). Mientras su contenido no cabe, la acción le pone
 * `tabindex="0"`, `role="region"` y `aria-labelledby` (el id del título que la nombra); cuando vuelve a caber,
 * los quita, para no dejar una parada de Tab vacía. Vigila el tamaño de la zona y de sus hijos directos.
 */
export const scrollRegion: Action<HTMLElement, string | undefined> = (node, labelledBy) => {
  let label = labelledBy;
  const update = () => {
    if (node.scrollHeight > node.clientHeight + 1) {
      node.tabIndex = 0;
      node.setAttribute('role', 'region');
      if (label) node.setAttribute('aria-labelledby', label);
      else node.removeAttribute('aria-labelledby');
    } else {
      node.removeAttribute('tabindex');
      node.removeAttribute('role');
      node.removeAttribute('aria-labelledby');
    }
  };
  const sizes = new ResizeObserver(update);
  const watchChildren = () => {
    for (const child of Array.from(node.children)) sizes.observe(child);
  };
  // Cambia el paso del asistente o aparece la confirmación: hijos nuevos que vigilar.
  const children = new MutationObserver(() => {
    watchChildren();
    update();
  });
  sizes.observe(node);
  watchChildren();
  children.observe(node, { childList: true });
  update();
  return {
    update(next) {
      label = next;
      update();
    },
    destroy() {
      sizes.disconnect();
      children.disconnect();
    },
  };
};
