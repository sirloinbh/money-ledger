import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ChartPie,
  FileText,
  LayoutDashboard,
  PiggyBank,
  Settings2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { BackupSettings } from './backup';
import { AppShell, type NavItem } from './components/layout/app-shell';
import { Toaster } from './components/ui/sonner';
import { DashboardPage } from './dashboard';
import { DayLogPage } from './day-log';
import { addDueOnce } from './fixed-costs-api';
import { GoalsPage } from './goals';
import type { Health } from './health';
import { KakaoSettings } from './kakao-settings';
import { LedgerPage } from './ledger';
import { createQueryClient } from './lib/query';
import { MockTradingPage } from './mock-trading';
import { saveTodayOnce } from './net-worth';
import { Page } from './page';
import { PortfolioPage } from './portfolio';
import { ReportPage, ReportsPage } from './reports';
import { makeReportsOnce } from './reports-api';
import { AccountActions, SignInGate } from './sign-in';
import { TwelveWeeksPage } from './twelve-weeks';
import { WeekPage } from './week';

// Every page URL lives here (central docs/directory-rules.md).
const pages = {
  dayLog: '/',
  week: '/week',
  twelveWeeks: '/12-weeks',
  dashboard: '/dashboard',
  ledger: '/ledger',
  portfolio: '/portfolio',
  goals: '/goals',
  mockTrading: '/mock-trading',
  reports: '/reports',
  settings: '/settings',
} as const;

// Main menu (LNB) items, in display order.
const nav: NavItem[] = [
  { to: pages.dayLog, label: 'Day log', icon: CalendarDays },
  { to: pages.week, label: 'Week', icon: CalendarRange },
  { to: pages.twelveWeeks, label: '12 weeks', icon: ChartColumn },
  { to: pages.ledger, label: 'Ledger', icon: Wallet },
  { to: pages.portfolio, label: 'Asset portfolio', icon: ChartPie },
  { to: pages.goals, label: 'Goals', icon: PiggyBank },
  { to: pages.mockTrading, label: 'Mock trading', icon: TrendingUp },
  { to: pages.reports, label: 'Reports', icon: FileText },
  { to: pages.dashboard, label: 'Dashboard', icon: LayoutDashboard },
  { to: pages.settings, label: 'Settings', icon: Settings2 },
];

function useHealth() {
  const [health, setHealth] = useState<Health>({ state: 'loading' });
  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        const data = (await response.json()) as { today?: string; error?: string };
        setHealth(
          response.ok && data.today
            ? { state: 'ok', today: data.today }
            : { state: 'error', message: data.error ?? 'Cannot check the server status' },
        );
      })
      .catch(() => setHealth({ state: 'error', message: 'Cannot connect to the server' }));
  }, []);
  return health;
}

// The effects below call /api, so they live inside the sign-in gate and run once the visitor is signed in.
function Workspace() {
  const health = useHealth();
  // #49 Opening the app saves today's net worth once (decision 2026-11-10), whichever page opens first.
  // #43 It also adds the fixed-cost entries that are due (decision 2026-11-15), and #62 then saves the reports
  // of the weeks and months that have finished (decision 2026-11-16). #185 The server's daily job
  // (backend/src/daily-saves.ts) does the same three; these calls stay as the fallback and are safe to repeat.
  useEffect(() => {
    void saveTodayOnce();
    void addDueOnce();
    void makeReportsOnce();
  }, []);
  return (
    <>
      <AppShell appName="Ledger, Assets, Mock Trading" nav={nav} actions={<AccountActions />}>
        <Routes>
          <Route path={pages.dayLog} element={<DayLogPage health={health} />} />
          <Route path={pages.week} element={<WeekPage health={health} />} />
          <Route path={pages.twelveWeeks} element={<TwelveWeeksPage health={health} />} />
          <Route path={pages.dashboard} element={<DashboardPage health={health} />} />
          <Route path={pages.ledger} element={<LedgerPage health={health} />} />
          <Route path={pages.portfolio} element={<PortfolioPage health={health} />} />
          <Route path={pages.goals} element={<GoalsPage health={health} />} />
          <Route path={pages.mockTrading} element={<MockTradingPage health={health} />} />
          <Route path={pages.reports} element={<ReportsPage health={health} />} />
          <Route path={`${pages.reports}/:id`} element={<ReportPage health={health} />} />
          <Route
            path={pages.settings}
            element={
              <Page
                title="Settings"
                description="App preferences and data management"
                health={health}
              >
                <KakaoSettings />
                <BackupSettings />
              </Page>
            }
          />
          <Route path="*" element={<Navigate to={pages.dayLog} replace />} />
        </Routes>
      </AppShell>
      <Toaster />
    </>
  );
}

/** `queryClient` is for tests that start with their own client; the app makes its own (#213). */
export function App({ queryClient: given }: { queryClient?: QueryClient } = {}) {
  // One query client for the app's lifetime (kept in state, so a re-render does not drop the cache).
  const [queryClient] = useState(() => given ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SignInGate>
          <Workspace />
        </SignInGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
