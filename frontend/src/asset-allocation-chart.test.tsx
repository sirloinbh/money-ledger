import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { AssetAllocationChart } from './asset-allocation-chart';

// #202 The chart itself (the card is in asset-allocation.test.tsx). jsdom has no layout, so the bars are checked in
// a real browser.

test('the chart is one image named by its largest item', () => {
  render(
    <AssetAllocationChart
      title="By type"
      bars={[
        { key: 'cash', name: 'Cash', amountKrw: 3_000_000, share: '75.0', value: 75 },
        { key: 'stock', name: 'Stocks', amountKrw: 1_000_000, share: '25.0', value: 25 },
      ]}
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    'By type asset allocation horizontal bar chart. The largest item is Cash ₩3,000,000 (75.0%). All values are in the table below.',
  );
});

test('an empty list draws nothing instead of failing', () => {
  render(<AssetAllocationChart title="By type" bars={[]} />);
  expect(screen.getByText('Nothing to draw yet.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
});
