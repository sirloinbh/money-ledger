// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/ui/
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, expect, test } from 'vitest';

import { Button } from './button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from './drawer';

// jsdom has no matchMedia, which vaul reads.
beforeAll(() => {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

test('a drawer opens as a named dialog and its close button closes it', () => {
  render(
    <Drawer>
      <DrawerTrigger asChild>
        <Button>Choose unit</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Unit</DrawerTitle>
          <DrawerDescription>Choose a weight unit.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose unit' }));
  const drawer = screen.getByRole('dialog', { name: 'Unit' });
  expect(drawer).toHaveAccessibleDescription('Choose a weight unit.');
  // Focus moves inside, unlike vaul's default (see drawer.tsx).
  expect(drawer).toContainElement(document.activeElement as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Unit' })).toBeNull();
});
