import { ChartPie, LayoutDashboard, Settings2, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell, type NavItem } from './components/layout/app-shell';
import { Toaster } from './components/ui/sonner';
import type { Health } from './health';
import { LedgerPage } from './ledger';
import { MockTradingPage } from './mock-trading';
import { Page } from './page';
import { PortfolioPage } from './portfolio';

// Every page URL lives here (central docs/directory-rules.md).
const pages = {
  overview: '/',
  ledger: '/ledger',
  portfolio: '/portfolio',
  mockTrading: '/mock-trading',
  settings: '/settings',
} as const;

// Main menu (LNB) items, in display order.
const nav: NavItem[] = [
  { to: pages.overview, label: 'Dashboard', icon: LayoutDashboard },
  { to: pages.ledger, label: 'Ledger', icon: Wallet },
  { to: pages.portfolio, label: 'Asset portfolio', icon: ChartPie },
  { to: pages.mockTrading, label: 'Mock trading', icon: TrendingUp },
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
  return (
    <BrowserRouter>
      <AppShell appName="Ledger, Assets, Mock Trading" nav={nav}>
        <Routes>
          <Route
            path={pages.overview}
            element={
              <Page
                title="Dashboard"
                description="A personal service to record your ledger, asset portfolio, and mock trading and see where your money goes"
                emptyDescription={emptyDescription}
                health={health}
              />
            }
          />
          <Route path={pages.ledger} element={<LedgerPage health={health} />} />
          <Route path={pages.portfolio} element={<PortfolioPage health={health} />} />
          <Route path={pages.mockTrading} element={<MockTradingPage health={health} />} />
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
