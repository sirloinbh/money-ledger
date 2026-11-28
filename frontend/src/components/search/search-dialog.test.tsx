// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/search/
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HomeIcon, NotebookPenIcon } from 'lucide-react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';

import { AppShell, type NavItem } from '../layout/app-shell';
import type { SearchResult } from './search-match';

const nav: NavItem[] = [
  { to: '/', label: 'Overview', icon: HomeIcon },
  { to: '/journal', label: 'Journal', icon: NotebookPenIcon },
];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderShell(props: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AppShell appName="Sample App" nav={nav} {...props}>
        <Where />
      </AppShell>
    </MemoryRouter>,
  );
}

const searchBox = () => screen.getByRole('combobox', { name: 'Search this app' });

afterEach(() => {
  vi.useRealTimers();
});

test('the top bar button opens the search and Escape closes it and returns focus', async () => {
  renderShell();
  const button = screen.getByRole('button', { name: 'Search this app' });
  button.focus();
  fireEvent.click(button);
  expect(searchBox()).toBeInTheDocument();
  fireEvent.keyDown(searchBox(), { key: 'Escape' });
  expect(screen.queryByRole('combobox', { name: 'Search this app' })).toBeNull();
  await waitFor(() => expect(button).toHaveFocus());
});

test('Ctrl+K and Cmd+K open it, and "/" opens it except while typing in a field', () => {
  renderShell({ actions: <input aria-label="Notes" /> });
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
  expect(searchBox()).toBeInTheDocument();
  fireEvent.keyDown(searchBox(), { key: 'Escape' });
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  expect(searchBox()).toBeInTheDocument();
  fireEvent.keyDown(searchBox(), { key: 'Escape' });

  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Notes' }), { key: '/' });
  expect(screen.queryByRole('combobox', { name: 'Search this app' })).toBeNull();
  fireEvent.keyDown(document.body, { key: '/' });
  expect(searchBox()).toBeInTheDocument();
});

test('an app without pages or searchContent still searches its menus', () => {
  renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'jour' } });
  const list = screen.getByRole('listbox', { name: 'Search results' });
  expect(list).toHaveTextContent('Journal');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.getByRole('group', { name: 'Menus' })).toBeInTheDocument();
});

test('a page that is not in the menu is found by its title or keyword', () => {
  renderShell({
    pages: [{ title: 'Backup', path: '/settings/backup', keywords: ['export', 'download'] }],
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'export' } });
  expect(screen.getByRole('group', { name: 'Pages' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Backup' })).toBeInTheDocument();
});

test('arrows move, Enter opens the result and closes the search, and the count is announced', () => {
  renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'o' } });
  const options = screen.getAllByRole('option');
  expect(options).toHaveLength(2);
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent('2 results');
  expect(searchBox()).toHaveAttribute('aria-activedescendant', options[0].id);
  fireEvent.keyDown(searchBox(), { key: 'ArrowDown' });
  expect(options[1]).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(searchBox(), { key: 'Enter' });
  expect(screen.getByTestId('where')).toHaveTextContent('/journal');
  expect(screen.queryByRole('combobox', { name: 'Search this app' })).toBeNull();
});

test('content results come from searchContent after a pause, with the query and an abort signal', async () => {
  vi.useFakeTimers();
  const results: SearchResult[] = [
    { title: 'Bench press log', href: '/journal/42', kind: 'content', snippet: 'Heavy day' },
  ];
  const searchContent = vi.fn((query: string, signal: AbortSignal) => {
    void query;
    void signal;
    return Promise.resolve(results);
  });
  renderShell({ searchContent });
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'bench' } });
  expect(searchContent).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(searchContent).toHaveBeenCalledTimes(1);
  expect(searchContent.mock.calls[0][0]).toBe('bench');
  expect(searchContent.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  expect(screen.getByRole('group', { name: 'Content' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Bench press log/ })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent('1 result');
  fireEvent.click(screen.getByRole('option', { name: /Bench press log/ }));
  expect(screen.getByTestId('where')).toHaveTextContent('/journal/42');
});

test('a new query aborts the previous content request', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const searchContent = vi.fn((_query: string, signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<SearchResult[]>(() => {});
  });
  renderShell({ searchContent });
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'a' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByRole('status', { name: 'Searching content' })).toBeInTheDocument();
  fireEvent.change(searchBox(), { target: { value: 'ab' } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(signals).toHaveLength(2);
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
});

test('a failed content search shows a retry that asks again', async () => {
  let calls = 0;
  const searchContent = vi.fn(() => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve<SearchResult[]>([]);
  });
  renderShell({ searchContent });
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'zzz' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }, { timeout: 2000 }));
  await waitFor(() => expect(searchContent).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(/No results for/)).toBeInTheDocument();
});

test('no match says so and announces it', () => {
  renderShell();
  fireEvent.click(screen.getByRole('button', { name: 'Search this app' }));
  fireEvent.change(searchBox(), { target: { value: 'zzz' } });
  expect(screen.getByRole('status', { name: '' })).toHaveTextContent('No results');
  expect(screen.getByText(/No results for/)).toBeInTheDocument();
});
