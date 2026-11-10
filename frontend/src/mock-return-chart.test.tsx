import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { MockReturnChart } from './mock-return-chart';

// jsdom has no layout, so the line itself is checked in a real browser (docs/changes/54-*.md).
test('the chart is one image named by its period and last return, pointing at the table', () => {
  render(
    <MockReturnChart
      points={[
        { date: '2026-11-01', totalKrw: 10_000_000, profitKrw: 0, returnPct: '0.00' },
        { date: '2026-11-09', totalKrw: 10_194_000, profitKrw: 194_000, returnPct: '1.94' },
      ]}
    />,
  );
  expect(screen.getByRole('img')).toHaveAccessibleName(
    '날짜별 수익률 꺾은선 차트. 11월 1일부터 11월 9일까지, 마지막 수익률은 +1.94%입니다. 모든 값은 아래 표에 있습니다.',
  );
});
