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
  cash: '현금(예적금 포함)',
  stock: '주식',
  real_estate: '부동산',
};
const typeLabel = (type: string) => labels[type] ?? type;

const allocation: Allocation = {
  excluded: 2,
  byType: [
    { type: 'real_estate', amountKrw: 300_000_000, share: '75.0', count: 1 },
    { type: 'cash', amountKrw: 100_000_000, share: '25.0', count: 2 },
  ],
  byAsset: [
    { id: 3, name: '아파트', type: 'real_estate', amountKrw: 300_000_000, share: '75.0' },
    { id: 1, name: '통장', type: 'cash', amountKrw: 100_000_000, share: '25.0' },
    { id: 2, name: '빈 통장', type: 'cash', amountKrw: 0, share: '0.0' },
  ],
  chart: [
    { key: '3', name: '아파트', amountKrw: 300_000_000, share: '75.0', count: 1 },
    { key: '1', name: '통장', amountKrw: 100_000_000, share: '25.0', count: 1 },
    { key: '2', name: '빈 통장', amountKrw: 0, share: '0.0', count: 1 },
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
  expect(screen.getByRole('heading', { name: '자산 배분' })).toBeInTheDocument();
  expect(screen.getByText(/2개는 빠졌습니다/)).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '종류별' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByTestId('chart')).toHaveTextContent('종류별:부동산 75.0,현금 25.0');
  const table = screen.getByRole('table', { name: '종류별 자산 금액과 비중' });
  expect(rowsOf(table)).toEqual([
    '부동산 (1개)300,000,000원75.0%',
    '현금(예적금 포함) (2개)100,000,000원25.0%',
  ]);
});

test('by asset: a 0 won asset is in the table at 0.0% but not in the chart', async () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  fireEvent.click(screen.getByRole('tab', { name: '종목별' }));
  expect(screen.getByRole('tab', { name: '종목별' })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByTestId('chart')).toHaveTextContent('종목별:아파트 75.0,통장 25.0');
  const table = screen.getByRole('table', { name: '종목별 자산 금액과 비중' });
  expect(rowsOf(table)).toEqual([
    '아파트부동산300,000,000원75.0%',
    '통장현금(예적금 포함)100,000,000원25.0%',
    '빈 통장현금(예적금 포함)0원0.0%',
  ]);
});

test('the rest of the assets are one chart line, "그 밖의 N개"', async () => {
  render(
    <AssetAllocation
      allocation={{
        ...allocation,
        chart: [
          { key: '3', name: '아파트', amountKrw: 300_000_000, share: '75.0', count: 1 },
          { key: 'rest', name: null, amountKrw: 100_000_000, share: '25.0', count: 4 },
        ],
      }}
      typeLabel={typeLabel}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: '종목별' }));
  expect(await screen.findByTestId('chart')).toHaveTextContent('아파트 75.0,그 밖의 4개 25.0');
});

test('arrow keys move between the tabs', () => {
  render(<AssetAllocation allocation={allocation} typeLabel={typeLabel} />);
  const byType = screen.getByRole('tab', { name: '종류별' });
  byType.focus();
  fireEvent.keyDown(byType, { key: 'ArrowRight' });
  const byAsset = screen.getByRole('tab', { name: '종목별' });
  expect(byAsset).toHaveFocus();
  expect(byAsset).toHaveAttribute('aria-selected', 'true');
  expect(byType).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(byAsset, { key: 'Home' });
  expect(byType).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('종류별');
});

test('nothing to spread: no tabs, a short note instead', () => {
  render(
    <AssetAllocation
      allocation={{ excluded: 1, byType: [], byAsset: [], chart: [] }}
      typeLabel={typeLabel}
    />,
  );
  expect(screen.getByText(/비중을 계산할 자산이 없습니다/)).toBeInTheDocument();
  expect(screen.getByText(/1개는 빠졌습니다/)).toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

test('only 0 won assets: the table without a chart', () => {
  render(
    <AssetAllocation
      allocation={{
        excluded: 0,
        byType: [{ type: 'cash', amountKrw: 0, share: '0.0', count: 1 }],
        byAsset: [{ id: 1, name: '빈 통장', type: 'cash', amountKrw: 0, share: '0.0' }],
        chart: [{ key: '1', name: '빈 통장', amountKrw: 0, share: '0.0', count: 1 }],
      }}
      typeLabel={typeLabel}
    />,
  );
  expect(screen.getByText(/차트에 그릴 비중이 없습니다/)).toBeInTheDocument();
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
  const card = await screen.findByRole('heading', { name: '자산 배분' });
  const totals = screen.getByRole('region', { name: '합계' });
  // The card follows the totals and comes before the form.
  expect(totals.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const form = screen.getByRole('heading', { name: '새 자산' });
  expect(card.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The screen's own type names label the rows.
  expect(await screen.findByTestId('chart')).toHaveTextContent('부동산 75.0,현금 25.0');
});

test('the real chart is one image named by its largest line', async () => {
  const { AssetAllocationChart: Real } = await vi.importActual<
    typeof import('./asset-allocation-chart')
  >('./asset-allocation-chart');
  expect(Real).not.toBe(AssetAllocationChart);
  render(
    <Real
      title="종목별"
      bars={[
        { key: '3', name: '아파트', amountKrw: 300_000_000, share: '75.0' },
        { key: '1', name: '통장', amountKrw: 100_000_000, share: '25.0' },
      ]}
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    '종목별 자산 배분 가로 막대 차트. 가장 큰 항목은 아파트 300,000,000원(75.0%)입니다. 모든 값은 아래 표에 있습니다.',
  );
  expect(Number.parseInt(screen.getByRole('img').style.height, 10)).toBe(2 * 36 + 32);
});
