import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { type Allocation, AssetAllocation } from './asset-allocation';
import { AssetAllocationChart } from './asset-allocation-chart';
import { AssetManager } from './assets';

// #48 The asset allocation card. The server works out every share (allocation.integration.test.ts); here the
// card shows them. The real chart is checked at the end and in a real browser (docs/changes/48-*.md).

vi.mock('./asset-allocation-chart', async (original) => ({
  ...(await original<typeof import('./asset-allocation-chart')>()),
  AssetAllocationChart: ({
    bars,
    title,
  }: {
    bars: { name: string; share: string }[];
    title: string;
  }) => (
    <p data-testid="chart">
      {title}:{bars.map((bar) => `${bar.name} ${bar.share}`).join(',')}
    </p>
  ),
}));

const labels: Record<string, string> = {
  cash: 'Cash (incl. savings)',
  stock: 'Stocks',
  real_estate: 'Real estate',
};
const typeLabel = (type: string) => labels[type] ?? type;

const allocation: Allocation = {
  excluded: 2,
  byType: [
    { type: 'real_estate', amountKrw: 300_000_000, share: '75.0', count: 1 },
    { type: 'cash', amountKrw: 100_000_000, share: '25.0', count: 2 },
  ],
  byAsset: [
    { id: 3, name: 'Apartment', type: 'real_estate', amountKrw: 300_000_000, share: '75.0' },
    { id: 1, name: 'Savings account', type: 'cash', amountKrw: 100_000_000, share: '25.0' },
    { id: 2, name: 'Empty account', type: 'cash', amountKrw: 0, share: '0.0' },
  ],
  chart: [
    { key: '3', name: 'Apartment', amountKrw: 300_000_000, share: '75.0', count: 1 },
    { key: '1', name: 'Savings account', amountKrw: 100_000_000, share: '25.0', count: 1 },
    { key: '2', name: 'Empty account', amountKrw: 0, share: '0.0', count: 1 },
  ],
};

afterEach(() => vi.unstubAllGlobals());

const rowsOf = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent);

test('by type first: the chart and every type in a table, and how many were left out', async () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  expect(screen.getByRole('heading', { name: 'Asset allocation' })).toBeInTheDocument();
  expect(screen.getByText(/2 without a quote/)).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'By type' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    'By type:Real estate 75.0,Cash 25.0',
  );
  const table = screen.getByRole('table', { name: 'Asset amounts and shares by type' });
  expect(rowsOf(table)).toEqual([
    'Real estate (1)₩300,000,00075.0%',
    'Cash (incl. savings) (2)₩100,000,00025.0%',
  ]);
});

test('by asset: a 0 won asset is in the table at 0.0% but not in the chart', async () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  fireEvent.click(screen.getByRole('tab', { name: 'By asset' }));
  expect(screen.getByRole('tab', { name: 'By asset' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByTestId('chart')).toHaveTextContent(
    'By asset:Apartment 75.0,Savings account 25.0',
  );
  const table = screen.getByRole('table', { name: 'Asset amounts and shares by asset' });
  expect(rowsOf(table)).toEqual([
    'ApartmentReal estate₩300,000,00075.0%',
    'Savings accountCash (incl. savings)₩100,000,00025.0%',
    'Empty accountCash (incl. savings)₩00.0%',
  ]);
});

test('the rest of the assets are one chart line, "Other N"', async () => {
  render(
    <AssetAllocation
      allocation={{
        ...allocation,
        chart: [
          { key: '3', name: 'Apartment', amountKrw: 300_000_000, share: '75.0', count: 1 },
          { key: 'rest', name: null, amountKrw: 100_000_000, share: '25.0', count: 4 },
        ],
      }}
      typeLabel={typeLabel}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'By asset' }));
  expect(await screen.findByTestId('chart')).toHaveTextContent('Apartment 75.0,Other 4 25.0');
});

