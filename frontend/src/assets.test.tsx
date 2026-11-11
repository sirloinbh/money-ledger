import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';

type Asset = {
  id: number;
  name: string;
  type: string;
  currency: 'KRW' | 'USD';
  quantity: string | null;
  valueKrw: number | null;
  valueForeign: string | null;
  memo: string;
  depreciation?: {
    purchasePriceKrw: number;
    purchasedOn: string;
    usefulLifeMonths: number;
    salvageValueKrw: number;
  } | null;
};

let stored: Asset[];
let requests: { method: string; url: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(body), { status }),
  );

// The server works out a depreciated value from the date; the fake says it is half the purchase price.
const withCurrent = (asset: Asset) => ({
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
  depreciation: asset.depreciation ?? null,
  prepaid: null,
  hasTrades: false,
  currentValueKrw: asset.depreciation ? asset.depreciation.purchasePriceKrw / 2 : asset.valueKrw,
});

// Totals the way the server does: current won values only, debts apart.
function totals() {
  const valued = stored.map(withCurrent);
  const sum = (debt: boolean) =>
    valued
      .filter((asset) => (asset.type === 'debt') === debt)
      .reduce((total, asset) => total + (asset.currentValueKrw ?? 0), 0);
  return {
    assetsKrw: sum(false),
    debtsKrw: sum(true),
    netKrw: sum(false) - sum(true),
    uncounted: valued.filter((asset) => asset.currentValueKrw === null).length,
  };
}

function fakeApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = init.body ? (JSON.parse(init.body as string) as Omit<Asset, 'id'>) : undefined;
      requests.push({ method, url, body });
      if (method === 'GET') return json({ assets: stored.map(withCurrent), totals: totals() });
      const id = Number(url.split('/').pop());
      if (method === 'DELETE') {
        stored = stored.filter((asset) => asset.id !== id);
        return json(undefined, 204);
      }
      const saved = { ...body!, id: method === 'POST' ? stored.length + 10 : id };
      stored =
        method === 'POST'
          ? [...stored, saved]
          : stored.map((asset) => (asset.id === id ? saved : asset));
      return json({ asset: withCurrent(saved) }, method === 'POST' ? 201 : 200);
    }),
  );
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
    },
    {
      id: 2,
      name: 'Lease deposit loan',
      type: 'debt',
      currency: 'KRW',
      quantity: null,
      valueKrw: 7000000,
      valueForeign: null,
      memo: '',
    },
    {
      id: 3,
      name: 'Apple',
      type: 'stock',
      currency: 'USD',
      quantity: '1.50000000',
      valueKrw: null,
      valueForeign: null,
      memo: 'Overseas',
    },
  ];
  requests = [];
  fakeApi();
});

const ready = async () => {
  render(<AssetManager />);
  await screen.findByRole('heading', { name: 'Cash (incl. savings)' });
};

const summary = (label: string) =>
  within(screen.getByRole('region', { name: 'Totals' })).getByText(label).nextElementSibling;

test('assets are grouped by type and debts are totalled apart from assets', async () => {
  await ready();
  expect(summary('Total assets')).toHaveTextContent('₩5,000,000');
  expect(summary('Total liabilities')).toHaveTextContent('₩7,000,000');
  expect(summary('Net worth')).toHaveTextContent('-₩2,000,000');
  expect(
    screen.getByText(/1 without a quote, exchange rate, or valuation left out of the totals/),
  ).toBeInTheDocument();
  const stocks = screen.getByRole('list', { name: 'Stocks (incl. ETFs and funds)' });
  expect(within(stocks).getByText('USD · quantity 1.5 · Overseas')).toBeInTheDocument();
  expect(within(stocks).getByText('No valuation')).toBeInTheDocument();
  expect(
    within(screen.getByRole('list', { name: 'Liability' })).getByText('₩7,000,000'),
  ).toBeInTheDocument();
});

test('a won asset is added with its value as a whole number', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Apartment ' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'real_estate' } });
  fireEvent.change(screen.getByLabelText('Valuation (KRW)'), { target: { value: '300,000,000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Apartment added');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets',
    body: {
      name: 'Apartment',
      type: 'real_estate',
      currency: 'KRW',
      quantity: null,
      valueKrw: 300000000,
      valueForeign: null,
      memo: '',
      securityId: null,
      manualPrice: null,
    },
  });
  expect(summary('Total assets')).toHaveTextContent('₩305,000,000');
  expect(screen.getByLabelText('Name')).toHaveValue('');
});

test('a USD asset with a quantity sends decimal strings', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tesla' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'stock' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Dollar (USD)' }));
  fireEvent.change(screen.getByLabelText('Quantity (optional)'), { target: { value: '0.25' } });
  fireEvent.change(screen.getByLabelText('Valuation (USD)'), { target: { value: '1,234.56' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByRole('status');
  expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
    currency: 'USD',
    quantity: '0.25',
    valueKrw: null,
    valueForeign: '1234.56',
  });
  expect(screen.getByText('$1,234.56')).toBeInTheDocument();
});

