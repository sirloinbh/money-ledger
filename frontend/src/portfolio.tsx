import { AssetManager } from './assets';
import type { Health } from './health';
import { InvestmentIncome } from './investment-income';
import { NetWorthHistory } from './net-worth-history';
import { Page } from './page';

export function PortfolioPage({ health }: { health: Health }) {
  return (
    <Page
      title="Asset portfolio"
      description="Record your assets and liabilities and track how your net worth changes"
      health={health}
    >
      <AssetManager afterAllocation={<NetWorthHistory />} />
      <InvestmentIncome />
    </Page>
  );
}
