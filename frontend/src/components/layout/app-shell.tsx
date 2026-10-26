// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/layout/에서
import { MenuIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { Link, NavLink } from 'react-router';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { ThemeToggle } from './theme-toggle';

// The common app frame (docs/layout.md): top bar, main menu (LNB), content and footer.
// From md (768px) the menu is a fixed sidebar; below it opens as a sheet from the left.
// Only the app name differs between apps; menu items come from the app's own page list.

export type NavItem = { to: string; label: string; icon?: LucideIcon; end?: boolean };

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-1 p-2">
      {items.map(({ to, label, icon: Icon, end }) => (
        <li key={to}>
          <NavLink
            to={to}
            end={end ?? to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex min-h-9 items-center gap-3 rounded-md px-3 text-body-sm outline-none pointer-coarse:min-h-11 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50',
                isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )
            }
          >
            {Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function AppShell({
  appName,
  nav,
  actions,
  footer,
  children,
}: {
  appName: string;
  nav: NavItem[];
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div data-slot="app-shell" className="min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-[var(--z-toast)] rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-[calc(env(safe-area-inset-top)+0.5rem)] focus:left-2"
      >
        본문으로 건너뛰기
      </a>
      <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center gap-2 pr-[max(env(safe-area-inset-right),0.5rem)] pl-[max(env(safe-area-inset-left),0.5rem)] md:px-4">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="메뉴 열기">
                <MenuIcon aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="border-b">
                <SheetTitle>{appName}</SheetTitle>
                <SheetDescription className="sr-only">주 메뉴</SheetDescription>
              </SheetHeader>
              <nav aria-label="주 메뉴" className="overflow-y-auto">
                <NavList items={nav} onNavigate={() => setMenuOpen(false)} />
              </nav>
            </SheetContent>
          </Sheet>
          <Link
            to="/"
            className="flex min-h-11 items-center truncate rounded-md px-2 font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {appName}
          </Link>
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r bg-sidebar text-sidebar-foreground md:block">
          <nav aria-label="주 메뉴">
            <NavList items={nav} />
          </nav>
        </aside>
        <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col">
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-[max(var(--page-x),env(safe-area-inset-left))] py-6 outline-none"
          >
            {children}
          </main>
          <footer className="border-t px-[var(--page-x)] pt-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-caption text-muted-foreground">
            {footer ?? appName}
          </footer>
        </div>
      </div>
    </div>
  );
}

export { AppShell };
