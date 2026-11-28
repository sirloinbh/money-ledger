import { AssetManager } from './assets';
import type { Health } from './health';
import { InvestmentIncome } from './investment-income';
import { NetWorthHistory } from './net-worth-history';
import { Page } from './page';

export function PortfolioPage({ health }: { health: Health }) {
  return (
    <Page title="Asset portfolio" health={health}>
      <AssetManager afterAllocation={<NetWorthHistory />} />
      <InvestmentIncome />
    </Page>
  );
}
