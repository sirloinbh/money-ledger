import type { Health } from './health';
import { Page } from './page';

export function MockTradingPage({ health }: { health: Health }) {
  return (
    <Page
      title="모의투자"
      description="실제 자산과 분리된 가상 투자금으로 투자를 연습하고 수익률을 확인합니다"
      emptyDescription="모의투자 계좌 기능을 추가하면 여기에 표시됩니다."
      health={health}
    />
  );
}
