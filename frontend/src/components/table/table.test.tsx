// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/table/
import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

function Example() {
  return (
    <Table label="Monthly spending">
      <TableCaption>Monthly spending</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead sticky>Month</TableHead>
          <TableHead numeric>Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableHead scope="row" sticky>
            October
          </TableHead>
          <TableCell numeric>1,200</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>November</TableCell>
          <TableCell numeric>980</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

test('it is a named table with column and row headers', () => {
  render(<Example />);
  const table = screen.getByRole('table', { name: 'Monthly spending' });
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((c) => c.textContent),
  ).toEqual(['Month', 'Amount']);
  expect(within(table).getByRole('rowheader', { name: 'October' })).toHaveAttribute('scope', 'row');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

test('the wrapper is a labelled region that the keyboard can focus and that scrolls sideways', () => {
  render(<Example />);
  const region = screen.getByRole('region', { name: 'Monthly spending' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toHaveClass('overflow-x-auto');
  region.focus();
  expect(region).toHaveFocus();
});

test('numeric cells line up on the right with tabular digits, text cells on the left', () => {
  render(<Example />);
  expect(screen.getByRole('cell', { name: '1,200' })).toHaveClass('text-right', 'tabular-nums');
  expect(screen.getByRole('cell', { name: 'November' })).toHaveClass('text-left');
  expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveClass('text-right');
});

test('a sticky cell stays at the left edge and keeps the card background', () => {
  render(<Example />);
  expect(screen.getByRole('columnheader', { name: 'Month' })).toHaveClass(
    'sticky',
    'left-0',
    'bg-card',
  );
});

test('the caption can be visually hidden but still names the table', () => {
  render(
    <Table label="Totals">
      <TableCaption className="sr-only">Totals</TableCaption>
      <TableBody>
        <TableRow>
          <TableCell>1</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
  expect(screen.getByRole('table', { name: 'Totals' })).toBeInTheDocument();
});

test('extra props and classes reach the table and the wrapper', () => {
  render(
    <Table label="Totals" className="min-w-[40rem]" wrapperClassName="mt-4" data-testid="t">
      <TableBody />
    </Table>,
  );
  expect(screen.getByTestId('t')).toHaveClass('min-w-[40rem]', 'w-full');
  expect(screen.getByRole('region', { name: 'Totals' })).toHaveClass('mt-4');
});
