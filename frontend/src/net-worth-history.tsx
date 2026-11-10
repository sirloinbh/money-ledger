import {
  Component,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Notice } from './components/ui/notice';
import { formatWon, serviceToday } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';
import { cn } from './lib/utils';
import {
  dayLabel,
  netWorthPath,
  type Period,
  periods,
  periodStart,
  saveTodayOnce,
  type Snapshot,
} from './net-worth';

// #49 "순자산 추이" under the asset allocation card (decisions 2026-11-10). The saved days of a period as a line
// and a table; days without a save are not filled in. "지금 값으로 저장" saves today's totals again.

// Recharts is large: the chart loads in its own file when there is something to draw, not with the app.
// `lazy` keeps a failed load, so a failure starts a new one for the next period or retry.
const loadChart = () =>
  lazy(() => import('./net-worth-chart').then((module) => ({ default: module.NetWorthChart })));
const chart = { Chart: loadChart() };

type List = { today: string; snapshots: Snapshot[] };

export function NetWorthHistory() {
  const [period, setPeriod] = useState<Period>('3m');
  const [list, setList] = useState<{ period: Period; data: List } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Bumped by 다시 시도 and by a save, so the list (and a chart that failed to load) is read again.
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  const today = serviceToday();
  const from = periodStart(today, period);

  const load = useCallback(async () => {
    const request = ++latest.current;
    setFailed(false);
    // Today's save from opening the app goes first, so today is in the list.
    await saveTodayOnce();
    try {
      const data = await requestJson<List>(from ? `${netWorthPath}?from=${from}` : netWorthPath);
      if (request === latest.current) setList({ period, data });
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [from, period]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  const saveNow = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { snapshot } = await requestJson<{ snapshot: Snapshot }>(netWorthPath, {
        method: 'POST',
      });
      showStatus(`${dayLabel(snapshot.date)} 순자산 ${formatWon(snapshot.netKrw)}을 저장했습니다`);
      setAttempt((value) => value + 1);
    } catch (cause) {
      showError(cause, '순자산을 저장하지 못했습니다');
    } finally {
      setSaving(false);
    }
  };

  // The list of another period stays (dimmed) while the chosen one loads.
  const shown = list?.data;
  const loading = list !== undefined && list.period !== period;
  // The axis starts at the period's first day, or at the first save for the whole history.
  const axisFrom = from ?? shown?.snapshots[0]?.date ?? today;

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h2">순자산 추이</CardTitle>
        <CardDescription>
          앱을 연 날마다 그날의 순자산(자산 합계 − 부채 합계)을 한 번 기록합니다. 같은 날 다시
          저장하면 그날 기록을 바꿉니다. 기록이 없는 날은 앞뒤 기록을 잇습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="순자산 기간" className="flex gap-1">
            {periods.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="sm"
                variant={item.id === period ? 'default' : 'outline'}
                aria-pressed={item.id === period}
                onClick={() => setPeriod(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void saveNow()}
          >
            {saving ? '저장 중' : '지금 값으로 저장'}
          </Button>
        </div>
        <Notice notice={notice.notice} />
        <p aria-live="polite" className="text-body-sm text-muted-foreground">
          {from ? `${dayLabel(from)} ~ ${dayLabel(today)}` : `전체 기록 ~ ${dayLabel(today)}`}
        </p>
        {failed ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm text-muted-foreground">순자산 기록을 불러오지 못했습니다.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="순자산 기록 다시 시도"
              onClick={() => setAttempt((value) => value + 1)}
            >
              다시 시도
            </Button>
          </div>
        ) : null}
        {shown === undefined ? (
          failed ? null : (
            <p className="text-body-sm text-muted-foreground">순자산 기록을 불러오는 중입니다</p>
          )
        ) : (
          <div
            aria-busy={loading || undefined}
            className={cn('flex flex-col gap-4', loading && 'opacity-60')}
          >
            {shown.snapshots.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">이 기간에는 기록이 없습니다.</p>
            ) : (
              <>
                <ChartBoundary key={`${period}:${attempt}`}>
                  <Suspense
                    fallback={
                      <p className="text-body-sm text-muted-foreground">차트를 불러오는 중입니다</p>
                    }
                  >
                    <chart.Chart snapshots={shown.snapshots} from={axisFrom} to={today} />
                  </Suspense>
                </ChartBoundary>
                <details>
                  <summary className="cursor-pointer text-body-sm font-medium">
                    표로 보기({shown.snapshots.length}일)
                  </summary>
                  <SnapshotTable snapshots={shown.snapshots} />
                </details>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** The chart file failing to load must not take the page down: say so in place of the chart. */
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
        차트를 불러오지 못했습니다. 아래 표로 보기에서 값을 확인하세요.
      </p>
    ) : (
      this.props.children
    );
  }
}

/** Every saved day, newest first. The unit is in the column headings so four columns fit on a phone. */
function SnapshotTable({ snapshots }: { snapshots: Snapshot[] }) {
  return (
    <table className="mt-2 w-full text-body-sm">
      <caption className="sr-only">날짜별 순자산, 자산, 부채</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            날짜
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            순자산(원)
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            자산(원)
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            부채(원)
          </th>
        </tr>
      </thead>
      <tbody>
        {[...snapshots].reverse().map((snapshot) => (
          <tr key={snapshot.date} className="border-b last:border-b-0">
            <th scope="row" className="py-2 pr-2 text-left font-normal whitespace-nowrap">
              {snapshot.date.slice(2).replaceAll('-', '.')}
              {snapshot.uncounted > 0 ? (
                <span className="block text-caption text-muted-foreground">
                  {snapshot.uncounted}개 빠짐
                </span>
              ) : null}
            </th>
            <td className="py-2 text-right tabular-nums">{number(snapshot.netKrw)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{number(snapshot.assetsKrw)}</td>
            <td className="py-2 pl-2 text-right tabular-nums">{number(snapshot.debtsKrw)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const number = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
