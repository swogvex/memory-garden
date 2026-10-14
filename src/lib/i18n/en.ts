import type { MessageKey } from './es';

// Parcial a propósito: se completa en H8. Lo que falte cae al español.
export const en: Partial<Record<MessageKey, string>> = {
  'app.tagline': 'Small moments, big flowers.',
  'a11y.skipToContent': 'Skip to content',
  'nav.label': 'Main navigation',
  'nav.garden': 'Garden',
  'nav.bouquets': 'Bouquets',
  'nav.explore': 'Explore',
  'nav.settings': 'Settings',
  'dev.title': 'Components',
  'dev.heading': 'Tokens and typography',
  'dev.sample': 'Every memory is a flower.',
  'dev.greeting': 'Hello, {name}.',
};
