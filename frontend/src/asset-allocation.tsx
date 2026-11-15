import {
  Component,
  type KeyboardEvent,
  lazy,
  type ReactNode,
  Suspense,
  useId,
  useRef,
  useState,
} from 'react';

import type { AllocationBar } from './asset-allocation-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { formatWon } from './format';

// #48 How the asset total is spread, by type and by asset (decisions 2026-11-10, server: allocation.ts).
// Debts and assets without a won value are left out; the shares add up to exactly 100.0%. The chart shows the
// 8 largest assets and the rest as "Other N"; the table under it lists every asset, 0 won ones at 0.0%.

type Share = { amountKrw: number | null; share: string };
export type Allocation = {
  excluded: number;
  byType: (Share & { type: string; count: number })[];
  byAsset: (Share & { id: number; name: string; type: string })[];
  chart: (Share & { key: string; name: string | null; count: number })[];
};

type Tab = 'type' | 'asset';
const tabs: { id: Tab; label: string }[] = [
  { id: 'type', label: 'By type' },
  { id: 'asset', label: 'By asset' },
];

// Recharts is large: the chart loads in its own file when there is something to draw, not with the app.
// `lazy` keeps a failed load, so a failure starts a new one the next time the card is shown.
const loadChart = () =>
  lazy(() =>
    import('./asset-allocation-chart').then((module) => ({
      default: module.AssetAllocationChart,
    })),
  );
const chart = { Chart: loadChart() };

/**
 * Bars except 0 won lines (those are only in the table). The bar length is the share, so a line whose amount is
 * too large to show exactly (amountKrw null) is still drawn.
 */
const drawn = (bars: Omit<AllocationBar, 'value'>[]): AllocationBar[] =>
  bars.filter((bar) => bar.amountKrw !== 0).map((bar) => ({ ...bar, value: Number(bar.share) }));

export function AssetAllocation({
  allocation,
  typeLabel,
}: {
  allocation: Allocation;
  typeLabel: (type: string) => string;
}) {
  const [tab, setTab] = useState<Tab>('type');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ type: null, asset: null });
  const baseId = useId();
  const counted = allocation.byAsset.length;

  // Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern, automatic activation).
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[tabs[next].id]?.focus();
  };

  const bars =
    tab === 'type'
      ? drawn(
          allocation.byType.map((row) => ({
            key: row.type,
            // "Cash (incl. savings)" → "Cash" on the narrow axis; the table gives the whole name.
            name: typeLabel(row.type).replace(/\s*\(.*\)$/, ''),
            amountKrw: row.amountKrw,
            share: row.share,
          })),
        )
      : drawn(
          allocation.chart.map((row) => ({
            key: row.key,
            name: row.name ?? `Other ${row.count}`,
            amountKrw: row.amountKrw,
            share: row.share,
          })),
        );
  const title = tabs.find((item) => item.id === tab)!.label;

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">Asset allocation</CardTitle>
        <CardDescription>
          Share of the asset total by type and by asset. Liabilities are not included.
          {allocation.excluded > 0
            ? ` ${allocation.excluded} without a quote, exchange rate, or valuation, or with an amount too large to calculate, left out.`
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {counted === 0 ? (
          <p className="text-body-sm text-muted-foreground">
            No assets to allocate. Add an asset with a valuation and it appears here.
          </p>
        ) : (
          <>
            <div
              role="tablist"
              aria-label="Asset allocation basis"
              className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1"
            >
              {tabs.map((item) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    tabRefs.current[item.id] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`${baseId}-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  onClick={() => setTab(item.id)}
                  onKeyDown={onKeyDown}
                  className={
                    tab === item.id
                      ? 'min-h-9 rounded-md bg-background px-4 text-body-sm font-medium text-foreground shadow-sm'
                      : 'min-h-9 rounded-md px-4 text-body-sm text-muted-foreground hover:text-foreground'
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            {tabs
              .filter((item) => item.id !== tab)
              .map((item) => (
                <div
                  key={item.id}
                  role="tabpanel"
                  id={`${baseId}-panel-${item.id}`}
                  aria-labelledby={`${baseId}-tab-${item.id}`}
                  hidden
                />
              ))}
            <div
              role="tabpanel"
              id={`${baseId}-panel-${tab}`}
              aria-labelledby={`${baseId}-tab-${tab}`}
              className="flex flex-col gap-4"
            >
              {bars.length === 0 ? (
                <p className="text-body-sm text-muted-foreground">
                  Every asset is ₩0, so there is nothing to draw in the chart.
                </p>
              ) : (
                <ChartBoundary key={tab}>
                  <Suspense
                    fallback={
                      <p className="text-body-sm text-muted-foreground">Loading the chart</p>
                    }
                  >
                    <chart.Chart bars={bars} title={title} />
                  </Suspense>
                </ChartBoundary>
              )}
              {tab === 'type' ? (
                <ShareTable
                  caption="Asset amounts and shares by type"
                  heading="Type"
                  rows={allocation.byType.map((row) => ({
                    key: row.type,
                    name: `${typeLabel(row.type)} (${row.count})`,
                    amountKrw: row.amountKrw,
                    share: row.share,
                  }))}
                />
              ) : (
                <ShareTable
                  caption="Asset amounts and shares by asset"
                  heading="Asset"
                  rows={allocation.byAsset.map((row) => ({
                    key: String(row.id),
                    name: row.name,
                    detail: typeLabel(row.type),
                    amountKrw: row.amountKrw,
                    share: row.share,
                  }))}
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The chart file failing to load (an old tab after a deploy, offline) must not take the page down: say so in
 * place of the chart. The table under it still has every value.
 */
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    chart.Chart = loadChart();
  }

  render() {
    return this.state.failed ? (
      <p className="text-body-sm text-muted-foreground">
        Could not load the chart. Check the values in the table below.
      </p>
    ) : (
      this.props.children
    );
  }
}

/** The won amount, or "-" when it is too large to show exactly. */
const wonText = (amount: number | null) => (amount === null ? '-' : formatWon(amount));

/** The chart's values as text: every row with its amount and share. */
function ShareTable({
  caption,
  heading,
  rows,
}: {
  caption: string;
  heading: string;
  rows: { key: string; name: string; detail?: string; amountKrw: number | null; share: string }[];
}) {
  return (
    <table className="w-full text-body-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            {heading}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Amount
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b last:border-b-0">
            <th scope="row" className="py-2 pr-2 text-left font-normal break-words">
              {row.name}
              {row.detail ? (
                <span className="block text-caption text-muted-foreground">{row.detail}</span>
              ) : null}
            </th>
            <td className="py-2 text-right whitespace-nowrap tabular-nums">
              {wonText(row.amountKrw)}
            </td>
            <td className="py-2 pl-2 text-right whitespace-nowrap tabular-nums">{row.share}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