test('arrow keys move between the tabs', () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  const byType = screen.getByRole('tab', { name: 'By type' });
  byType.focus();
  fireEvent.keyDown(byType, { key: 'ArrowRight' });
  const byAsset = screen.getByRole('tab', { name: 'By asset' });
  expect(byAsset).toHaveFocus();
  expect(byAsset).toHaveAttribute('aria-selected', 'true');
  expect(byType).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(byAsset, { key: 'Home' });
  expect(byType).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('By type');
});

test('nothing to spread: no tabs, a short note instead', () => {
  render(
    <AssetAllocation
      allocation={{ excluded: 1, byType: [], byAsset: [], chart: [] }}
      typeLabel={typeLabel}
    />,
  );
  expect(screen.getByText(/No assets to allocate/)).toBeInTheDocument();
  expect(screen.getByText(/1 without a quote/)).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

test('a line too large to show in won is still drawn by its share', async () => {
  render(
    <AssetAllocation
      allocation={{
        ...allocation,
        byType: [
          { type: 'cash', amountKrw: null, share: '99.9', count: 10 },
          { type: 'real_estate', amountKrw: 300_000_000, share: '0.1', count: 1 },
        ],
      }}
      typeLabel={typeLabel}
    />,
  );
  expect(await screen.findByTestId('chart')).toHaveTextContent('By type:Cash 99.9,Real estate 0.1');
  expect(rowsOf(screen.getByRole('table'))[0]).toBe('Cash (incl. savings) (10)-99.9%');
});

test('each tab controls its own panel; the other one is hidden', () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  for (const name of ['By type', 'By asset']) {
    const tab = screen.getByRole('tab', { name });
    const panel = document.getElementById(tab.getAttribute('aria-controls')!)!;
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(panel.hidden).toBe(tab.getAttribute('aria-selected') !== 'true');
  }
});

test('only 0 won assets: the table without a chart', () => {
  render(
    <AssetAllocation
      allocation={{
        excluded: 0,
        byType: [{ type: 'cash', amountKrw: 0, share: '0.0', count: 1 }],
        byAsset: [{ id: 1, name: 'Empty account', type: 'cash', amountKrw: 0, share: '0.0' }],
        chart: [{ key: '1', name: 'Empty account', amountKrw: 0, share: '0.0', count: 1 }],
      }}
      typeLabel={typeLabel}
    />,
  );
  expect(screen.getByText(/nothing to draw in the chart/)).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  expect(screen.getByRole('table')).toHaveTextContent('0.0%');
});

test('the asset screen shows the card right under the totals', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            asOf: '2026-11-10',
            assets: [],
            totals: { assetsKrw: 400_000_000, debtsKrw: 0, netKrw: 400_000_000, uncounted: 2 },
            allocation,
          }),
        ),
      ),
    ),
  );
  render(<AssetManager />);
  const card = await screen.findByRole('heading', { name: 'Asset allocation' });
  const totals = screen.getByRole('region', { name: 'Totals' });
  // The card follows the totals and comes before the form.
  expect(totals.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const form = screen.getByRole('heading', { name: 'New asset' });
  expect(card.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The screen's own type names label the rows.
  expect(await screen.findByTestId('chart')).toHaveTextContent('Real estate 75.0,Cash 25.0');
});

test('the real chart is one image named by its largest line', async () => {
  const { AssetAllocationChart: Real } = await vi.importActual<
    typeof import('./asset-allocation-chart')
  >('./asset-allocation-chart');
  expect(Real).not.toBe(AssetAllocationChart);
  render(
    <Real
      title="By asset"
      bars={[
        { key: '3', name: 'Apartment', amountKrw: 300_000_000, share: '75.0', value: 75 },
        { key: '1', name: 'Savings account', amountKrw: 100_000_000, share: '25.0', value: 25 },
      ]}
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'By asset asset allocation horizontal bar chart. The largest item is Apartment ₩300,000,000 (75.0%). All values are in the table below.',
  );
  expect(Number.parseInt(screen.getByRole('img').style.height, 10)).toBe(2 * 36 + 32);
});
