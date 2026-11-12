// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
import { expect, test } from 'vitest';

import { cn } from './utils';

test('a text style token keeps its size next to a text colour', () => {
  expect(cn('text-body-sm', 'text-destructive')).toBe('text-body-sm text-destructive');
  expect(cn('text-caption', 'text-muted-foreground')).toBe('text-caption text-muted-foreground');
});

test('a later text style token replaces the earlier one', () => {
  expect(cn('text-body', 'text-caption')).toBe('text-caption');
  expect(cn('text-meta', 'text-sm')).toBe('text-sm');
});

test('a later text colour still replaces the earlier one', () => {
  expect(cn('text-destructive', 'text-muted-foreground')).toBe('text-muted-foreground');
});
