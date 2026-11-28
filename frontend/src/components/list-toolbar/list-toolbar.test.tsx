// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/list-toolbar/
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';

import { ListToolbar } from './list-toolbar';

const status = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
];
const order = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
];

function Demo({ onReset = () => {} }: { onReset?: () => void }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [by, setBy] = useState('newest');
  return (
    <ListToolbar
      search={{ label: 'Search', value: q, onChange: setQ }}
      filters={[{ label: 'Status', value: state, options: status, onChange: setState }]}
      sort={{ label: 'Sort by', value: by, options: order, onChange: setBy }}
      resultCount={12}
      onReset={() => {
        setQ('');
        setState('');
        onReset();
      }}
    />
  );
}

test('every control has a visible label and the form is a search landmark', () => {
  render(<Demo />);
  expect(screen.getByRole('search')).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument();
});

test('typing, filtering and sorting call the page', () => {
  const onSearch = vi.fn();
  const onSort = vi.fn();
  render(
    <ListToolbar
      search={{ label: 'Search', value: '', onChange: onSearch }}
      sort={{ label: 'Sort by', value: 'newest', options: order, onChange: onSort }}
    />,
  );
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bench' } });
  expect(onSearch).toHaveBeenLastCalledWith('bench');
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by' }), {
    target: { value: 'name' },
  });
  expect(onSort).toHaveBeenLastCalledWith('name');
});

test('the result count is a polite live region with the singular form', () => {
  const { rerender } = render(<ListToolbar resultCount={12} />);
  const region = screen.getByRole('status');
  expect(region).toHaveAttribute('aria-live', 'polite');
  expect(region).toHaveTextContent('12 results');
  rerender(<ListToolbar resultCount={1} />);
  expect(screen.getByRole('status')).toHaveTextContent('1 result');
  rerender(<ListToolbar />);
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('Reset shows only while something differs, clears it and returns focus to the search field', () => {
  const onReset = vi.fn();
  render(<Demo onReset={onReset} />);
  expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bench' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(onReset).toHaveBeenCalledOnce();
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
    target: { value: 'done' },
  });
  expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
});

test('submitting the form does not reload the page', () => {
  render(<Demo />);
  expect(fireEvent.submit(screen.getByRole('search'))).toBe(false);
});
