import { ChartPie, FileText, LayoutDashboard, Settings2, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell, type NavItem } from './components/layout/app-shell';
import { Toaster } from './components/ui/sonner';
import { DashboardPage } from './dashboard';
import { addDueOnce } from './fixed-costs-api';
import type { Health } from './health';
import { LedgerPage } from './ledger';
import { MockTradingPage } from './mock-trading';
import { saveTodayOnce } from './net-worth';
import { Page } from './page';
import { PortfolioPage } from './portfolio';
import { ReportPage, ReportsPage } from './reports';
import { makeReportsOnce } from './reports-api';

// Every page URL lives here (central docs/directory-rules.md).
const pages = {
  overview: '/',
  ledger: '/ledger',
  portfolio: '/portfolio',
  mockTrading: '/mock-trading',
  reports: '/reports',
  settings: '/settings',
} as const;

// Main menu (LNB) items, in display order.
const nav: NavItem[] = [
  { to: pages.overview, label: 'Dashboard', icon: LayoutDashboard },
  { to: pages.ledger, label: 'Ledger', icon: Wallet },
  { to: pages.portfolio, label: 'Asset portfolio', icon: ChartPie },
  { to: pages.mockTrading, label: 'Mock trading', icon: TrendingUp },
  { to: pages.reports, label: 'Reports', icon: FileText },
  { to: pages.settings, label: 'Settings', icon: Settings2 },
];

const emptyDescription = 'Features are registered as GitHub issue cards and added one by one.';

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

export function App() {
  const health = useHealth();
  // #49 Opening the app saves today's net worth once (decision 2026-11-10), whichever page opens first.
  // #43 It also adds the fixed-cost entries that are due (decision 2026-11-15), and #62 then saves the reports
  // of the weeks and months that have finished (decision 2026-11-16).
  useEffect(() => {
    void saveTodayOnce();
    void addDueOnce();
    void makeReportsOnce();
  }, []);
  return (
    <BrowserRouter>
      <AppShell appName="Ledger, Assets, Mock Trading" nav={nav}>
        <Routes>
          <Route path={pages.overview} element={<DashboardPage health={health} />} />
          <Route path={pages.ledger} element={<LedgerPage health={health} />} />
          <Route path={pages.portfolio} element={<PortfolioPage health={health} />} />
          <Route path={pages.mockTrading} element={<MockTradingPage health={health} />} />
          <Route path={pages.reports} element={<ReportsPage health={health} />} />
          <Route path={`${pages.reports}/:id`} element={<ReportPage health={health} />} />
          <Route
            path={pages.settings}
            element={
              <Page
                title="Settings"
                description="App preferences and data management"
                emptyDescription={emptyDescription}
                health={health}
              />
            }
          />
          <Route path="*" element={<Navigate to={pages.overview} replace />} />
        </Routes>
      </AppShell>
      <Toaster />
    </BrowserRouter>
  );
}
