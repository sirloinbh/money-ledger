import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';
import { serviceToday } from './format';

// #64 Prepaid assets on the asset screen, against a fake server that keeps the same rules.

type Prepaid = {
  kind: 'amount' | 'period';
  amountKrw: number;
  startsOn: string | null;
  expiresOn: string | null;
};
type Asset = {
  id: number;
  name: string;
  type: string;
  currency: 'KRW';
  quantity: null;
  valueKrw: number | null;
  valueForeign: null;
  memo: string;
  prepaid: Prepaid | null;
};
type Usage = { id: number; usedOn: string; amountKrw: number; memo: string };

let stored: Asset[];
let usages: Record<number, Usage[]>;
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

const usedOf = (id: number) =>
  (usages[id] ?? []).reduce((total, usage) => total + usage.amountKrw, 0);

// The server works out values from the date; the fake: a pass is a third of its price, a stored value is
// what is left after its uses.
const view = (asset: Asset) => ({
  ...asset,
  // #47 fields: no link, no price, no rate unless a test sets them.
  security: null,
  manualPrice: null,
  price: null,
  fx: null,
  currentValueForeign: asset.valueForeign ?? null,
  valueIssue: null,
  costKrw: null,
  profitKrw: null,
  returnPercent: null,
  depreciation: null,
  hasTrades: false,
  prepaid: asset.prepaid ? { ...asset.prepaid, usedKrw: usedOf(asset.id) } : null,
  currentValueKrw: asset.prepaid
    ? asset.prepaid.kind === 'period'
      ? Math.floor(asset.prepaid.amountKrw / 3)
      : asset.prepaid.amountKrw - usedOf(asset.id)
    : asset.valueKrw,
});

function list() {
  const assets = stored.map(view);
  const sum = assets.reduce((total, asset) => total + (asset.currentValueKrw ?? 0), 0);
  return { assets, totals: { assetsKrw: sum, debtsKrw: 0, netKrw: sum, uncounted: 0 } };
}

function usageApi(url: string, method: string, body: unknown) {
  const match = /assets\/(\d+)\/usages(?:\/(\d+))?/.exec(url)!;
  const assetId = Number(match[1]);
  const entries = (usages[assetId] ??= []);
  if (method === 'GET') return json({ usages: [...entries].reverse() });
  if (method === 'DELETE') {
    usages[assetId] = entries.filter((usage) => usage.id !== Number(match[2]));
    return json(undefined, 204);
  }
  const use = body as Omit<Usage, 'id'>;
  const asset = stored.find((item) => item.id === assetId)!;
  const left = asset.prepaid!.amountKrw - usedOf(assetId);
  if (use.amountKrw > left) {
    return json(
      { error: `Cannot use more than the balance (remaining ₩${left.toLocaleString('en-US')})` },
      400,
    );
  }
  const usage = { ...use, id: 100 + entries.length };
  entries.push(usage);
  return json({ usage }, 201);
}

beforeEach(() => {
  stored = [
    {
      id: 1,
      name: 'Emergency fund account',
      type: 'cash',
      currency: 'KRW',
      quantity: null,
      valueKrw: 5000000,
      valueForeign: null,
      memo: '',
      prepaid: null,
    },
  ];
  usages = {};
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as Omit<Asset, 'id'>) : undefined;
      requests.push({ method, url, body });
      if (url.includes('/usages')) return usageApi(url, method, body);
      if (method === 'GET') return json(list());
      const saved = { ...body!, id: stored.length + 10 };
      stored = [...stored, saved];
      return json({ asset: view(saved) }, 201);
    }),
  );
});

const salon: Asset = {
  id: 6,
  name: 'Salon membership',
  type: 'prepaid',
  currency: 'KRW',
  quantity: null,
  valueKrw: null,
  valueForeign: null,
  memo: '',
  prepaid: { kind: 'amount', amountKrw: 300000, startsOn: null, expiresOn: '2026-12-31' },
};

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: 'Cash (incl. savings)' });
};