test.each([
  { label: 'no name', fill: { value: '1' }, field: 'Name', message: 'Enter an asset name' },
  {
    label: 'neither quantity nor value',
    fill: { name: 'Cash' },
    field: 'Valuation (KRW)',
    message: 'Enter a valuation for an asset without a quantity',
  },
  {
    label: 'a fractional won value',
    fill: { name: 'Cash', value: '10.5' },
    field: 'Valuation (KRW)',
    message: 'Enter the valuation in won as a whole number, 0 or more',
  },
  {
    label: 'a comma that is not a thousands separator',
    fill: { name: 'Cash', value: '1,2,3' },
    field: 'Valuation (KRW)',
    message: 'Enter the valuation in won as a whole number, 0 or more',
  },
  {
    label: 'a value over ₩1 quadrillion',
    fill: { name: 'Cash', value: '1000000000000001' },
    field: 'Valuation (KRW)',
    message: 'Enter a valuation of ₩1 quadrillion or less',
  },
  {
    label: 'a zero quantity',
    fill: { name: 'Cash', quantity: '0' },
    field: 'Quantity (optional)',
    message: 'Enter a quantity above 0 with up to 8 decimal places',
  },
])('$label is refused before sending and marks the field', async ({ fill, field, message }) => {
  await ready();
  const labels: Record<string, string> = {
    name: 'Name',
    value: 'Valuation (KRW)',
    quantity: 'Quantity (optional)',
  };
  for (const [key, value] of Object.entries(fill)) {
    fireEvent.change(screen.getByLabelText(labels[key]), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('a debt has no quantity field and asks for the amount still owed', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'debt' } });
  expect(screen.queryByLabelText('Quantity (optional)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Remaining amount (KRW)')).toBeInTheDocument();
});

test('editing fills the form, moves focus to it, and saves with PUT', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Apple' }));
  expect(screen.getByLabelText('Name')).toHaveFocus();
  expect(screen.getByLabelText('Quantity (optional)')).toHaveValue('1.5');
  expect(screen.getByRole('radio', { name: 'Dollar (USD)' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Valuation (USD)'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Apple updated');
  expect(requests).toContainEqual({
    method: 'PUT',
    url: '/api/portfolio/assets/3',
    body: {
      name: 'Apple',
      type: 'stock',
      currency: 'USD',
      quantity: '1.5',
      valueKrw: null,
      valueForeign: '300',
      memo: 'Overseas',
      securityId: null,
      manualPrice: null,
    },
  });
  expect(screen.getByRole('heading', { name: 'New asset' })).toBeInTheDocument();
});

test('deleting asks first, then removes the asset and moves focus to the list title', async () => {
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Lease deposit loan' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Lease deposit loan deleted')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Liability' })).not.toBeInTheDocument();
  expect(summary('Net worth')).toHaveTextContent('₩5,000,000');
  await vi.waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Assets and liabilities' })).toHaveFocus(),
  );
});

test('a server refusal shows its Korean message', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() =>
    json({ error: 'Enter the valuation of a dollar asset in dollars' }, 400),
  );
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cash' } });
  fireEvent.change(screen.getByLabelText('Valuation (KRW)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter the valuation of a dollar asset in dollars',
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Cash');
});

test('cancelling an edit keeps focus in the form and a USD value round-trips', async () => {
  stored[2] = { ...stored[2], valueForeign: '1234.5000' };
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Apple' }));
  expect(screen.getByLabelText('Valuation (USD)')).toHaveValue('1234.5');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  expect(screen.getByLabelText('Name')).toHaveFocus();
  expect(screen.getByLabelText('Name')).toHaveValue('');
});

// #63
test('a depreciating asset is entered as a purchase price, date and useful life', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Laptop' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'depreciable' } });
  expect(screen.queryByLabelText('Valuation (KRW)')).not.toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: 'Dollar (USD)' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Salvage value (KRW)')).toHaveValue('0'); // decision: 0 won by default
  fireEvent.change(screen.getByLabelText('Purchase price (KRW)'), {
    target: { value: '1,200,000' },
  });
  fireEvent.change(screen.getByLabelText('Purchase date'), { target: { value: '2026-01-15' } });
  fireEvent.change(screen.getByLabelText('Default useful life'), { target: { value: '60' } });
  expect(screen.getByLabelText('Useful life (months)')).toHaveValue('60');
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Laptop added');
  expect(requests).toContainEqual({
    method: 'POST',
    url: '/api/portfolio/assets',
    body: {
      name: 'Laptop',
      type: 'depreciable',
      currency: 'KRW',
      quantity: null,
      valueKrw: null,
      valueForeign: null,
      memo: '',
      depreciation: {
        purchasePriceKrw: 1200000,
        purchasedOn: '2026-01-15',
        usefulLifeMonths: 60,
        salvageValueKrw: 0,
      },
    },
  });
  const list = screen.getByRole('list', { name: 'Depreciable' });
  expect(
    within(list).getByText(
      'Purchase price ₩1,200,000 · purchased 2026-01-15 · useful life 60 months',
    ),
  ).toBeInTheDocument();
  expect(within(list).getByText('₩600,000')).toBeInTheDocument(); // the current value from the server
  expect(summary('Total assets')).toHaveTextContent('₩5,600,000');
});

