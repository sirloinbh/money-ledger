import type { Health } from './health';
import { Page } from './page';

export function PortfolioPage({ health }: { health: Health }) {
  return (
    <Page
      title="자산 포트폴리오"
      description="보유 자산과 부채를 기록하고 순자산 변화를 확인합니다"
      emptyDescription="보유 자산 기능을 추가하면 여기에 표시됩니다."
      health={health}
    />
  );
}
