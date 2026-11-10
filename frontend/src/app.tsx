import { ChartPie, LayoutDashboard, Settings2, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell, type NavItem } from './components/layout/app-shell';
import { Toaster } from './components/ui/sonner';
import type { Health } from './health';
import { LedgerPage } from './ledger';
import { MockTradingPage } from './mock-trading';
import { saveTodayOnce } from './net-worth';
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
  { to: pages.overview, label: '대시보드', icon: LayoutDashboard },
  { to: pages.ledger, label: '가계부', icon: Wallet },
  { to: pages.portfolio, label: '자산 포트폴리오', icon: ChartPie },
  { to: pages.mockTrading, label: '모의투자', icon: TrendingUp },
  { to: pages.settings, label: '설정', icon: Settings2 },
];

const emptyDescription = '기능은 GitHub 이슈 카드로 등록한 뒤 하나씩 추가합니다.';

function useHealth() {
  const [health, setHealth] = useState<Health>({ state: 'loading' });
  useEffect(() => {
    fetch('/api/health')
      .then(async (response) => {
        const data = (await response.json()) as { today?: string; error?: string };
        setHealth(
          response.ok && data.today
            ? { state: 'ok', today: data.today }
            : { state: 'error', message: data.error ?? '서버 상태를 확인할 수 없습니다' },
        );
      })
      .catch(() => setHealth({ state: 'error', message: '서버에 연결할 수 없습니다' }));
  }, []);
  return health;
}

export function App() {
  const health = useHealth();
  // #49 Opening the app saves today's net worth once (decision 2026-11-10), whichever page opens first.
  useEffect(() => {
    void saveTodayOnce();
  }, []);
  return (
    <BrowserRouter>
      <AppShell appName="가계부·자산·모의투자" nav={nav}>
        <Routes>
          <Route
            path={pages.overview}
            element={
              <Page
                title="대시보드"
                description="가계부, 자산 포트폴리오, 모의투자를 기록하고 돈의 흐름을 확인하는 개인 서비스"
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
                title="설정"
                description="앱 환경과 데이터 관리"
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
