// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/layout/
import { CheckIcon, LayoutGridIcon } from 'lucide-react';

import { APPS, CURRENT_APP } from '../../lib/apps';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

// The top bar menu that opens another app of the portfolio (#561). The list is rendered
// from the registry at sync time (lib/apps.ts); with fewer than two apps there is nothing to switch to.
function AppSwitcher() {
  if (APPS.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Switch app">
          <LayoutGridIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Apps</DropdownMenuLabel>
        {APPS.map(({ name, label, href }) => {
          const current = name === CURRENT_APP;
          return (
            <DropdownMenuItem key={name} asChild>
              <a href={href} aria-current={current ? 'page' : undefined}>
                <span className="flex-1">{label}</span>
                {current ? <CheckIcon aria-hidden /> : null}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { AppSwitcher };
