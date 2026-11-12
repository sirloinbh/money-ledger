import { AssetManager } from './assets';
import type { Health } from './health';
import { Page } from './page';

export function PortfolioPage({ health }: { health: Health }) {
  return (
    <Page
      title="Asset portfolio"
      description="Record your assets and liabilities and track how your net worth changes"
      health={health}
    >
      <AssetManager />
    </Page>
  );
}
