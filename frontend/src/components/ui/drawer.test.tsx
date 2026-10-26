// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
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
        <Button>단위 선택</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>단위</DrawerTitle>
          <DrawerDescription>중량 단위를 고릅니다.</DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">닫기</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>,
  );
  fireEvent.click(screen.getByRole('button', { name: '단위 선택' }));
  const drawer = screen.getByRole('dialog', { name: '단위' });
  expect(drawer).toHaveAccessibleDescription('중량 단위를 고릅니다.');
  // Focus moves inside, unlike vaul's default (see drawer.tsx).
  expect(drawer).toContainElement(document.activeElement as HTMLElement);
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('dialog', { name: '단위' })).toBeNull();
});
