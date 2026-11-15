import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { EntryCsv } from './entry-csv';

type Sent = { url: string; body: { rows: { line: number }[]; skipDuplicates?: boolean } };
let sent: Sent[];
let answers: Record<string, () => Promise<Response>>;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const filters = {
  from: '2026-11-01',
  to: '2026-11-30',
  kind: '',
  category: '',
  q: '',
  page: 1,
} as const;
const previewPath = '/api/ledger/entries/csv/preview';
const importPath = '/api/ledger/entries/csv/import';

beforeEach(() => {
  sent = [];
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      sent.push({ url, body: JSON.parse(init.body as string) as Sent['body'] });
      return answers[url]();
    }),
  );
});

const show = (onImported = vi.fn()) => {
  render(<EntryCsv filters={{ ...filters }} onImported={onImported} />);
  return onImported;
};

const choose = async (text: string, name = 'card.csv') => {
  const file = new File([text], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('CSV file to import'), { target: { files: [file] } });
  return screen.findByRole('group', { name: new RegExp(`Columns of ${name}`) });
};

const statement =
  '이용일자,가맹점명,이용금액\n2026.11.05,스타벅스,"4,500"\n2026.11.06,이마트,32000\n';

const checked = async (preview: unknown) => {
  answers[previewPath] = () => json(preview);
  fireEvent.click(screen.getByRole('button', { name: 'Check the rows' }));
  return screen.findByRole('heading', { level: 4 });
};

test('the download link follows the filters', () => {
  show();
  expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
    'href',
    '/api/ledger/entries/csv?from=2026-11-01&to=2026-11-30',
  );
});

test('a statement is mapped, checked, and imported with duplicates skipped', async () => {
  const onImported = show();
  await choose(statement);
  expect(screen.getByLabelText('Date')).toHaveDisplayValue('이용일자');
  expect(screen.getByLabelText('Amount')).toHaveDisplayValue('이용금액');
  expect(screen.getByLabelText('Kind (optional)')).toHaveDisplayValue(
    'None: the same kind for every row',
  );
  expect(screen.getByLabelText('Kind of every row')).toHaveDisplayValue('Expense');

  const heading = await checked({ rows: 2, valid: 2, problems: [], duplicates: [3] });
  expect(heading).toHaveTextContent('All 2 rows can be imported');
  expect(heading).toHaveFocus();
  expect(sent[0].body.rows).toEqual([
    {
      line: 2,
      date: '2026-11-05',
      kind: 'expense',
      amount: '4500',
      category: '',
      merchant: '스타벅스',
      memo: '',
    },
    {
      line: 3,
      date: '2026-11-06',
      kind: 'expense',
      amount: '32000',
      category: '',
      merchant: '이마트',
      memo: '',
    },
  ]);
  expect(screen.getByText(/1 rows look like entries you already have/)).toHaveTextContent('row 3');
  expect(screen.getByRole('checkbox', { name: 'Skip these rows' })).toBeChecked();

  answers[importPath] = () => json({ imported: 1, skipped: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 entries' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Imported 1 entries and skipped 1 likely duplicates',
  );
  expect(sent[1].body.skipDuplicates).toBe(true);
  expect(onImported).toHaveBeenCalledOnce();
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(screen.getByLabelText('CSV file to import')).toHaveFocus();
});

test('keeping the duplicates imports them too', async () => {
  show();
  await choose(statement);
  await checked({ rows: 2, valid: 2, problems: [], duplicates: [3] });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Skip these rows' }));
  answers[importPath] = () => json({ imported: 2, skipped: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 entries' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Imported 2 entries');
  expect(sent[1].body.skipDuplicates).toBe(false);
});

test('bad rows are listed by row number and nothing can be imported', async () => {
  show();
  await choose(statement);
  const heading = await checked({
    rows: 2,
    valid: 1,
    problems: [{ line: 3, message: 'Amount "x" is not a whole number' }],
    duplicates: [],
  });
  expect(heading).toHaveTextContent('1 of 2 rows cannot be imported');
  const list = screen.getByRole('list', { name: 'Rows that cannot be imported' });
  expect(within(list).getByRole('listitem')).toHaveTextContent(
    'Row 3: Amount "x" is not a whole number',
  );
  expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
});

test('changing a column asks for a new check', async () => {
  show();
  await choose(statement);
  await checked({ rows: 2, valid: 2, problems: [], duplicates: [] });
  expect(screen.getByRole('button', { name: 'Import 2 entries' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: '1' } });
  expect(screen.queryByRole('button', { name: 'Import 2 entries' })).not.toBeInTheDocument();
});

test('a file without a date or amount column cannot be checked', async () => {
  show();
  await choose('when,how much\n2026-11-01,1\n');
  fireEvent.click(screen.getByRole('button', { name: 'Check the rows' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Choose the column for Date and Amount',
  );
  expect(sent).toHaveLength(0);
});

test('a file that is not UTF-8, empty, or too long is refused before sending', async () => {
  show();
  const refuse = async (text: string, message: string) => {
    fireEvent.change(screen.getByLabelText('CSV file to import'), {
      target: { files: [new File([text], 'x.csv')] },
    });
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
  };
  await refuse(`date${String.fromCharCode(0xfffd)}\n1\n`, 'This file is not UTF-8');
  await refuse('date,amount\n', 'The file has no rows under its header');
  await refuse(
    `date,amount\n${'2026-11-01,1\n'.repeat(2001)}`,
    'The file has 2001 rows. Import at most 2000',
  );
  expect(screen.queryByRole('group')).not.toBeInTheDocument();
  expect(sent).toHaveLength(0);
});

test('a refused import says nothing was saved and asks for a new check', async () => {
  const onImported = show();
  await choose(statement);
  await checked({ rows: 2, valid: 2, problems: [], duplicates: [] });
  answers[importPath] = () =>
    json({ error: '1 row(s) cannot be imported. Nothing was saved', problems: [] }, 422);
  fireEvent.click(screen.getByRole('button', { name: 'Import 2 entries' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved');
  expect(screen.queryByRole('button', { name: 'Import 2 entries' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check the rows' })).toBeInTheDocument();
  expect(onImported).not.toHaveBeenCalled();
});
