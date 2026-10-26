// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/ui/에서
import type * as React from 'react';
import { useSyncExternalStore } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// The theme follows <html class="light|dark">, or the system setting when there is no class (docs/design-system.md).
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function currentTheme(): ToasterProps['theme'] {
  const html = document.documentElement.classList;
  return html.contains('dark') ? 'dark' : html.contains('light') ? 'light' : 'system';
}

function Toaster(props: ToasterProps) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'system' as const);
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="top-center"
      containerAriaLabel="알림"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          zIndex: 'var(--z-toast)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
export { toast } from 'sonner';
