import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { BackupSettings } from './backup';
import { findLive } from './test/live';
import { renderWithQuery } from './test/query';

let requests: { method: string; url: string; body: unknown }[];
let answer: () => Response;

beforeEach(() => {
  requests = [];
  answer = () => new Response(JSON.stringify({ restored: { ledger_entries: 2 }, total: 1234 }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      requests.push({
        method: init.method ?? 'GET',
        url,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      return Promise.resolve(answer());
    }),
  );
});

const notice = () => document.getElementById('backup-notice')!;
const file = (text: string, name = 'backup.json') =>
  new File([text], name, { type: 'application/json' });
const choose = (chosen: File) =>
  fireEvent.change(screen.getByLabelText('Restore from a backup file'), {
    target: { files: [chosen] },
  });

test('offers the download as a link to the backup file', () => {
  renderWithQuery(<BackupSettings />);
  expect(screen.getByRole('link', { name: 'Download backup' })).toHaveAttribute(
    'href',
    '/api/backup',
  );
  expect(screen.getByText(/only works in an empty database/)).toBeInTheDocument();
});

test('sends the chosen file to the restore route and reports the rows restored', async () => {
  renderWithQuery(<BackupSettings />);
  choose(file(JSON.stringify({ app: 'money-ledger', format: 1, tables: {} })));
  expect(await findLive('status', notice())).toHaveTextContent(
    'Restored 1,234 rows from backup.json',
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    method: 'POST',
    url: '/api/backup/restore',
    body: { app: 'money-ledger', format: 1, tables: {} },
  });
});

test('says so when the database already has data, and the file can be chosen again', async () => {
  answer = () =>
    new Response(JSON.stringify({ error: 'The database already has data (ledger_entries).' }), {
      status: 409,
    });
  renderWithQuery(<BackupSettings />);
  choose(file('{"app":"money-ledger"}'));
  expect(await findLive('alert', notice())).toHaveTextContent('The database already has data');
  await waitFor(() =>
    expect(screen.getByLabelText('Restore from a backup file')).not.toBeDisabled(),
  );
  expect(screen.getByLabelText<HTMLInputElement>('Restore from a backup file').value).toBe('');
});

test('a file that is not JSON is refused without a request', async () => {
  renderWithQuery(<BackupSettings />);
  choose(file('not json at all', 'notes.txt'));
  expect(await findLive('alert', notice())).toHaveTextContent('not a backup file');
  expect(requests).toHaveLength(0);
  expect(within(notice()).queryByRole('status')).toHaveTextContent('');
});
