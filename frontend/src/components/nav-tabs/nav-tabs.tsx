// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/nav-tabs/
import { NavLink } from 'react-router';

import { cn } from '../../lib/utils';

type NavTabItem = { to: string; label: string; end?: boolean };

// Tabs that are pages: each one is a link to a route, and the link of the current page gets aria-current="page"
// (NavLink sets it). Use it for the sections of one area, such as the categories of a list. It is a navigation
// landmark, so give it a name with `label`. At 360px the row scrolls sideways instead of wrapping. To switch a view
// that is not a route, use SegmentedControl instead.
function NavTabs({
  label,
  items,
  className,
}: {
  label: string;
  items: NavTabItem[];
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      data-slot="nav-tabs"
      className={cn('max-w-full overflow-x-auto border-b border-border', className)}
    >
      <ul className="flex w-max min-w-full gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px inline-flex min-h-11 cursor-pointer items-center border-b-2 px-4 text-body-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-12',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { type NavTabItem, NavTabs };
