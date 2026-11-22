import { Component, type ErrorInfo, type ReactNode, Suspense } from 'react';

import { Button } from './components/ui/button';
import { ChartLoadError, type LazyChart } from './lazy-chart';

// #202 The one boundary every lazy chart (lazy-chart.ts) sits in.

type BoundaryProps = {
  children: ReactNode;
  chart: Pick<LazyChart<never>, 'reload'>;
  /** Says where the same values are, e.g. "Check the values in the table below." */
  message: string;
  /** Shows "Try again"; the caller remounts the boundary (a new `key`). Without it, a new key still retries. */
  onRetry?: () => void;
};

/**
 * Shows the chart while it loads and in its place a message when it fails, so the page and its table stay. Give
 * it a new `key` to try again. A failed download is loaded again next time; a drawing error is logged.
 */
export class ChartBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (error instanceof ChartLoadError) {
      this.props.chart.reload();
      console.warn('[chart] the chart file did not load', error.cause);
    } else {
      console.error('[chart] the chart failed to draw', error, info.componentStack);
    }
  }

  render() {
    if (!this.state.failed) {
      return (
        <Suspense
          fallback={<p className="text-body-sm text-muted-foreground">Loading the chart</p>}
        >
          {this.props.children}
        </Suspense>
      );
    }
    const text = <p className="text-body-sm text-muted-foreground">{this.props.message}</p>;
    return this.props.onRetry ? (
      <div className="flex flex-wrap items-center gap-2">
        {text}
        <Button type="button" variant="outline" size="sm" onClick={this.props.onRetry}>
          Try again
        </Button>
      </div>
    ) : (
      text
    );
  }
}

/** What a chart shows for an empty list. The screens do not draw one then; this keeps a stray call from failing. */
export function EmptyChart() {
  return <p className="text-body-sm text-muted-foreground">Nothing to draw yet.</p>;
}