test('the useful life presets are 10, 5 and 7 years and the months can be changed', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'depreciable' } });
  const preset = screen.getByLabelText('Default useful life');
  expect(
    within(preset)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Enter manually', 'Bed (10 years)', 'Computer (5 years)', 'Appliance (7 years)']);
  fireEvent.change(preset, { target: { value: '84' } });
  expect(screen.getByLabelText('Useful life (months)')).toHaveValue('84');
  fireEvent.change(screen.getByLabelText('Useful life (months)'), { target: { value: '90' } });
  expect(preset).toHaveValue('');
});

test.each([
  {
    label: 'no purchase price',
    fill: { date: '2026-01-01', months: '60' },
    field: 'Purchase price (KRW)',
    message: 'Enter the purchase price as a whole number of won, up to ₩1 quadrillion',
  },
  {
    label: 'no purchase date',
    fill: { price: '1000', months: '60' },
    field: 'Purchase date',
    message: 'Enter the purchase date',
  },
  {
    label: 'a useful life of 0 months',
    fill: { price: '1000', date: '2026-01-01', months: '0' },
    field: 'Useful life (months)',
    message: 'Enter a useful life as a whole number from 1 to 1200 months',
  },
  {
    label: 'a salvage value above the price',
    fill: { price: '1000', date: '2026-01-01', months: '60', salvage: '1001' },
    field: 'Salvage value (KRW)',
    message: 'The salvage value cannot be more than the purchase price',
  },
])(
  'a depreciating asset with $label is refused before sending',
  async ({ fill, field, message }) => {
    await ready();
    const labels: Record<string, string> = {
      price: 'Purchase price (KRW)',
      date: 'Purchase date',
      months: 'Useful life (months)',
      salvage: 'Salvage value (KRW)',
    };
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bed' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'depreciable' } });
    for (const [key, value] of Object.entries(fill)) {
      fireEvent.change(screen.getByLabelText(labels[key]), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  },
);

test('a purchase date outside 1900–2100 is not sent', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bed' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'depreciable' } });
  fireEvent.change(screen.getByLabelText('Purchase price (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Useful life (months)'), { target: { value: '60' } });
  const date = screen.getByLabelText<HTMLInputElement>('Purchase date');
  expect(date).toHaveAttribute('min', '1900-01-01');
  expect(date).toHaveAttribute('max', '2100-12-31');
  fireEvent.change(date, { target: { value: '0201-01-01' } });
  // The browser's range check stops the submit first.
  expect(date.validity.rangeUnderflow).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  // Our own check covers a submit that skips the browser's (the same range as the server).
  fireEvent.submit(screen.getByRole('form', { name: 'New asset' }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a purchase date between 1900 and 2100',
  );
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(requests.some((request) => request.method === 'POST')).toBe(false);
});

test('editing a #45 depreciable row offers its value as the purchase price', async () => {
  stored.push({
    id: 5,
    name: 'Old TV',
    type: 'depreciable',
    currency: 'KRW',
    quantity: null,
    valueKrw: 700000,
    valueForeign: null,
    memo: '',
  });
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Old TV' }));
  expect(screen.getByLabelText('Purchase price (KRW)')).toHaveValue('700000');
  expect(screen.getByLabelText('Purchase date')).toHaveValue('');
});

test('editing a depreciating asset fills its schedule', async () => {
  stored.push({
    id: 4,
    name: 'Bed',
    type: 'depreciable',
    currency: 'KRW',
    quantity: null,
    valueKrw: null,
    valueForeign: null,
    memo: '',
    depreciation: {
      purchasePriceKrw: 2000000,
      purchasedOn: '2025-03-01',
      usefulLifeMonths: 120,
      salvageValueKrw: 100000,
    },
  });
  await ready();
  expect(screen.getByText(/· salvage value ₩100,000$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Bed' }));
  expect(screen.getByLabelText('Purchase price (KRW)')).toHaveValue('2000000');
  expect(screen.getByLabelText('Purchase date')).toHaveValue('2025-03-01');
  expect(screen.getByLabelText('Default useful life')).toHaveValue('120');
  expect(screen.getByLabelText('Salvage value (KRW)')).toHaveValue('100000');
});

test('a total too large to show says so instead of a wrong number', async () => {
  const api = vi.mocked(fetch);
  api.mockImplementationOnce(() =>
    json({
      assets: stored.map(withCurrent),
      totals: { assetsKrw: null, debtsKrw: 7000000, netKrw: null, uncounted: 1 },
    }),
  );
  await ready();
  expect(summary('Total assets')).toHaveTextContent('Too large to show');
  expect(summary('Total liabilities')).toHaveTextContent('₩7,000,000');
  expect(summary('Net worth')).toHaveTextContent('Too large to show');
});