const summary = (label: string) =>
  within(screen.getByRole('region', { name: 'Totals' })).getByText(label).nextElementSibling;

test('prepaid is its own type and Other no longer mentions it', async () => {
  await ready();
  const options = within(screen.getByLabelText('Type'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).toContain('Prepaid');
  expect(options).toContain('Other (crypto, etc.)');
  expect(options.join()).not.toContain('prepaid');
});

test('a stored-value prepaid asset is sent with its amount and optional expiry', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Salon' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'prepaid' } });
  expect(screen.getByRole('radio', { name: 'Voucher' })).toBeChecked();
  expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Valuation (KRW)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Amount loaded (KRW)'), { target: { value: '300,000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Salon added');
  expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
    name: 'Salon',
    type: 'prepaid',
    currency: 'KRW',
    quantity: null,
    valueKrw: null,
    valueForeign: null,
    memo: '',
    prepaid: { kind: 'amount', amountKrw: 300000, startsOn: null, expiresOn: null },
  });
  expect(
    within(screen.getByRole('list', { name: 'Prepaid' })).getByText(
      'Voucher · loaded ₩300,000 · used ₩0',
    ),
  ).toBeInTheDocument();
  expect(summary('Total assets')).toHaveTextContent('₩5,300,000');
});

test('a period pass needs a start and an expiry no earlier than the start', async () => {
  await ready();
  const expiry = () => screen.getByLabelText('Expiry date (usable through this day)');
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gym' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'prepaid' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Pass' }));
  fireEvent.change(screen.getByLabelText('Amount paid (KRW)'), { target: { value: '270000' } });
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-03-01' } });
  fireEvent.change(expiry(), { target: { value: '2026-02-28' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The expiry date must be on or after the start date',
  );
  expect(expiry()).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);

  fireEvent.change(expiry(), { target: { value: '2026-05-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    prepaid: { kind: 'period', amountKrw: 270000, startsOn: '2026-03-01', expiresOn: '2026-05-31' },
  });
  expect(screen.getByText('Pass · paid ₩270,000 · 2026-03-01~2026-05-31')).toBeInTheDocument();
  // Only a stored value has uses.
  expect(screen.queryByRole('button', { name: 'Gym usage records' })).not.toBeInTheDocument();
});

