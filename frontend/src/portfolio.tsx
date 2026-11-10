import { AssetManager } from './assets';
import type { Health } from './health';
import { NetWorthHistory } from './net-worth-history';
import { Page } from './page';

export function PortfolioPage({ health }: { health: Health }) {
  return (
    <Page
      title="자산 포트폴리오"
      description="보유 자산과 부채를 기록하고 순자산 변화를 확인합니다"
      health={health}
    >
      <AssetManager afterAllocation={<NetWorthHistory />} />
    </Page>
  );
}
