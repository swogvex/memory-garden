/**
 * Monta un SVG generado por nuestro propio código sin `{@html}`: se analiza como XML y se importa como nodo.
 * Si el texto no es un SVG bien formado, deja el contenedor vacío (nunca ejecuta nada).
 */
function parseSvg(markup: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root.localName !== 'svg') return null;
  return document.importNode(root, true) as unknown as SVGElement;
}

/** Acción de Svelte: `<div use:mountSvg={markup}>`. */
export function mountSvg(node: Element, markup: string) {
  const apply = (next: string) => {
    const svg = parseSvg(next);
    if (svg) node.replaceChildren(svg);
    else node.replaceChildren();
  };
  apply(markup);
  return {
    update: apply,
    destroy: () => node.replaceChildren(),
  };
}
