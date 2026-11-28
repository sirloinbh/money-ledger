// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list-toolbar/
import type * as React from 'react';
import { useId } from 'react';

import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { NativeSelect } from '../ui/native-select';

type ListToolbarOption = { value: string; label: string };

type ListToolbarSelect = {
  /** The visible label above the select. */
  label: string;
  value: string;
  options: ListToolbarOption[];
  onChange: (value: string) => void;
};

type ListToolbarFilter = ListToolbarSelect & {
  /** The value that means "no filter" (default ''). It does not count as an active filter. */
  allValue?: string;
};

// The bar above a list: search, filters, sort, a Reset button and the result count. It is controlled: the page owns
// the values (usually in the URL, see list-query.ts) and filters its own rows, as a table or as cards. The count is a
// polite live region that stays in the page, so a screen reader hears "12 results" after each change. Reset shows
// only while something differs from the default, calls `onReset` (the page clears its state there) and moves focus
// to the search field.
function ListToolbar({
  search,
  filters = [],
  sort,
  resultCount,
  resultText = (count) => (count === 1 ? '1 result' : `${count} results`),
  onReset,
  resetLabel = 'Reset',
  active,
  className,
  ...props
}: Omit<React.ComponentProps<'form'>, 'onReset'> & {
  search?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  filters?: ListToolbarFilter[];
  sort?: ListToolbarSelect;
  /** The number of rows after filtering. Leave it out while loading: no count is announced. */
  resultCount?: number;
  resultText?: (count: number) => string;
  onReset?: () => void;
  resetLabel?: string;
  /** Overrides the default test for "something differs from the default". */
  active?: boolean;
}) {
  const id = useId();
  const searchId = `${id}-search`;
  const changed =
    active ??
    ((search?.value.trim() ?? '') !== '' ||
      filters.some((filter) => filter.value !== (filter.allValue ?? '')));
  return (
    <form
      role="search"
      data-slot="list-toolbar"
      className={cn('flex flex-col gap-3', className)}
      onSubmit={(event) => event.preventDefault()}
      {...props}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {search ? (
          <div className="flex min-w-0 flex-col gap-1.5 sm:min-w-56 sm:flex-1">
            <label htmlFor={searchId} className="text-body-sm font-medium">
              {search.label}
            </label>
            <Input
              id={searchId}
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              value={search.value}
              placeholder={search.placeholder}
              onChange={(event) => search.onChange(event.target.value)}
            />
          </div>
        ) : null}
        {filters.map((filter) => (
          <ToolbarSelect key={filter.label} select={filter} />
        ))}
        {sort ? <ToolbarSelect select={sort} /> : null}
        {onReset && changed ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onReset();
              document.getElementById(searchId)?.focus();
            }}
          >
            {resetLabel}
          </Button>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-5 text-body-sm text-muted-foreground">
        {resultCount === undefined ? '' : resultText(resultCount)}
      </p>
    </form>
  );
}

function ToolbarSelect({ select }: { select: ListToolbarSelect }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:w-44">
      <label htmlFor={id} className="text-body-sm font-medium">
        {select.label}
      </label>
      <NativeSelect
        id={id}
        value={select.value}
        onChange={(event) => select.onChange(event.target.value)}
      >
        {select.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export { ListToolbar, type ListToolbarFilter, type ListToolbarOption, type ListToolbarSelect };
