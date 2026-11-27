import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CardImport } from './card-import';

// #57 Card usage file import: choose the file, check it, then import. The server reads the file; here it is faked.
let calls: { method: string; url: string }[];
let preview: unknown;

beforeEach(() => {
  calls = [];
  preview = {
    rows: [
      {
        line: 4,
        date: '2026-01-10',
        merchant: 'Bakery',
        amount: 4500,
        memo: '',
        action: 'new',
        candidate: true,
      },
      {
        line: 5,
        date: '2026-01-11',
        merchant: 'Cafe',
        amount: 3000,
        memo: 'Installment 3 months',
        action: 'new',
        candidate: false,
      },
    ],
    authorizations: 1,
    problems: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url });
      if (url.includes('/preview?')) return Promise.resolve(new Response(JSON.stringify(preview)));
      return Promise.resolve(
        new Response(
          JSON.stringify({ added: 1, updated: 0, removed: 0, unchanged: 0, skipped: 1 }),
        ),
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const choose = (name = 'usage.xls', size = 10) => {
  const file = new File(['x'.repeat(size)], name, { type: 'application/vnd.ms-excel' });
  fireEvent.change(screen.getByLabelText('Usage history file'), { target: { files: [file] } });
};

test('checks the file, flags a likely duplicate, and imports without it by default', async () => {
  const onImported = vi.fn();
  render(<CardImport onImported={onImported} />);
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check the file' }));
  expect(await screen.findByText('1 payment to add, 0 to change')).toBeTruthy();
  expect(screen.getByText(/maybe a duplicate/)).toBeTruthy();
  expect(screen.getByText(/1 card-check authorization with no amount left out/)).toBeTruthy();
  expect(calls[0].url).toBe(
    '/api/ledger/entries/card-import/preview?kind=domestic&paymentMethod=credit_card&skipCandidates=true',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(onImported).toHaveBeenCalled());
  expect(calls[1].url).toBe(
    '/api/ledger/entries/card-import/import?kind=domestic&paymentMethod=credit_card&skipCandidates=true',
  );
  expect(screen.getByText('Imported: added 1 entry, left out 1')).toBeTruthy();
});

test('a file over 5 MB is refused before it is sent, and unreadable rows block the import', async () => {
  render(<CardImport onImported={() => {}} />);
  choose('big.xls', 5_000_001);
  expect(await screen.findByText('The file is larger than 5 MB')).toBeTruthy();
  expect(calls).toHaveLength(0);

  preview = {
    rows: [],
    authorizations: 0,
    problems: [{ line: 7, message: 'The row has no approval number' }],
  };
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Check the file' }));
  expect(await screen.findByText('1 row cannot be read')).toBeTruthy();
  expect(screen.getByText(/The row has no approval number/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
});