test('uses lower a stored value, a use above the balance shows the server message, and a use can be removed', async () => {
  stored.push(salon);
  await ready();
  const toggle = screen.getByRole('button', { name: 'Salon membership usage records' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = screen.getByRole('region', { name: 'Salon membership usage records' });
  expect(await within(panel).findByText('No usage records yet.')).toBeInTheDocument();

  fireEvent.change(within(panel).getByLabelText('Date used'), {
    target: { value: '2026-02-01' },
  });
  fireEvent.change(within(panel).getByLabelText('Amount used (KRW)'), {
    target: { value: '50,000' },
  });
  fireEvent.change(within(panel).getByLabelText('Note'), { target: { value: 'Haircut' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add usage' }));
  expect(await within(panel).findByRole('status')).toHaveTextContent('₩50,000 use recorded');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets/6/usages',
    body: { usedOn: '2026-02-01', amountKrw: 50000, memo: 'Haircut' },
  });
  expect(within(panel).getByText('2026-02-01 · Haircut')).toBeInTheDocument();
  // The list and totals follow: 5,000,000 cash + 250,000 left.
  await vi.waitFor(() => expect(summary('Total assets')).toHaveTextContent('₩5,250,000'));
  expect(
    screen.getByText('Voucher · loaded ₩300,000 · used ₩50,000 · expires 2026-12-31'),
  ).toBeInTheDocument();

  fireEvent.change(within(panel).getByLabelText('Amount used (KRW)'), {
    target: { value: '250001' },
  });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add usage' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    'Cannot use more than the balance (remaining ₩250,000)',
  );
  expect(within(panel).getByLabelText('Amount used (KRW)')).toHaveAttribute('aria-invalid', 'true');

  // Deleting asks first.
  fireEvent.click(
    within(panel).getByRole('button', { name: 'Delete usage record 2026-02-01 ₩50,000' }),
  );
  expect(requests.some((request) => request.method === 'DELETE')).toBe(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await within(panel).findByText('No usage records yet.')).toBeInTheDocument();
  await vi.waitFor(() =>
    expect(
      within(panel).getByRole('heading', { name: 'Salon membership usage records' }),
    ).toHaveFocus(),
  );
  await vi.waitFor(() => expect(summary('Total assets')).toHaveTextContent('₩5,300,000'));
});

test('the uses button points at its panel only while it is open', async () => {
  stored.push(salon);
  await ready();
  const toggle = screen.getByRole('button', { name: 'Salon membership usage records' });
  expect(toggle).not.toHaveAttribute('aria-controls');
  fireEvent.click(toggle);
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeInTheDocument();
});

test('a date refused by the server marks the date field, and a date that does not exist is caught first', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Salon membership usage records' }));
  const panel = screen.getByRole('region', { name: 'Salon membership usage records' });
  const date = within(panel).getByLabelText('Date used');
  fireEvent.change(within(panel).getByLabelText('Amount used (KRW)'), {
    target: { value: '1000' },
  });

  // A past date the (fake) server refuses because of the expiry.
  vi.mocked(fetch).mockImplementationOnce(() =>
    json(
      { error: 'The expiry date (2026-01-31) has passed, so it cannot be used on that date' },
      400,
    ),
  );
  fireEvent.change(date, { target: { value: '2026-02-01' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add usage' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent('The expiry date (2026-01-31)');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(within(panel).getByLabelText('Amount used (KRW)')).not.toHaveAttribute('aria-invalid');

  const posts = requests.filter((request) => request.method === 'POST').length;
  // A submit that skips the browser's own date checks still meets ours.
  const form = within(panel).getByRole('form', { name: 'Salon membership add usage' });
  fireEvent.change(date, { target: { value: '2026-02-30' } });
  fireEvent.submit(form);
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    'Enter the date of use between 1900 and 2100',
  );
  fireEvent.change(date, { target: { value: '2099-01-01' } });
  expect(date).toHaveAttribute('max', serviceToday());
  fireEvent.submit(form);
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    'Usage dated after today cannot be recorded',
  );
  expect(requests.filter((request) => request.method === 'POST')).toHaveLength(posts);
});

test('a refusal that is not about the date or the balance marks no field', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Salon membership usage records' }));
  const panel = screen.getByRole('region', { name: 'Salon membership usage records' });
  fireEvent.change(within(panel).getByLabelText('Amount used (KRW)'), {
    target: { value: '1000' },
  });
  vi.mocked(fetch).mockImplementationOnce(() => json({ error: 'Asset not found' }, 404));
  fireEvent.click(within(panel).getByRole('button', { name: 'Add usage' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent('Asset not found');
  expect(within(panel).getByLabelText('Amount used (KRW)')).not.toHaveAttribute('aria-invalid');
  expect(within(panel).getByLabelText('Date used')).not.toHaveAttribute('aria-invalid');
});

test('a use of 0 won is refused before sending', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Salon membership usage records' }));
  const panel = screen.getByRole('region', { name: 'Salon membership usage records' });
  fireEvent.change(within(panel).getByLabelText('Amount used (KRW)'), { target: { value: '0' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Add usage' }));
  expect(within(panel).getByRole('alert')).toHaveTextContent(
    'Enter the amount used as a whole number of won, at least ₩1',
  );
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a prepaid asset fills its kind, amount and dates', async () => {
  stored.push(salon);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Salon membership' }));
  expect(screen.getByRole('radio', { name: 'Voucher' })).toBeChecked();
  expect(screen.getByLabelText('Amount loaded (KRW)')).toHaveValue('300000');
  expect(screen.getByLabelText('Expiry date (optional)')).toHaveValue('2026-12-31');
});
