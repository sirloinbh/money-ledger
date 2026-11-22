import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { AssetManager } from './assets';
import { type AssetFake, assetsAnswer, fakeAssetApi } from './test/asset-api';
import { findLive, getLive } from './test/live';

// The shared fake asset server (test/asset-api.ts): totals the way the server adds them, and any request it does
// not serve fails the test.
let api: AssetFake;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  api = fakeAssetApi({
    stored: [
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
    ],
  });
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
    screen.getByText(
      /1 item without a quote, exchange rate, or valuation is left out of the totals\./,
    ),
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
  expect(await findLive('status')).toHaveTextContent('Apartment added');
  expect(api.requests).toContainEqual({
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
  await findLive('status');
  expect(api.requests.find((request) => request.method === 'POST')?.body).toMatchObject({
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
  expect(getLive('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
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
  expect(await findLive('status')).toHaveTextContent('Apple updated');
  expect(api.requests).toContainEqual({
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

test('a server refusal shows its message', async () => {
  await ready();
  vi.mocked(fetch).mockImplementationOnce(() =>
    json({ error: 'Enter the valuation of a dollar asset in dollars' }, 400),
  );
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cash' } });
  fireEvent.change(screen.getByLabelText('Valuation (KRW)'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await findLive('alert')).toHaveTextContent(
    'Enter the valuation of a dollar asset in dollars',
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Cash');
});

test('cancelling an edit keeps focus in the form and a USD value round-trips', async () => {
  api.stored[2] = { ...api.stored[2], valueForeign: '1234.5000' };
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
  expect(await findLive('status')).toHaveTextContent('Laptop added');
  expect(api.requests).toContainEqual({
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
    expect(getLive('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
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
  expect(getLive('alert')).toHaveTextContent('Enter a purchase date between 1900 and 2100');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
});

test('a purchase date that is not on the calendar is not sent (#189)', async () => {
  await ready();
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bed' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'depreciable' } });
  fireEvent.change(screen.getByLabelText('Purchase price (KRW)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Useful life (months)'), { target: { value: '60' } });
  const date = screen.getByLabelText<HTMLInputElement>('Purchase date');
  // A browser without a date picker shows a text box, which keeps a day that does not exist.
  date.type = 'text';
  fireEvent.change(date, { target: { value: '2026-02-30' } });
  fireEvent.submit(screen.getByRole('form', { name: 'New asset' }));
  expect(getLive('alert')).toHaveTextContent('Enter a purchase date between 1900 and 2100');
  expect(date).toHaveAttribute('aria-invalid', 'true');
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
});

test('an older list answer that arrives last does not replace a newer one (#189)', async () => {
  // The first load is held back; the reload after a save answers first, with the new asset.
  const answer = vi.mocked(fetch).getMockImplementation()!;
  let release = () => {};
  vi.mocked(fetch).mockImplementationOnce((url, init) => {
    const stale = answer(url, init);
    return new Promise((resolve) => {
      release = () => resolve(stale);
    });
  });
  render(<AssetManager />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Apartment' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'real_estate' } });
  fireEvent.change(screen.getByLabelText('Valuation (KRW)'), { target: { value: '300000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await findLive('status')).toHaveTextContent('Apartment added');
  expect(summary('Total assets')).toHaveTextContent('₩305,000,000');

  // The first answer, from before the save, arrives now and is ignored.
  release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(summary('Total assets')).toHaveTextContent('₩305,000,000');
  expect(screen.getByText('Apartment')).toBeInTheDocument();
});

test('a save waits while a delete is running (#189)', async () => {
  await ready();
  const answer = vi.mocked(fetch).getMockImplementation()!;
  let release = () => {};
  vi.mocked(fetch).mockImplementationOnce((url, init) => {
    const deleted = answer(url, init);
    return new Promise((resolve) => {
      release = () => resolve(deleted);
    });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete Lease deposit loan' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
  await vi.waitFor(() =>
    expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true),
  );

  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Apartment' } });
  fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'real_estate' } });
  fireEvent.change(screen.getByLabelText('Valuation (KRW)'), { target: { value: '300000000' } });
  // The open delete dialog hides the page from the accessibility tree; a submit there is ignored.
  fireEvent.submit(screen.getByRole('form', { name: 'New asset', hidden: true }));
  expect(api.requests.some((request) => request.method === 'POST')).toBe(false);

  release();
  expect(await screen.findByText('Lease deposit loan deleted')).toBeInTheDocument();
  // Once the delete is done, the same submit goes through.
  fireEvent.submit(screen.getByRole('form', { name: 'New asset' }));
  expect(await findLive('status')).toHaveTextContent('Apartment added');
});

test('editing a #45 depreciable row offers its value as the purchase price', async () => {
  api.stored.push({
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
  api.stored.push({
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
  vi.mocked(fetch).mockImplementationOnce(() =>
    json({
      ...assetsAnswer(api.stored),
      totals: { assetsKrw: null, debtsKrw: 7000000, netKrw: null, uncounted: 1 },
    }),
  );
  await ready();
  expect(summary('Total assets')).toHaveTextContent('Too large to show');
  expect(summary('Total liabilities')).toHaveTextContent('₩7,000,000');
  expect(summary('Net worth')).toHaveTextContent('Too large to show');
});
